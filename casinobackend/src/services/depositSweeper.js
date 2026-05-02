/**
 * Deposit Sweeper
 *
 * Sweeps BTC/ETH/USDT funds from user deposit addresses into house hot wallets.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const pool = require("../db/pool");
const { getHotWalletSnapshot } = require("./hotWallet");

async function runSweepCycle() {
  const snapshot = await getHotWalletSnapshot();
  console.log(`🧹 Sweep cycle (${snapshot.mode}) hot BTC=${snapshot.btc.balance ?? "?"} ETH=${snapshot.evm.nativeBalance ?? "?"} USDT=${snapshot.evm.usdtBalance ?? "?"}`);
  // Placeholder: chain-specific sweeping transactions should be implemented here.
  // This service intentionally starts with visibility/logging and can be extended
  // with per-chain transfer execution as a controlled rollout.
}

async function main() {
  const ms = parseInt(process.env.DEPOSIT_SWEEPER_POLL_MS || "120000", 10);
  console.log(`🧹 Deposit sweeper started, interval=${ms}ms`);
  while (true) {
    try {
      await runSweepCycle();
    } catch (err) {
      console.error("deposit sweeper cycle error:", err.message);
    }
    await new Promise((r) => setTimeout(r, ms));
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("deposit sweeper fatal:", err);
    process.exit(1);
  });
}

module.exports = { runSweepCycle };
