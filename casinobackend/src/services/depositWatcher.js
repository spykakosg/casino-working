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
const { isTestnet, getEvmRpcUrl, getBtcExplorerBaseUrl, getUsdtContract } = require("../config/networkMode");

const ETH_BACKFILL_BLOCKS = parseInt(process.env.ETH_BACKFILL_BLOCKS || "5000", 10);
const cliTxHashes = process.argv.slice(2).map((s) => s.trim()).filter((s) => s.startsWith("0x"));
const envTxHashes = (process.env.ETH_BACKFILL_TX_HASHES || "").split(",").map((s) => s.trim()).filter(Boolean);
const ETH_BACKFILL_TX_HASHES = [...new Set([...envTxHashes, ...cliTxHashes])];

const CONFIRMATIONS_REQUIRED = {
  USDT: 2,
  ETH_POLYGON: 2,
  BTC: 3,
};

const IS_TESTNET = isTestnet;
const USDT_CONTRACT = getUsdtContract();
// ERC-20 Transfer event ABI (minimal)

const WATCHER_DEBUG = true;

function debugLog(...args) {
  console.log("[watcher:debug]", ...args);
}

const ERC20_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function decimals() view returns (uint8)",
];

function hasUsableAlchemyUrl() {
  const url = getEvmRpcUrl();
  if (!url) return false;
  if (url.includes("YOUR_ALCHEMY_KEY")) return false;
  return true;
}


function createEvmProvider(url) {
  if (url.startsWith("ws://") || url.startsWith("wss://")) {
    return new ethers.WebSocketProvider(url);
  }
  return new ethers.JsonRpcProvider(url);
}

function isLikelyBitcoinAddress(address) {
  if (!address) return false;
  if (address.includes("placeholder")) return false;
  return /^(tb1|bc1|[13mn2])[a-zA-HJ-NP-Z0-9]{20,}$/i.test(address);
}

// ─── Polygon (ETH + USDT) ─────────────────────────────────────────────────────

async function logTrackedEvmAddresses() {
  try {
    const res = await pool.query(
      `SELECT user_id, currency, deposit_address
       FROM wallets
       WHERE currency = ANY($1::text[])
         AND deposit_address IS NOT NULL
         AND deposit_address <> ''
       ORDER BY user_id ASC, currency ASC
       LIMIT 50`,
      [["ETH_POLYGON", "ETH_SEPOLIA", "ETH", "USDT", "USDT_POLYGON", "USDT_TRON"]]
    );
    debugLog(`Tracked EVM deposit addresses (showing ${res.rows.length}):`, res.rows);
  } catch (err) {
    console.error("Failed to load tracked EVM addresses for debug:", err.message);
  }
}


async function resolveTransactionWithRetry(provider, txRef, attempts = 3, delayMs = 400) {
  if (typeof txRef !== "string") return txRef;
  for (let i = 0; i < attempts; i++) {
    const tx = await provider.getTransaction(txRef);
    if (tx) return tx;
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return null;
}

async function watchPolygon() {
  if (!hasUsableAlchemyUrl()) {
    console.warn("⚠️  ALCHEMY_POLYGON_URL missing/invalid (or still using YOUR_ALCHEMY_KEY) — Polygon watcher disabled");
    return;
  }

  const evmRpcUrl = getEvmRpcUrl();
  const provider = createEvmProvider(evmRpcUrl);
  debugLog("EVM RPC URL configured", evmRpcUrl ? "yes" : "no");
  const usdtWatcherEnabled = Boolean(USDT_CONTRACT);
  if (!usdtWatcherEnabled && IS_TESTNET) {
    console.warn("⚠️  TESTNET_USDT_CONTRACT not set — USDT transfer watcher disabled in testnet mode");
  }

  console.log(`👁  Watching ${IS_TESTNET ? "EVM testnet" : "Polygon mainnet"} (${usdtWatcherEnabled ? "ETH + USDT" : "ETH only"})...`);

  // Watch USDT transfers
  if (usdtWatcherEnabled) {
    const usdtContract = new ethers.Contract(USDT_CONTRACT, ERC20_ABI, provider);
    usdtContract.on("Transfer", async (from, to, value, event) => {
    try {
      const address = to.toLowerCase();
      debugLog("USDT Transfer seen", { from, to, value: value?.toString?.() });
      const userRes = await pool.query(
        `SELECT user_id, currency
         FROM wallets
         WHERE LOWER(deposit_address) = $1
           AND currency = ANY($2::text[])
         ORDER BY CASE
           WHEN currency = 'USDT' THEN 0
           WHEN currency = 'USDT_POLYGON' THEN 1
           WHEN currency = 'USDT_TRON' THEN 2
           ELSE 3
         END
         LIMIT 1`,
        [address, ["USDT", "USDT_POLYGON", "USDT_TRON"]]
      );
      if (userRes.rows.length === 0) {
        debugLog("USDT transfer did not match a wallet", address);
        return;
      }

      const { user_id: userId, currency: matchedCurrency } = userRes.rows[0];
      const amount = parseFloat(ethers.formatUnits(value, 6)); // USDT has 6 decimals

      console.log(`💰 ${matchedCurrency} deposit detected: ${amount} USDT → user ${userId}`);
      const txHash = event?.log?.transactionHash || event?.transactionHash || null;
      await creditDeposit(userId, matchedCurrency, amount, txHash, from, to);
    } catch (err) {
      console.error("USDT transfer handler error:", err);
    }
    });
  }

  async function processEthTransaction(tx, txHashFallback = null) {
    if (!tx || !tx.to || tx.value === 0n) {
      debugLog("Skipping tx without payable recipient/value", txHashFallback || tx?.hash);
      return;
    }
    const address = tx.to.toLowerCase();

    const userRes = await pool.query(
      `SELECT user_id, currency
       FROM wallets
       WHERE LOWER(deposit_address) = $1
         AND currency = ANY($2::text[])
       ORDER BY CASE
         WHEN currency = 'ETH_POLYGON' THEN 0
         WHEN currency = 'ETH_SEPOLIA' THEN 1
         WHEN currency = 'ETH' THEN 2
         ELSE 3
       END
       LIMIT 1`,
      [address, ["ETH_POLYGON", "ETH_SEPOLIA", "ETH"]]
    );
    if (userRes.rows.length === 0) {
      debugLog("ETH tx did not match a wallet", tx.hash || txHashFallback, address);
      return;
    }

    const { user_id: userId, currency: matchedCurrency } = userRes.rows[0];
    const amount = parseFloat(ethers.formatEther(tx.value));

    console.log(`💰 ${matchedCurrency} deposit detected: ${amount} ETH → user ${userId}`);
    await creditDeposit(userId, matchedCurrency, amount, tx.hash || txHashFallback, tx.from, tx.to);
  }

  async function processEthBlock(blockNumber) {
    const block = await provider.getBlock(blockNumber, true);
    debugLog("Processing block", blockNumber);
    if (!block || !block.transactions) return;

    for (const txRef of block.transactions) {
      const tx = await resolveTransactionWithRetry(provider, txRef);
      if (!tx && typeof txRef === "string") {
        debugLog("Transaction not yet available after retries", txRef);
      }
      await processEthTransaction(tx, typeof txRef === "string" ? txRef : txRef?.hash);
    }
  }

  for (const txHash of ETH_BACKFILL_TX_HASHES) {
    try {
      const tx = await provider.getTransaction(txHash);
      if (!tx) {
        console.warn(`⚠️ ETH backfill tx not found: ${txHash}`);
        continue;
      }
      console.log(`🔁 Backfilling specific ETH tx ${txHash}...`);
      await processEthTransaction(tx, txHash);
    } catch (err) {
      console.error(`ETH tx backfill error for ${txHash}:`, err.message || err);
    }
  }

  if (ETH_BACKFILL_BLOCKS > 0) {
    const latest = await provider.getBlockNumber();
    const start = Math.max(0, latest - ETH_BACKFILL_BLOCKS + 1);
    console.log(`🔁 Backfilling ETH blocks ${start}..${latest} before live watch...`);
    for (let b = start; b <= latest; b++) {
      try {
        await processEthBlock(b);
      } catch (err) {
        console.error(`ETH backfill block ${b} error:`, err.message || err);
      }
    }
  }

  // Watch native ETH transfers by polling each new block
  provider.on("block", async (blockNumber) => {
    try {
      await processEthBlock(blockNumber);
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

        const tipResp = await fetch(`${base}/blocks/tip/height`);
        const tipText = await tipResp.text();
        const tipHeight = parseInt(tipText, 10);
        if (!Number.isFinite(tipHeight)) {
          console.warn(`⚠️  BTC tip height parse failed: ${tipText}`);
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
          if (!tx?.status?.confirmed || !tx?.status?.block_height) continue;
          const confirmations = Math.max(0, tipHeight - tx.status.block_height + 1);
          if (confirmations < CONFIRMATIONS_REQUIRED.BTC) continue;

          for (let voutIndex = 0; voutIndex < (tx.vout || []).length; voutIndex++) {
            const out = tx.vout[voutIndex];
            if (out.scriptpubkey_address !== wallet.deposit_address) continue;
            const amount = out.value / 100_000_000;
            const txHash = `${tx.txid}:${voutIndex}`;
            await creditDeposit(wallet.user_id, "BTC", amount, txHash, null, wallet.deposit_address);
          }
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

    debugLog("creditDeposit called", { userId, currency, amount, txHash });

    // Idempotency check — skip if tx already recorded
    if (txHash) {
      const existing = await client.query(
        "SELECT id FROM deposits WHERE tx_hash = $1",
        [txHash]
      );
      if (existing.rows.length > 0) {
        await client.query("ROLLBACK");
        debugLog("Skipping already-processed tx", txHash);
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

async function logDbIdentity() {
  try {
    const res = await pool.query("SELECT current_database() AS db, current_user AS db_user, inet_server_addr()::text AS host, inet_server_port() AS port");
    console.log("🗄️ Watcher DB target:", res.rows[0]);
  } catch (err) {
    console.warn("⚠️ Unable to read DB identity:", err.message);
  }
}

async function start() {
  console.log("🔍 Starting deposit watcher service...");
  console.log(`🐞 WATCHER_DEBUG=${WATCHER_DEBUG ? "enabled" : "disabled"}`);
  await logDbIdentity();
  const assigned = await ensureAllDepositAddresses();
  await logTrackedEvmAddresses();
  if (assigned > 0) {
    console.log(`🏷️  Assigned missing deposit addresses for ${assigned} user(s)`);
  }
  await Promise.all([
    watchPolygon(),
    watchBitcoin(),
  ]);
}

start().catch(console.error);
