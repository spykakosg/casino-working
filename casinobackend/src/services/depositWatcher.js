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
  return Boolean(url) && !url.includes("YOUR_ALCHEMY_KEY");
}

function createEvmProvider(url) {
  if (url.startsWith("ws://") || url.startsWith("wss://")) {
    return new ethers.WebSocketProvider(url);
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

  console.log(`👁  EVM watcher started (${isTestnet ? "testnet" : "Polygon"}) — ${usdtEnabled ? "ETH + USDT" : "ETH only"}`);

  // Watch USDT ERC-20 Transfer events
  if (usdtEnabled) {
    const contract = new ethers.Contract(usdtContract, ERC20_ABI, provider);

    contract.on("Transfer", async (from, to, value, event) => {
      try {
        const address = to.toLowerCase();
        const userRes = await pool.query(
          `SELECT user_id, currency FROM wallets
           WHERE LOWER(deposit_address) = $1
             AND currency = ANY($2::text[])
           ORDER BY CASE WHEN currency = 'USDT' THEN 0 ELSE 1 END
           LIMIT 1`,
          [address, ["USDT", "USDT_POLYGON"]]
        );
        if (userRes.rows.length === 0) return;

        const { user_id, currency } = userRes.rows[0];
        const amount  = parseFloat(ethers.formatUnits(value, 6)); // USDT = 6 decimals
        const txHash  = event?.log?.transactionHash || null;

        console.log(`💰 ${currency} deposit: ${amount} USDT → user ${user_id}`);
        await creditDeposit(user_id, currency, amount, txHash, from, to);
      } catch (err) {
        console.error("USDT Transfer handler error:", err);
      }
    });
  }

  // Watch native ETH by scanning each new block
  async function processBlock(blockNumber) {
    const block = await provider.getBlock(blockNumber, true);
    if (!block?.transactions) return;

    for (const txRef of block.transactions) {
      let tx = typeof txRef === "string" ? await provider.getTransaction(txRef) : txRef;
      if (!tx || !tx.to || tx.value === 0n) continue;

      const address = tx.to.toLowerCase();
      const userRes = await pool.query(
        `SELECT user_id, currency FROM wallets
         WHERE LOWER(deposit_address) = $1
           AND currency = ANY($2::text[])
         ORDER BY CASE WHEN currency = 'ETH_POLYGON' THEN 0 ELSE 1 END
         LIMIT 1`,
        [address, ["ETH_POLYGON", "ETH"]]
      );
      if (userRes.rows.length === 0) continue;

      const { user_id, currency } = userRes.rows[0];
      const amount = parseFloat(ethers.formatEther(tx.value));

      console.log(`💰 ${currency} deposit: ${amount} ETH → user ${user_id}`);
      await creditDeposit(user_id, currency, amount, tx.hash, tx.from, tx.to);
    }
  }

  provider.on("block", async (blockNumber) => {
    try {
      await processBlock(blockNumber);
    } catch (err) {
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
