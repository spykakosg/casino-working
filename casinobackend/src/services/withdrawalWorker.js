/**
 * Withdrawal Worker Service
 *
 * Pulls queued withdrawal jobs, executes payout adapter, and updates
 * withdrawal/job lifecycle with retry + refund safety.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const { ethers } = require("ethers");
const bitcoin = require("bitcoinjs-lib");
const ecc = require("tiny-secp256k1");
const { ECPairFactory } = require("ecpair");
const ECPair = ECPairFactory(ecc);
const pool = require("../db/pool");
const { isTestnet, getEvmRpcUrl, getUsdtContract } = require("../config/networkMode");

const POLL_MS = parseInt(process.env.WITHDRAWAL_WORKER_POLL_MS || "5000", 10);
const MAX_ATTEMPTS = parseInt(process.env.WITHDRAWAL_MAX_ATTEMPTS || "5", 10);
const BATCH_SIZE = parseInt(process.env.WITHDRAWAL_WORKER_BATCH || "5", 10);

function getWalletCurrencyCandidates(currency) {
  return currency === "USDT" ? ["USDT", "USDT_POLYGON", "USDT_TRON"] : [currency];
}



async function sendBtcTestnetWithdrawal(toAddress, amountBtc) {
  const wif = process.env.TESTNET_BTC_WIF;
  const fromAddress = process.env.TESTNET_BTC_FROM_ADDRESS;
  if (!wif || !fromAddress) {
    throw new Error("Missing TESTNET_BTC_WIF or TESTNET_BTC_FROM_ADDRESS");
  }

  const network = bitcoin.networks.testnet;
  const keyPair = ECPair.fromWIF(wif, network);
  const base = (process.env.BTC_EXPLORER_BASE_URL || "https://blockstream.info/testnet/api").replace(/\/$/, "");
  const utxoResp = await fetch(`${base}/address/${fromAddress}/utxo`);
  if (!utxoResp.ok) throw new Error(`BTC UTXO fetch failed: ${utxoResp.status}`);
  const utxos = await utxoResp.json();
  if (!Array.isArray(utxos) || utxos.length === 0) throw new Error("No BTC UTXOs available for payout wallet");

  const satoshisOut = Math.floor(Number(amountBtc) * 100_000_000);
  const feeRate = parseFloat(process.env.BTC_TESTNET_FEE_RATE || "2"); // sat/vbyte

  let selected = [];
  let totalIn = 0;
  for (const u of utxos) {
    selected.push(u);
    totalIn += u.value;
    if (totalIn > satoshisOut + 500) break;
  }

  const estVBytes = selected.length * 68 + 2 * 31 + 10;
  const fee = Math.ceil(estVBytes * feeRate);
  if (totalIn < satoshisOut + fee) throw new Error("Insufficient BTC UTXOs for amount + fee");
  const change = totalIn - satoshisOut - fee;

  const psbt = new bitcoin.Psbt({ network });
  for (const u of selected) {
    const txHexResp = await fetch(`${base}/tx/${u.txid}/hex`);
    if (!txHexResp.ok) throw new Error(`BTC prevtx fetch failed: ${u.txid}`);
    const txHex = await txHexResp.text();
    psbt.addInput({ hash: u.txid, index: u.vout, nonWitnessUtxo: Buffer.from(txHex, "hex") });
  }

  psbt.addOutput({ address: toAddress, value: satoshisOut });
  if (change > 546) {
    psbt.addOutput({ address: fromAddress, value: change });
  }

  selected.forEach((_, i) => psbt.signInput(i, keyPair));
  psbt.finalizeAllInputs();
  const rawTx = psbt.extractTransaction().toHex();

  const broadcastResp = await fetch(`${base}/tx`, { method: "POST", body: rawTx });
  const txid = await broadcastResp.text();
  if (!broadcastResp.ok) throw new Error(`BTC broadcast failed: ${txid}`);
  return txid.trim();
}

async function executePayout(withdrawal) {
  const provider = (process.env.PAYOUT_PROVIDER || "stub").toLowerCase();

  if (provider === "stub") {
    if (process.env.SIMULATE_PAYOUT_FAILURE === "true") {
      throw new Error("Stub payout provider simulated failure");
    }
    return {
      txHash: `stub_${withdrawal.id}_${Date.now()}`,
      provider,
    };
  }

  if (provider === "testnet") {
    if (!isTestnet) throw new Error("PAYOUT_PROVIDER=testnet requires TESTNET_MODE=true");
    const rpcUrl = getEvmRpcUrl();
    const signerKey = process.env.TESTNET_PAYOUT_PRIVATE_KEY;
    if (!rpcUrl || !signerKey) {
      throw new Error("Missing TESTNET_EVM_RPC_URL or TESTNET_PAYOUT_PRIVATE_KEY");
    }

    if (withdrawal.currency === "ETH_POLYGON") {
      const rpc = new ethers.JsonRpcProvider(rpcUrl);
      const signer = new ethers.Wallet(signerKey, rpc);
      const tx = await signer.sendTransaction({
        to: withdrawal.to_address,
        value: ethers.parseEther(String(withdrawal.amount)),
      });
      return { txHash: tx.hash, provider };
    }

    if (withdrawal.currency === "USDT") {
      const usdt = getUsdtContract();
      if (!usdt) throw new Error("Missing TESTNET_USDT_CONTRACT for USDT withdrawals");
      const rpc = new ethers.JsonRpcProvider(rpcUrl);
      const signer = new ethers.Wallet(signerKey, rpc);
      const erc20 = new ethers.Contract(usdt, ["function transfer(address to, uint256 amount) returns (bool)", "function decimals() view returns (uint8)"], signer);
      const decimals = await erc20.decimals();
      const tx = await erc20.transfer(withdrawal.to_address, ethers.parseUnits(String(withdrawal.amount), decimals));
      return { txHash: tx.hash, provider };
    }

    if (withdrawal.currency === "BTC") {
      const txHash = await sendBtcTestnetWithdrawal(withdrawal.to_address, withdrawal.amount);
      return { txHash, provider };
    }
  }

  throw new Error(`Unsupported PAYOUT_PROVIDER: ${provider}`);
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

  if (res.rows.length === 0) return [];

  const jobs = [];
  for (const row of res.rows) {
    const wdRes = await client.query(
      `SELECT id, user_id, currency, amount, fee, to_address, status
       FROM withdrawals
       WHERE id = $1
       FOR UPDATE`,
      [row.withdrawal_id]
    );

    if (wdRes.rows.length === 0) continue;
    jobs.push({ ...row, withdrawal: wdRes.rows[0] });
  }
  return jobs;
}

async function markSuccess(jobId, withdrawalId, txHash) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `UPDATE withdrawals
       SET status = 'sent', tx_hash = $1, processed_at = NOW()
       WHERE id = $2`,
      [txHash, withdrawalId]
    );

    await client.query(
      `UPDATE withdrawal_jobs
       SET status = 'sent', tx_hash = $1, processed_at = NOW(), last_error = NULL, updated_at = NOW()
       WHERE id = $2`,
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
        `UPDATE withdrawal_jobs
         SET status = 'failed', last_error = $1, processed_at = NOW(), updated_at = NOW()
         WHERE id = $2`,
        [errorText, job.id]
      );

      await client.query(
        `UPDATE withdrawals
         SET status = 'failed', processed_at = NOW()
         WHERE id = $1`,
        [job.withdrawal.id]
      );

      await client.query(
        `UPDATE wallets
         SET balance = balance + $1
         WHERE id = (
           SELECT id
           FROM wallets
           WHERE user_id = $2
             AND currency = ANY($3::text[])
           ORDER BY CASE
             WHEN currency = 'USDT' THEN 0
             WHEN currency = 'USDT_POLYGON' THEN 1
             WHEN currency = 'USDT_TRON' THEN 2
             ELSE 3
           END
           LIMIT 1
         )`,
        [refundAmount, job.withdrawal.user_id, getWalletCurrencyCandidates(job.withdrawal.currency)]
      );
    } else {
      const retrySeconds = Math.min(300, Math.pow(2, job.attempts) * 5);
      await client.query(
        `UPDATE withdrawal_jobs
         SET status = 'queued',
             last_error = $1,
             next_retry_at = NOW() + ($2 || ' seconds')::interval,
             updated_at = NOW()
         WHERE id = $3`,
        [errorText, retrySeconds, job.id]
      );

      await client.query(
        `UPDATE withdrawals
         SET status = 'processing'
         WHERE id = $1`,
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
      console.log(`✅ Sent withdrawal ${job.withdrawal.id} with tx ${payout.txHash}`);
    } catch (err) {
      await markFailure(job, err);
      console.error(`❌ Withdrawal ${job.withdrawal.id} failed attempt ${job.attempts}:`, err.message || err);
    }
  }
}

async function start() {
  console.log("🚚 Withdrawal worker started");
  while (true) {
    try {
      await processOnce();
    } catch (err) {
      console.error("Withdrawal worker loop error:", err);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
