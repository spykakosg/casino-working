/**
 * Deposit Sweeper
 *
 * Sweeps BTC/ETH/USDT funds from user deposit addresses into house hot wallets.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const { ethers } = require("ethers");
const pool = require("../db/pool");
const { getHotWalletSnapshot } = require("./hotWallet");
const { getEvmRpcUrl, getUsdtContract } = require("../config/networkMode");

function getMnemonic() {
  return (process.env.WALLET_MNEMONIC || "").trim().toLowerCase();
}

function deriveUserEvmWallet(userId, slotOffset, provider) {
  const mnemonic = getMnemonic();
  const base = Number(userId) * 10;
  const path = `m/44'/60'/0'/0/${base + slotOffset}`;
  return ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, path).connect(provider);
}

async function sweepUserEth(wallet, hotAddress, provider) {
  const bal = await provider.getBalance(wallet.address);
  if (bal <= 0n) return null;
  const feeData = await provider.getFeeData();
  const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || ethers.parseUnits("0.03", "gwei");
  const maxFeePerGas = feeData.maxFeePerGas || (maxPriorityFeePerGas * 2n);
  const gasLimit = 21_000n;
  const fee = gasLimit * maxFeePerGas;
  if (bal <= fee) return null;
  const value = bal - fee;
  const tx = await wallet.sendTransaction({ to: hotAddress, value, maxFeePerGas, maxPriorityFeePerGas, gasLimit });
  return { hash: tx.hash, amount: ethers.formatEther(value) };
}

async function sweepUserUsdt(wallet, hotAddress, provider, usdt) {
  if (!usdt) return null;
  const token = new ethers.Contract(usdt, ["function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)", "function decimals() view returns (uint8)"], wallet);
  const bal = await token.balanceOf(wallet.address);
  if (bal <= 0n) return null;
  const tx = await token.transfer(hotAddress, bal);
  return { hash: tx.hash, amountRaw: bal.toString() };
}

async function runSweepCycle() {
  const snapshot = await getHotWalletSnapshot();
  console.log(`🧹 Sweep cycle (${snapshot.mode}) hot BTC=${snapshot.btc.balance ?? "?"} ETH=${snapshot.evm.nativeBalance ?? "?"} USDT=${snapshot.evm.usdtBalance ?? "?"}`);
  const rpcUrl = getEvmRpcUrl();
  const usdt = getUsdtContract();
  const hasUsableRpc = Boolean(rpcUrl) && !rpcUrl.includes("YOUR_") && !rpcUrl.includes("example");
  if (!hasUsableRpc || !snapshot.evm?.address) {
    console.log("ℹ️  EVM sweep skipped: missing RPC URL or EVM hot-wallet address.");
    console.log("ℹ️  BTC sweep is not enabled yet in this service.");
    return;
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  try {
    await provider.getNetwork();
  } catch (err) {
    const msg = String(err?.shortMessage || err?.message || err);
    if (msg.includes("exceeded maximum retry limit") || msg.includes("429")) {
      console.warn("⚠️  Sweeper paused: EVM RPC rate limit exceeded (429).");
      return;
    }
    console.warn(`⚠️  Sweeper paused: EVM RPC startup failed (${msg}).`);
    return;
  }

  const users = await pool.query("SELECT DISTINCT user_id FROM wallets WHERE currency IN ('ETH_POLYGON','USDT') ORDER BY user_id ASC");

  let stopForRateLimit = false;
  for (const { user_id } of users.rows) {
    if (stopForRateLimit) break;
    try {
      const ethWallet = deriveUserEvmWallet(user_id, 0, provider);
      const usdtWallet = deriveUserEvmWallet(user_id, 1, provider);

      const ethSweep = await sweepUserEth(ethWallet, snapshot.evm.address, provider);
      if (ethSweep) console.log(`✅ Swept ETH user=${user_id} amount=${ethSweep.amount} tx=${ethSweep.hash}`);

      const usdtSweep = await sweepUserUsdt(usdtWallet, snapshot.evm.address, provider, usdt);
      if (usdtSweep) console.log(`✅ Swept USDT user=${user_id} amountRaw=${usdtSweep.amountRaw} tx=${usdtSweep.hash}`);
    } catch (err) {
      const msg = String(err?.shortMessage || err?.message || err);
      if (msg.includes("exceeded maximum retry limit") || msg.includes("429")) {
        console.warn("⚠️  Sweeper hit RPC rate limit mid-cycle; stopping remaining users this cycle.");
        stopForRateLimit = true;
      } else {
        console.warn(`Sweep failed for user ${user_id}: ${msg}`);
      }
    }
  }
  console.log("ℹ️  BTC sweep is not enabled yet in this service.");
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
