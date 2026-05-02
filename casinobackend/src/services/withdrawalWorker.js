/**
 * Withdrawal Worker Service
 *
 * BTC: looks up the user's deposit_address from the DB, then scans the
 *      mnemonic to find the matching private key. This works regardless of
 *      which index or code version originally generated the address.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const bitcoin = require("bitcoinjs-lib");
const bip39   = require("bip39");
const ecc     = require("tiny-secp256k1");
const { BIP32Factory } = require("bip32");
const { ECPairFactory } = require("ecpair");
const { ethers } = require("ethers");
const pool    = require("../db/pool");
const { isTestnet, getEvmRpcUrl, getUsdtContract } = require("../config/networkMode");

bitcoin.initEccLib(ecc);
const bip32  = BIP32Factory(ecc);
const ECPair = ECPairFactory(ecc);

const POLL_MS      = parseInt(process.env.WITHDRAWAL_WORKER_POLL_MS || "5000", 10);
const MAX_ATTEMPTS = parseInt(process.env.WITHDRAWAL_MAX_ATTEMPTS   || "5",    10);
const BATCH_SIZE   = parseInt(process.env.WITHDRAWAL_WORKER_BATCH   || "5",    10);

// ─── Find the private key that matches a known deposit address ────────────────
//
// Scans m/84'/{coin}'/0'/0/{i} for i in 0..MAX_SCAN_INDEX until the derived
// p2wpkh address matches depositAddress. This is the source of truth — we use
// whatever address is stored in the DB rather than recalculating by formula.

const MAX_SCAN_INDEX = parseInt(process.env.BTC_KEY_SCAN_LIMIT || "5000", 10);

async function findKeyForDepositAddress(mnemonic, depositAddress, network, coin) {
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const root = bip32.fromSeed(seed, network);

  for (let i = 0; i < MAX_SCAN_INDEX; i++) {
    const child = root.derivePath(`m/84'/${coin}'/0'/0/${i}`);
    const { address } = bitcoin.payments.p2wpkh({
      pubkey: Buffer.from(child.publicKey),
      network,
    });
    if (address === depositAddress) {
      console.log(`🔑 Found key for ${depositAddress} at index ${i}`);
      return child;
    }
  }

  throw new Error(
    `Could not find private key for deposit address ${depositAddress} ` +
    `(scanned ${MAX_SCAN_INDEX} indices). Check WALLET_MNEMONIC matches the one used to generate addresses.`
  );
}

// ─── BTC Send ─────────────────────────────────────────────────────────────────

async function sendBTC(toAddress, amountBTC, userId) {
  const network = isTestnet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;
  const coin    = isTestnet ? 1 : 0;
  const base    = (process.env.BTC_EXPLORER_BASE_URL ||
    (isTestnet ? "https://blockstream.info/testnet/api" : "https://blockstream.info/api")
  ).replace(/\/$/, "");

  const mnemonic = (process.env.WALLET_MNEMONIC || "").trim();
  if (!mnemonic || !bip39.validateMnemonic(mnemonic)) {
    throw new Error("Missing or invalid WALLET_MNEMONIC");
  }

  // Get the actual deposit address from the DB — this is the source of truth
  const walletRes = await pool.query(
    "SELECT deposit_address FROM wallets WHERE user_id = $1 AND currency = 'BTC' LIMIT 1",
    [userId]
  );
  if (!walletRes.rows.length || !walletRes.rows[0].deposit_address) {
    throw new Error(`No BTC deposit address found in DB for user ${userId}`);
  }
  const fromAddress = walletRes.rows[0].deposit_address;

  console.log(`🔑 BTC payout: spending from user ${userId}'s deposit address ${fromAddress}`);

  // Find the private key that matches this address
  const child   = await findKeyForDepositAddress(mnemonic, fromAddress, network, coin);
  const keyPair = ECPair.fromWIF(child.toWIF(), network);

  // Fetch UTXOs
  const utxoResp = await fetch(`${base}/address/${fromAddress}/utxo`);
  if (!utxoResp.ok) throw new Error(`UTXO fetch failed: ${utxoResp.status}`);
  const utxos = await utxoResp.json();

  if (!Array.isArray(utxos) || utxos.length === 0) {
    throw new Error(`No UTXOs found at ${fromAddress} (user ${userId})`);
  }

  const fee         = parseInt(process.env.BTC_TESTNET_FIXED_FEE_SATS || "1000", 10);
  const satoshisOut = Math.round(amountBTC * 100_000_000);

  const psbt = new bitcoin.Psbt({ network });
  let inputSum = 0;

  for (const utxo of utxos) {
    if (inputSum >= satoshisOut + fee) break;
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      witnessUtxo: {
        script: bitcoin.address.toOutputScript(fromAddress, network),
        value:  utxo.value,
      },
    });
    inputSum += utxo.value;
  }

  if (inputSum < satoshisOut + fee) {
    throw new Error(
      `Insufficient BTC. Need ${satoshisOut + fee} sats, have ${inputSum} sats at ${fromAddress}`
    );
  }

  const change = inputSum - satoshisOut - fee;
  psbt.addOutput({ address: toAddress, value: satoshisOut });
  if (change > 0) {
    psbt.addOutput({ address: fromAddress, value: change });
  }

  psbt.signAllInputs(keyPair);
  psbt.finalizeAllInputs();

  const txHex = psbt.extractTransaction().toHex();

  const broadcastResp = await fetch(`${base}/tx`, { method: "POST", body: txHex });
  const txid = await broadcastResp.text();
  if (!broadcastResp.ok) throw new Error(`BTC broadcast failed: ${txid}`);

  return txid.trim();
}

// ─── EVM Payout ──────────────────────────────────────────────────────────────

async function sendEVM(withdrawal) {
  const rpcUrl    = getEvmRpcUrl();
  const signerKey = process.env.TESTNET_PAYOUT_PRIVATE_KEY;

  if (!rpcUrl || !signerKey) {
    throw new Error("Missing TESTNET_EVM_RPC_URL or TESTNET_PAYOUT_PRIVATE_KEY");
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer   = new ethers.Wallet(signerKey, provider);

  if (withdrawal.currency === "ETH_POLYGON") {
    const tx = await signer.sendTransaction({
      to:    withdrawal.to_address,
      value: ethers.parseEther(String(withdrawal.amount)),
    });
    return tx.hash;
  }

  if (withdrawal.currency === "USDT") {
    const usdt = getUsdtContract();
    if (!usdt) throw new Error("Missing TESTNET_USDT_CONTRACT");
    const erc20 = new ethers.Contract(
      usdt,
      ["function transfer(address to, uint256 amount) returns (bool)", "function decimals() view returns (uint8)"],
      signer
    );
    const decimals = await erc20.decimals();
    const tx = await erc20.transfer(
      withdrawal.to_address,
      ethers.parseUnits(String(withdrawal.amount), decimals)
    );
    return tx.hash;
  }

  throw new Error(`Unsupported EVM currency: ${withdrawal.currency}`);
}

// ─── Execute Payout ───────────────────────────────────────────────────────────

async function executePayout(withdrawal) {
  const provider = (process.env.PAYOUT_PROVIDER || "stub").toLowerCase();

  if (provider === "stub") {
    if (process.env.SIMULATE_PAYOUT_FAILURE === "true") {
      throw new Error("Stub payout: simulated failure");
    }
    return { txHash: `stub_${withdrawal.id}_${Date.now()}` };
  }

  if (provider === "testnet") {
    if (!isTestnet) throw new Error("PAYOUT_PROVIDER=testnet requires TESTNET_MODE=true");

    if (withdrawal.currency === "BTC") {
      const txHash = await sendBTC(withdrawal.to_address, parseFloat(withdrawal.amount), withdrawal.user_id);
      return { txHash };
    }

    const txHash = await sendEVM(withdrawal);
    return { txHash };
  }

  throw new Error(`Unsupported PAYOUT_PROVIDER: "${provider}". Use "stub" or "testnet".`);
}

// ─── Job lifecycle ────────────────────────────────────────────────────────────

function getWalletCandidates(currency) {
  return currency === "USDT" ? ["USDT", "USDT_POLYGON"] : [currency];
}

async function claimJobs(client) {
  const res = await client.query(
    `WITH picked AS (
       SELECT wj.id
       FROM withdrawal_jobs wj
       WHERE wj.status = 'queued'
         AND wj.next_retry_at <= NOW()
       ORDER BY wj.created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE withdrawal_jobs wj
     SET status = 'processing', attempts = attempts + 1, updated_at = NOW()
     FROM picked
     WHERE wj.id = picked.id
     RETURNING wj.id, wj.withdrawal_id, wj.attempts`,
    [BATCH_SIZE]
  );

  const jobs = [];
  for (const row of res.rows) {
    const wdRes = await client.query(
      `SELECT id, user_id, currency, amount, fee, to_address, status
       FROM withdrawals WHERE id = $1 FOR UPDATE`,
      [row.withdrawal_id]
    );
    if (wdRes.rows.length > 0) {
      jobs.push({ ...row, withdrawal: wdRes.rows[0] });
    }
  }
  return jobs;
}

async function markSuccess(jobId, withdrawalId, txHash) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE withdrawals SET status = 'sent', tx_hash = $1, processed_at = NOW() WHERE id = $2`,
      [txHash, withdrawalId]
    );
    await client.query(
      `UPDATE withdrawal_jobs SET status = 'sent', tx_hash = $1, processed_at = NOW(), last_error = NULL, updated_at = NOW() WHERE id = $2`,
      [txHash, jobId]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function markFailure(job, err) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const errorText = (err?.message || String(err)).slice(0, 1000);

    if (job.attempts >= MAX_ATTEMPTS) {
      const refundAmount = parseFloat(job.withdrawal.amount) + parseFloat(job.withdrawal.fee);
      await client.query(
        `UPDATE withdrawal_jobs SET status = 'failed', last_error = $1, processed_at = NOW(), updated_at = NOW() WHERE id = $2`,
        [errorText, job.id]
      );
      await client.query(
        `UPDATE withdrawals SET status = 'failed', processed_at = NOW() WHERE id = $1`,
        [job.withdrawal.id]
      );
      await client.query(
        `UPDATE wallets SET balance = balance + $1
         WHERE id = (
           SELECT id FROM wallets
           WHERE user_id = $2 AND currency = ANY($3::text[])
           ORDER BY CASE WHEN currency = 'USDT' THEN 0 ELSE 1 END
           LIMIT 1
         )`,
        [refundAmount, job.withdrawal.user_id, getWalletCandidates(job.withdrawal.currency)]
      );
    } else {
      const retrySeconds = Math.min(300, Math.pow(2, job.attempts) * 5);
      await client.query(
        `UPDATE withdrawal_jobs
         SET status = 'queued', last_error = $1,
             next_retry_at = NOW() + ($2 || ' seconds')::interval, updated_at = NOW()
         WHERE id = $3`,
        [errorText, retrySeconds, job.id]
      );
      await client.query(
        `UPDATE withdrawals SET status = 'processing' WHERE id = $1`,
        [job.withdrawal.id]
      );
    }

    await client.query("COMMIT");
  } catch (txErr) {
    await client.query("ROLLBACK");
    throw txErr;
  } finally {
    client.release();
  }
}

// ─── Main loop ────────────────────────────────────────────────────────────────

async function processOnce() {
  const client = await pool.connect();
  let jobs = [];
  try {
    await client.query("BEGIN");
    jobs = await claimJobs(client);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  for (const job of jobs) {
    try {
      const payout = await executePayout(job.withdrawal);
      await markSuccess(job.id, job.withdrawal.id, payout.txHash);
      console.log(`✅ Withdrawal ${job.withdrawal.id} sent — tx: ${payout.txHash}`);
    } catch (err) {
      await markFailure(job, err);
      console.error(`❌ Withdrawal ${job.withdrawal.id} failed (attempt ${job.attempts}):`, err.message);
    }
  }
}

async function start() {
  console.log("🚚 Withdrawal worker started");
  while (true) {
    try {
      await processOnce();
    } catch (err) {
      console.error("Worker loop error:", err);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

start().catch((err) => { console.error(err); process.exit(1); });
