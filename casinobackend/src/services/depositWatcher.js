/**
 * Deposit Watcher Service
 *
 * Monitors blockchain addresses for incoming deposits and credits
 * user internal balances when confirmed.
 *
 * Supported:
 *  - USDT on Polygon (ERC-20 via Alchemy)
 *  - ETH on Polygon (native via Alchemy)
 *  - BTC (via polling a block explorer API)
 *
 * Run this as a separate process: node src/services/depositWatcher.js
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const { ethers } = require("ethers");
const pool = require("../db/pool");
const { ensureAllDepositAddresses } = require("./addressGenerator");

const CONFIRMATIONS_REQUIRED = {
  USDT: 2,
  ETH_POLYGON: 2,
  BTC: 3,
};

const IS_TESTNET = String(process.env.TESTNET_MODE || "").toLowerCase() === "true";
// Mainnet default; override in testnet with TESTNET_USDT_CONTRACT
const USDT_CONTRACT = process.env.TESTNET_USDT_CONTRACT || "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";
// ERC-20 Transfer event ABI (minimal)
const ERC20_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function decimals() view returns (uint8)",
];

function hasUsableAlchemyUrl() {
  const url = (IS_TESTNET ? process.env.TESTNET_EVM_RPC_URL : process.env.ALCHEMY_POLYGON_URL || "").trim();
  if (!url) return false;
  if (url.includes("YOUR_ALCHEMY_KEY")) return false;
  return true;
}

function isLikelyBitcoinAddress(address) {
  if (!address) return false;
  if (address.includes("placeholder")) return false;
  return /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{20,}$/i.test(address);
}

// ─── Polygon (ETH + USDT) ─────────────────────────────────────────────────────
async function watchPolygon() {
  if (!hasUsableAlchemyUrl()) {
    console.warn("⚠️  ALCHEMY_POLYGON_URL missing/invalid (or still using YOUR_ALCHEMY_KEY) — Polygon watcher disabled");
    return;
  }

  const evmRpcUrl = IS_TESTNET ? process.env.TESTNET_EVM_RPC_URL : process.env.ALCHEMY_POLYGON_URL;
  const provider = new ethers.JsonRpcProvider(evmRpcUrl);
  const usdtContract = new ethers.Contract(USDT_CONTRACT, ERC20_ABI, provider);

  console.log(`👁  Watching ${IS_TESTNET ? "EVM testnet" : "Polygon"} (ETH + USDT)...`);

  // Watch USDT transfers
  usdtContract.on("Transfer", async (from, to, value) => {
    try {
      const address = to.toLowerCase();
      const userRes = await pool.query(
        "SELECT user_id FROM wallets WHERE LOWER(deposit_address) = $1 AND currency = 'USDT'",
        [address]
      );
      if (userRes.rows.length === 0) return;

      const userId = userRes.rows[0].user_id;
      const amount = parseFloat(ethers.formatUnits(value, 6)); // USDT has 6 decimals

      console.log(`💰 USDT deposit detected: ${amount} USDT → user ${userId}`);
      await creditDeposit(userId, "USDT", amount, null, from, to);
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

// ─── Bitcoin ──────────────────────────────────────────────────────────────────
async function watchBitcoin() {
  console.log("👁  Watching Bitcoin — polling every 60s...");

  async function poll() {
    try {
      const walletsRes = await pool.query(
        "SELECT user_id, deposit_address FROM wallets WHERE currency = 'BTC' AND deposit_address IS NOT NULL"
      );

      for (const wallet of walletsRes.rows) {
        if (!isLikelyBitcoinAddress(wallet.deposit_address)) continue;

        const base = (process.env.BTC_EXPLORER_BASE_URL || (IS_TESTNET ? "https://blockstream.info/testnet/api" : "https://blockstream.info/api")).replace(/\/$/, "");
        const url = `${base}/address/${wallet.deposit_address}/txs`;
        const resp = await fetch(url);
        const body = await resp.text();
        if (!resp.ok) {
          console.warn(`⚠️  BTC explorer error for ${wallet.deposit_address}: ${resp.status} ${body.slice(0, 120)}`);
          continue;
        }

        let txs;
        try {
          txs = JSON.parse(body);
        } catch {
          console.warn(`⚠️  BTC explorer returned non-JSON for ${wallet.deposit_address}: ${body.slice(0, 120)}`);
          continue;
        }

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
  const assigned = await ensureAllDepositAddresses();
  if (assigned > 0) {
    console.log(`🏷️  Assigned missing deposit addresses for ${assigned} user(s)`);
  }
  await Promise.all([
    watchPolygon(),
    watchBitcoin(),
  ]);
}

start().catch(console.error);
