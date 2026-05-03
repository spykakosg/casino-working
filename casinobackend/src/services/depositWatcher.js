/**
 * Deposit Watcher Service
 *
 * Monitors blockchain addresses for incoming deposits and credits
 * user internal balances when confirmed.
 *
 * Supported:
 *   BTC      — polls Blockstream API every 60 s (mirrors working wallet's balance.js)
 *   USDT     — ERC-20 Transfer events via Alchemy/EVM provider
 *   ETH      — native ETH via block-by-block scan
 *
 * Run: node src/services/depositWatcher.js
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const { ethers } = require("ethers");
const pool = require("../db/pool");
const { ensureAllDepositAddresses } = require("./addressGenerator");
const { isTestnet, getEvmRpcUrl, getBtcExplorerBaseUrl, getUsdtContract } = require("../config/networkMode");

const CONFIRMATIONS_REQUIRED = { BTC: 3, USDT: 2, ETH_POLYGON: 2 };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isRealBtcAddress(address) {
  if (!address) return false;
  if (address.includes("placeholder")) return false;
  return /^(tb1|bc1|[13mn2])[a-zA-HJ-NP-Z0-9]{20,}$/i.test(address);
}

function hasUsableEvmUrl() {
  const url = getEvmRpcUrl();
  return Boolean(url) && !url.includes("YOUR_") && !url.includes("example");
}

function createEvmProvider(url) {
  if (url.startsWith("ws://") || url.startsWith("wss://")) {
    const httpUrl = url.replace(/^wss?:\/\//, "https://");
    console.warn("⚠️  WebSocket RPC URL detected for watcher; using HTTPS polling provider for stability.");
    return new ethers.JsonRpcProvider(httpUrl);
  }
  return new ethers.JsonRpcProvider(url);
}

// ─── Credit Deposit (idempotent) ─────────────────────────────────────────────

async function creditDeposit(userId, currency, amount, txHash, fromAddress, toAddress) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Idempotency — skip if already recorded
    if (txHash) {
      const existing = await client.query(
        "SELECT id FROM deposits WHERE tx_hash = $1",
        [txHash]
      );
      if (existing.rows.length > 0) {
        await client.query("ROLLBACK");
        return;
      }
    }

    await client.query(
      `INSERT INTO deposits (user_id, currency, amount, tx_hash, from_address, to_address, status, confirmed_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', NOW())
       ON CONFLICT (tx_hash) DO NOTHING`,
      [userId, currency, amount, txHash || `manual_${Date.now()}`, fromAddress || "unknown", toAddress]
    );

    await client.query(
      "UPDATE wallets SET balance = balance + $1 WHERE user_id = $2 AND currency = $3",
      [amount, userId, currency]
    );

    await client.query("COMMIT");
    console.log(`✅ Credited ${amount} ${currency} to user ${userId} (tx: ${txHash})`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("creditDeposit error:", err);
  } finally {
    client.release();
  }
}

// ─── Bitcoin Watcher — mirrors working wallet's balance.js ───────────────────

async function watchBitcoin() {
  const base = getBtcExplorerBaseUrl();
  console.log(`👁  BTC watcher started — polling ${base} every 60 s`);

  async function poll() {
    try {
      const walletRes = await pool.query(
        "SELECT user_id, deposit_address FROM wallets WHERE currency = 'BTC' AND deposit_address IS NOT NULL"
      );

      // Get current chain tip height once per poll cycle
      const tipResp = await fetch(`${base}/blocks/tip/height`);
      if (!tipResp.ok) {
        console.warn(`⚠️  BTC tip fetch failed: ${tipResp.status}`);
        setTimeout(poll, 60_000);
        return;
      }
      const tipHeight = parseInt(await tipResp.text(), 10);
      if (!Number.isFinite(tipHeight)) {
        console.warn("⚠️  BTC tip height parse failed");
        setTimeout(poll, 60_000);
        return;
      }

      for (const wallet of walletRes.rows) {
        if (!isRealBtcAddress(wallet.deposit_address)) continue;

        // Fetch transactions for this address — same endpoint as working wallet
        const txResp = await fetch(`${base}/address/${wallet.deposit_address}/txs`);
        if (!txResp.ok) {
          console.warn(`⚠️  BTC tx fetch failed for ${wallet.deposit_address}: ${txResp.status}`);
          continue;
        }

        let txs;
        try {
          txs = await txResp.json();
        } catch {
          console.warn(`⚠️  BTC non-JSON response for ${wallet.deposit_address}`);
          continue;
        }

        if (!Array.isArray(txs)) continue;

        for (const tx of txs) {
          // Only process confirmed txs with enough confirmations
          if (!tx?.status?.confirmed || !tx?.status?.block_height) continue;

          const confirmations = tipHeight - tx.status.block_height + 1;
          if (confirmations < CONFIRMATIONS_REQUIRED.BTC) continue;

          for (let voutIdx = 0; voutIdx < (tx.vout || []).length; voutIdx++) {
            const out = tx.vout[voutIdx];
            if (out.scriptpubkey_address !== wallet.deposit_address) continue;

            const amountBTC  = out.value / 100_000_000; // sats → BTC
            const txHash     = `${tx.txid}:${voutIdx}`; // unique per output

            await creditDeposit(wallet.user_id, "BTC", amountBTC, txHash, null, wallet.deposit_address);
          }
        }
      }
    } catch (err) {
      console.error("BTC watcher poll error:", err);
    }

    setTimeout(poll, 60_000);
  }

  poll();
}

// ─── EVM / Polygon Watcher (ETH + USDT) ──────────────────────────────────────

const ERC20_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function decimals() view returns (uint8)",
];

// Cache of our deposit addresses for fast lookups without per-tx DB queries
let evmDepositAddressCache = null; // Map<lowerAddress, { user_id, currency }>
let evmCacheExpiry = 0;

async function getEvmDepositAddresses() {
  const now = Date.now();
  if (evmDepositAddressCache && now < evmCacheExpiry) return evmDepositAddressCache;

  const res = await pool.query(
    `SELECT user_id, currency, deposit_address FROM wallets
     WHERE deposit_address IS NOT NULL
       AND currency = ANY($1::text[])`,
    [["ETH_POLYGON", "ETH", "USDT", "USDT_POLYGON"]]
  );

  const map = new Map();
  for (const row of res.rows) {
    const key = row.deposit_address.toLowerCase();
    // Prefer USDT over ETH if the same address serves both
    if (!map.has(key) || row.currency.startsWith("USDT")) {
      map.set(key, { user_id: row.user_id, currency: row.currency });
    }
  }
  evmDepositAddressCache = map;
  evmCacheExpiry = now + 5 * 60_000; // refresh every 5 minutes
  return map;
}

async function watchPolygon() {
  if (!hasUsableEvmUrl()) {
    console.warn("⚠️  EVM RPC URL missing or invalid — Polygon/ETH watcher disabled");
    return;
  }

  const provider      = createEvmProvider(getEvmRpcUrl());
  const usdtContract  = getUsdtContract();
  const usdtEnabled   = Boolean(usdtContract);

  if (!usdtEnabled && isTestnet) {
    console.warn("⚠️  TESTNET_USDT_CONTRACT not set — USDT watcher disabled");
  }

  // Catch unhandled WebSocket-level errors so the process doesn't crash
  process.on("uncaughtException", (err) => {
    const msg = String(err?.message || err);
    if (msg.includes("WS_ERR") || msg.includes("WebSocket")) {
      console.warn("⚠️  WebSocket error caught — EVM watcher will attempt reconnect:", msg);
      return;
    }
    // Re-throw non-WebSocket uncaught exceptions
    console.error("Uncaught exception:", err);
    process.exit(1);
  });

  try {
    await provider.getNetwork();
  } catch (err) {
    const msg = String(err?.shortMessage || err?.message || err);
    if (msg.includes("exceeded maximum retry limit") || msg.includes("429") || msg.includes("Monthly capacity")) {
      console.warn("⚠️  EVM watcher disabled: RPC rate limit / monthly cap exceeded. Upgrade your Alchemy plan or use a different RPC URL.");
      return;
    }
    console.warn(`⚠️  EVM watcher disabled: RPC startup failed (${msg})`);
    return;
  }

  console.log(`👁  EVM watcher started (${isTestnet ? "testnet" : "Polygon"}) — ${usdtEnabled ? "ETH + USDT" : "ETH only"}`);

  // Watch USDT ERC-20 Transfer events (uses a single persistent filter — far cheaper than polling)
  if (usdtEnabled) {
    const contract = new ethers.Contract(usdtContract, ERC20_ABI, provider);

    contract.on("Transfer", async (from, to, value, event) => {
      try {
        const address = to.toLowerCase();
        const addrMap = await getEvmDepositAddresses();
        const wallet  = addrMap.get(address);
        if (!wallet) return;

        const { user_id, currency } = wallet;
        const amount  = parseFloat(ethers.formatUnits(value, 6)); // USDT = 6 decimals
        const txHash  = event?.log?.transactionHash || null;

        console.log(`💰 ${currency} deposit: ${amount} USDT → user ${user_id}`);
        await creditDeposit(user_id, currency, amount, txHash, from, to);
      } catch (err) {
        console.error("USDT Transfer handler error:", err);
      }
    });
  }

  // Watch native ETH by scanning each new block.
  //
  // KEY FIX: ethers v6's getBlock(n, true) returns full tx objects in
  // block.prefetchedTransactions — NOT in block.transactions (which only has
  // hashes). The old code fetched block.transactions and then called
  // getTransaction() for every hash, creating hundreds of RPC calls per block
  // and triggering the 429 rate-limit storm. Now we use prefetchedTransactions
  // so the entire block costs exactly ONE RPC call.
  async function processBlock(blockNumber) {
    const block = await provider.getBlock(blockNumber, true); // true = prefetch txs
    if (!block) return;

    // Use prefetchedTransactions (full objects) — fall back to hashes only if missing
    const txList = block.prefetchedTransactions ?? [];
    if (txList.length === 0) return;

    const addrMap = await getEvmDepositAddresses();
    if (addrMap.size === 0) return;

    for (const tx of txList) {
      if (!tx || !tx.to || tx.value === 0n) continue;

      const wallet = addrMap.get(tx.to.toLowerCase());
      if (!wallet) continue;

      const { user_id, currency } = wallet;
      const amount = parseFloat(ethers.formatEther(tx.value));

      console.log(`💰 ${currency} deposit: ${amount} ETH → user ${user_id}`);
      await creditDeposit(user_id, currency, amount, tx.hash, tx.from, tx.to);
    }
  }

  provider.on("error", (err) => {
    const msg = String(err?.shortMessage || err?.message || err);
    if (
      msg.includes("exceeded maximum retry limit") ||
      msg.includes("Monthly capacity") ||
      msg.includes("429")
    ) {
      console.warn("⚠️  EVM watcher RPC rate-limited / monthly cap hit. Upgrade Alchemy plan or switch RPC.");
      return;
    }
    console.error("EVM provider error:", msg);
  });

  provider.on("block", async (blockNumber) => {
    try {
      await processBlock(blockNumber);
    } catch (err) {
      const msg = String(err?.shortMessage || err?.message || err);
      if (msg.includes("429") || msg.includes("Monthly capacity")) {
        console.warn("⚠️  ETH block watcher skipping block due to rate limit:", blockNumber);
        return;
      }
      console.error("ETH block watcher error:", err);
    }
  });
}

// ─── Start ────────────────────────────────────────────────────────────────────

async function start() {
  console.log("🔍 Deposit watcher starting...");

  const assigned = await ensureAllDepositAddresses();
  if (assigned > 0) {
    console.log(`🏷️  Assigned missing deposit addresses for ${assigned} user(s)`);
  }

  await Promise.all([
    watchBitcoin(),
    watchPolygon(),
  ]);
}

start().catch((err) => { console.error(err); process.exit(1); });
