/**
 * Withdrawal Worker Service
 *
 * Pulls queued withdrawal jobs, executes payout adapter, and updates
 * withdrawal/job lifecycle with retry + refund safety.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const pool = require("../db/pool");

const POLL_MS = parseInt(process.env.WITHDRAWAL_WORKER_POLL_MS || "5000", 10);
const MAX_ATTEMPTS = parseInt(process.env.WITHDRAWAL_MAX_ATTEMPTS || "5", 10);
const BATCH_SIZE = parseInt(process.env.WITHDRAWAL_WORKER_BATCH || "5", 10);

function getWalletCurrencyCandidates(currency) {
  return currency === "USDT" ? ["USDT", "USDT_POLYGON", "USDT_TRON"] : [currency];
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
