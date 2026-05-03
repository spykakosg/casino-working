/**
 * Withdrawal Worker Service
 *
 * Sends all withdrawals from house hot wallets.
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
const { getBtcHotWallet } = require("./hotWallet");

bitcoin.initEccLib(ecc);
const bip32  = BIP32Factory(ecc);
const ECPair = ECPairFactory(ecc);

const POLL_MS      = parseInt(process.env.WITHDRAWAL_WORKER_POLL_MS || "5000", 10);
const MAX_ATTEMPTS = parseInt(process.env.WITHDRAWAL_MAX_ATTEMPTS   || "5",    10);
const BATCH_SIZE   = parseInt(process.env.WITHDRAWAL_WORKER_BATCH   || "5",    10);

async function getBtcFeeRate(baseApiUrl) {
  try {
    const resp = await fetch(`${baseApiUrl}/fee-estimates`);
    if (!resp.ok) throw new Error(`status ${resp.status}`);
    const data = await resp.json();
    const fast = Number(data["1"]);
    const normal = Number(data["3"]);
    const economy = Number(data["6"]);
    const minConfigured = Number(process.env.BTC_MIN_SAT_PER_VB || "1");
    const chosen = Number.isFinite(economy) ? economy : (Number.isFinite(normal) ? normal : fast);
    if (!Number.isFinite(chosen) || chosen <= 0) return minConfigured;
    return Math.max(minConfigured, Math.floor(chosen));
  } catch {
    return Number(process.env.BTC_MIN_SAT_PER_VB || "1");
  }
}

// ─── BTC Send ─────────────────────────────────────────────────────────────────

async function sendBTC(toAddress, amountBTC) {
  const network = isTestnet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;
  const coin    = isTestnet ? 1 : 0;
  const base    = (process.env.BTC_EXPLORER_BASE_URL ||
    (isTestnet ? "https://blockstream.info/testnet/api" : "https://blockstream.info/api")
  ).replace(/\/$/, "");

  const mnemonic = (process.env.WALLET_MNEMONIC || "").trim();
  if (!mnemonic || !bip39.validateMnemonic(mnemonic)) {
    throw new Error("Missing or invalid WALLET_MNEMONIC");
  }

  // Use house hot wallet only
  const { child, address: fromAddress } = await getBtcHotWallet();

  console.log(`🔑 BTC payout: spending from house hot wallet ${fromAddress}`);

  const keyPair = ECPair.fromWIF(child.toWIF(), network);

  // Fetch UTXOs
  const utxoResp = await fetch(`${base}/address/${fromAddress}/utxo`);
  if (!utxoResp.ok) throw new Error(`UTXO fetch failed: ${utxoResp.status}`);
  const utxos = await utxoResp.json();

  if (!Array.isArray(utxos) || utxos.length === 0) {
    throw new Error(`No UTXOs found at hot wallet address ${fromAddress}`);
  }

  const satoshisOut = Math.round(amountBTC * 100_000_000);

  const psbt = new bitcoin.Psbt({ network });
  let inputSum = 0;
  let selectedInputs = 0;
  const feeRate = await getBtcFeeRate(base);

  for (const utxo of utxos) {
    const estimatedFee = Math.ceil((10 + ((selectedInputs + 1) * 68) + (2 * 31)) * feeRate);
    if (inputSum >= satoshisOut + estimatedFee) break;
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      witnessUtxo: {
        script: bitcoin.address.toOutputScript(fromAddress, network),
        value:  utxo.value,
      },
    });
    inputSum += utxo.value;
    selectedInputs += 1;
  }

  const finalFee = Math.ceil((10 + (selectedInputs * 68) + (2 * 31)) * feeRate);
  if (inputSum < satoshisOut + finalFee) {
    throw new Error(
      `Insufficient BTC hot wallet balance. Need ${satoshisOut + finalFee} sats, have ${inputSum} sats at ${fromAddress}`
    );
  }

  const change = inputSum - satoshisOut - finalFee;
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
  const feeData = await provider.getFeeData();
  const minPriority = ethers.parseUnits(process.env.EVM_MIN_PRIORITY_GWEI || "0.03", "gwei");
  const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas && feeData.maxPriorityFeePerGas > minPriority
    ? feeData.maxPriorityFeePerGas
    : minPriority;
  const maxFeePerGas = feeData.maxFeePerGas && feeData.maxFeePerGas > maxPriorityFeePerGas
    ? feeData.maxFeePerGas
    : maxPriorityFeePerGas * 2n;
  const feeOverrides = { maxFeePerGas, maxPriorityFeePerGas };

  if (withdrawal.currency === "ETH_POLYGON") {
    const tx = await signer.sendTransaction({
      to:    withdrawal.to_address,
      value: ethers.parseEther(String(withdrawal.amount)),
      ...feeOverrides,
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
      ethers.parseUnits(String(withdrawal.amount), decimals),
      feeOverrides
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
      const txHash = await sendBTC(withdrawal.to_address, parseFloat(withdrawal.amount));
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
