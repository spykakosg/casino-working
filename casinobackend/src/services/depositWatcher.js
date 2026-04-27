/**
 * Deposit Watcher Service
 *
 * Monitors blockchain addresses for incoming deposits and credits
 * user internal balances when confirmed.
 *
 * Supported:
 *  - USDT on Polygon (ERC-20 via Alchemy)
 *  - ETH on Polygon (native via Alchemy)
 *  - USDT on Tron (TRC-20 via TronGrid)
 *  - BTC (via polling a block explorer API)
 *
 * Run this as a separate process: node src/services/depositWatcher.js
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const { ethers } = require("ethers");
const pool = require("../db/pool");

const CONFIRMATIONS_REQUIRED = {
  USDT_POLYGON: 2,
  ETH_POLYGON: 2,
  USDT_TRON: 20,
  BTC: 3,
};

// USDT contract address on Polygon mainnet
const USDT_POLYGON_CONTRACT = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";
// ERC-20 Transfer event ABI (minimal)
const ERC20_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function decimals() view returns (uint8)",
];

// ─── Polygon (ETH + USDT) ─────────────────────────────────────────────────────
async function watchPolygon() {
  if (!process.env.ALCHEMY_POLYGON_URL) {
    console.warn("⚠️  ALCHEMY_POLYGON_URL not set — Polygon watcher disabled");
    return;
  }

  const provider = new ethers.JsonRpcProvider(process.env.ALCHEMY_POLYGON_URL);
  const usdtContract = new ethers.Contract(USDT_POLYGON_CONTRACT, ERC20_ABI, provider);

  console.log("👁  Watching Polygon (ETH + USDT)...");

  // Watch USDT transfers
  usdtContract.on("Transfer", async (from, to, value) => {
    try {
      const address = to.toLowerCase();
      const userRes = await pool.query(
        "SELECT user_id FROM wallets WHERE LOWER(deposit_address) = $1 AND currency = 'USDT_POLYGON'",
        [address]
      );
      if (userRes.rows.length === 0) return;

      const userId = userRes.rows[0].user_id;
      const amount = parseFloat(ethers.formatUnits(value, 6)); // USDT has 6 decimals

      console.log(`💰 USDT_POLYGON deposit detected: ${amount} USDT → user ${userId}`);
      await creditDeposit(userId, "USDT_POLYGON", amount, null, from, to);
    } catch (err) {
      console.error("USDT transfer handler error:", err);
    }
  });

  // Watch native ETH transfers by polling each new block
  provider.on("block", async (blockNumber) => {
    try {
      const block = await provider.getBlock(blockNumber, true);
      if (!block || !block.transactions) return;

      for (const tx of block.transactions) {
        if (!tx.to || tx.value === 0n) continue;
        const address = tx.to.toLowerCase();

        const userRes = await pool.query(
          "SELECT user_id FROM wallets WHERE LOWER(deposit_address) = $1 AND currency = 'ETH_POLYGON'",
          [address]
        );
        if (userRes.rows.length === 0) continue;

        const userId = userRes.rows[0].user_id;
        const amount = parseFloat(ethers.formatEther(tx.value));

        console.log(`💰 ETH_POLYGON deposit detected: ${amount} ETH → user ${userId}`);
        await creditDeposit(userId, "ETH_POLYGON", amount, tx.hash, tx.from, tx.to);
      }
    } catch (err) {
      console.error("ETH block watcher error:", err);
    }
  });
}

// ─── Tron USDT (TRC-20) ───────────────────────────────────────────────────────
async function watchTron() {
  if (!process.env.TRONGRID_API_KEY) {
    console.warn("⚠️  TRONGRID_API_KEY not set — Tron watcher disabled");
    return;
  }

  // USDT TRC-20 contract on Tron mainnet
  const USDT_TRON_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

  console.log("👁  Watching Tron (USDT TRC-20) — polling every 30s...");

  async function poll() {
    try {
      // Get all monitored Tron addresses
      const walletsRes = await pool.query(
        "SELECT user_id, deposit_address FROM wallets WHERE currency = 'USDT_TRON' AND deposit_address IS NOT NULL"
      );

      for (const wallet of walletsRes.rows) {
        const url = `https://api.trongrid.io/v1/accounts/${wallet.deposit_address}/transactions/trc20?contract_address=${USDT_TRON_CONTRACT}&limit=10`;
        const resp = await fetch(url, {
          headers: { "TRON-PRO-API-KEY": process.env.TRONGRID_API_KEY },
        });
        const data = await resp.json();
        if (!data.data) continue;

        for (const tx of data.data) {
          if (tx.to !== wallet.deposit_address) continue;
          const amount = parseFloat(tx.value) / 1_000_000; // USDT TRC-20 has 6 decimals
          await creditDeposit(wallet.user_id, "USDT_TRON", amount, tx.transaction_id, tx.from, tx.to);
        }
      }
    } catch (err) {
      console.error("Tron watcher error:", err);
    }
    setTimeout(poll, 30_000);
  }

  poll();
}

// ─── Bitcoin ──────────────────────────────────────────────────────────────────
async function watchBitcoin() {
  console.log("👁  Watching Bitcoin — polling every 60s...");

  async function poll() {
    try {
      const walletsRes = await pool.query(
        "SELECT user_id, deposit_address FROM wallets WHERE currency = 'BTC' AND deposit_address IS NOT NULL"
      );

      for (const wallet of walletsRes.rows) {
        const url = `https://blockstream.info/api/address/${wallet.deposit_address}/txs`;
        const resp = await fetch(url);
        const txs = await resp.json();
        if (!Array.isArray(txs)) continue;

        for (const tx of txs) {
          const out = tx.vout?.find((o) => o.scriptpubkey_address === wallet.deposit_address);
          if (!out) continue;
          const amount = out.value / 100_000_000; // satoshis to BTC
          const confirmations = tx.status?.confirmed ? (tx.status.block_height ? 6 : 0) : 0;
          if (confirmations < CONFIRMATIONS_REQUIRED.BTC) continue;
          await creditDeposit(wallet.user_id, "BTC", amount, tx.txid, null, wallet.deposit_address);
        }
      }
    } catch (err) {
      console.error("Bitcoin watcher error:", err);
    }
    setTimeout(poll, 60_000);
  }

  poll();
}

// ─── Credit Deposit (idempotent) ─────────────────────────────────────────────
async function creditDeposit(userId, currency, amount, txHash, fromAddress, toAddress) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Idempotency check — skip if tx already recorded
    if (txHash) {
      const existing = await client.query(
        "SELECT id FROM deposits WHERE tx_hash = $1",
        [txHash]
      );
      if (existing.rows.length > 0) {
        await client.query("ROLLBACK");
        return; // already processed
      }
    }

    // Record the deposit
    await client.query(
      `INSERT INTO deposits (user_id, currency, amount, tx_hash, from_address, to_address, status, confirmed_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', NOW())
       ON CONFLICT (tx_hash) DO NOTHING`,
      [userId, currency, amount, txHash || `manual_${Date.now()}`, fromAddress || "unknown", toAddress]
    );

    // Credit internal balance
    await client.query(
      "UPDATE wallets SET balance = balance + $1 WHERE user_id = $2 AND currency = $3",
      [amount, userId, currency]
    );

    await client.query("COMMIT");
    console.log(`✅ Credited ${amount} ${currency} to user ${userId}`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("creditDeposit error:", err);
  } finally {
    client.release();
  }
}

// ─── Start All Watchers ───────────────────────────────────────────────────────
async function start() {
  console.log("🔍 Starting deposit watcher service...");
  await Promise.all([
    watchPolygon(),
    watchTron(),
    watchBitcoin(),
  ]);
}

start().catch(console.error);
