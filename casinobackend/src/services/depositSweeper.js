/**
 * Deposit Sweeper
 *
 * Sweeps BTC/ETH/USDT funds from user deposit addresses into house hot wallets.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const { ethers } = require("ethers");
const bitcoin = require("bitcoinjs-lib");
const bip39 = require("bip39");
const ecc = require("tiny-secp256k1");
const { BIP32Factory } = require("bip32");
const { ECPairFactory } = require("ecpair");
const pool = require("../db/pool");
const { getHotWalletSnapshot, getBtcHotWallet } = require("./hotWallet");
const { getEvmRpcUrl, getUsdtContract, getBtcExplorerBaseUrl, isTestnet } = require("../config/networkMode");
bitcoin.initEccLib(ecc);
const bip32 = BIP32Factory(ecc);
const ECPair = ECPairFactory(ecc);

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

async function sweepBtcUsersToHotWallet() {
  const mnemonic = getMnemonic();
  if (!mnemonic || !bip39.validateMnemonic(mnemonic)) return;
  const { address: hotBtc } = await getBtcHotWallet();
  const base = getBtcExplorerBaseUrl().replace(/\/$/, "");
  const network = isTestnet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;
  const coin = isTestnet ? 1 : 0;
  const feeJson = await (await fetch(`${base}/fee-estimates`)).json();
  const feeRate = Math.max(Number(process.env.BTC_MIN_SAT_PER_VB || "1"), Math.floor(Number(feeJson["6"] || feeJson["3"] || feeJson["1"] || 1)));
  const users = await pool.query("SELECT user_id, deposit_address FROM wallets WHERE currency = 'BTC' AND deposit_address IS NOT NULL");
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const root = bip32.fromSeed(seed, network);
  for (const { user_id, deposit_address } of users.rows) {
    const utxoResp = await fetch(`${base}/address/${deposit_address}/utxo`);
    if (!utxoResp.ok) continue;
    const utxos = await utxoResp.json();
    if (!Array.isArray(utxos) || utxos.length === 0) continue;
    const child = root.derivePath(`m/84'/${coin}'/0'/0/${Number(user_id) * 10 + 2}`);
    const keyPair = ECPair.fromWIF(child.toWIF(), network);
    const total = utxos.reduce((sum, u) => sum + Number(u.value || 0), 0);
    const fee = Math.ceil((10 + (utxos.length * 68) + 31) * feeRate);
    const sendValue = total - fee;
    if (sendValue <= 546) continue;
    const psbt = new bitcoin.Psbt({ network });
    for (const u of utxos) {
      psbt.addInput({ hash: u.txid, index: u.vout, witnessUtxo: { script: bitcoin.address.toOutputScript(deposit_address, network), value: u.value } });
    }
    psbt.addOutput({ address: hotBtc, value: sendValue });
    psbt.signAllInputs(keyPair);
    psbt.finalizeAllInputs();
    const txHex = psbt.extractTransaction().toHex();
    const resp = await fetch(`${base}/tx`, { method: "POST", body: txHex });
    const txid = (await resp.text()).trim();
    if (resp.ok) console.log(`✅ Swept BTC user=${user_id} sats=${sendValue} tx=${txid}`);
  }
}

async function runSweepCycle() {
  const snapshot = await getHotWalletSnapshot();
  console.log(`🧹 Sweep cycle (${snapshot.mode}) hot BTC=${snapshot.btc.balance ?? "?"} ETH=${snapshot.evm.nativeBalance ?? "?"} USDT=${snapshot.evm.usdtBalance ?? "?"}`);
  const rpcUrl = getEvmRpcUrl();
  const usdt = getUsdtContract();
  const hasUsableRpc = Boolean(rpcUrl) && !rpcUrl.includes("YOUR_") && !rpcUrl.includes("example");
  if (hasUsableRpc && snapshot.evm?.address) {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    try {
      await provider.getNetwork();
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
          if (msg.includes("exceeded maximum retry limit") || msg.includes("429")) stopForRateLimit = true;
          else console.warn(`Sweep failed for user ${user_id}: ${msg}`);
        }
      }
    } catch (err) {
      console.warn(`⚠️  EVM sweep skipped: ${err.message}`);
    }
  } else {
    console.log("ℹ️  EVM sweep skipped: missing RPC URL or EVM hot-wallet address.");
  }

  try { await sweepBtcUsersToHotWallet(); } catch (err) { console.warn(`⚠️  BTC sweep skipped: ${err.message}`); }
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
