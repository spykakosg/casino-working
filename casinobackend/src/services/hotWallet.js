const bitcoin = require("bitcoinjs-lib");
const bip39 = require("bip39");
const ecc = require("tiny-secp256k1");
const { BIP32Factory } = require("bip32");
const { ethers } = require("ethers");
const { isTestnet, getEvmRpcUrl, getBtcExplorerBaseUrl, getUsdtContract } = require("../config/networkMode");

bitcoin.initEccLib(ecc);
const bip32 = BIP32Factory(ecc);

async function getBtcHotWallet() {
  const network = isTestnet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;
  const coin = isTestnet ? 1 : 0;
  const mnemonic = (process.env.WALLET_MNEMONIC || "").trim();
  if (!mnemonic || !bip39.validateMnemonic(mnemonic)) {
    throw new Error("Missing or invalid WALLET_MNEMONIC");
  }
  const index = parseInt(process.env.BTC_HOT_WALLET_INDEX || "0", 10);
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const root = bip32.fromSeed(seed, network);
  const child = root.derivePath(`m/84'/${coin}'/0'/0/${index}`);
  const { address } = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(child.publicKey), network });
  if (!address) throw new Error("Failed to derive BTC hot wallet address");
  return { network, address, child };
}

async function getHotWalletSnapshot() {
  const btc = { address: null, balance: null, symbol: "BTC" };
  const evm = { address: null, nativeBalance: null, usdtBalance: null, symbol: "ETH_POLYGON" };

  try {
    const { address } = await getBtcHotWallet();
    btc.address = address;
    const base = getBtcExplorerBaseUrl();
    const res = await fetch(`${base}/address/${address}`);
    if (res.ok) {
      const d = await res.json();
      const funded = Number(d?.chain_stats?.funded_txo_sum || 0);
      const spent = Number(d?.chain_stats?.spent_txo_sum || 0);
      btc.balance = (funded - spent) / 100_000_000;
    }
  } catch {}

  try {
    const rpcUrl = getEvmRpcUrl();
    const key = process.env.TESTNET_PAYOUT_PRIVATE_KEY;
    if (rpcUrl && key) {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const signer = new ethers.Wallet(key, provider);
      evm.address = signer.address;
      evm.nativeBalance = parseFloat(ethers.formatEther(await provider.getBalance(signer.address)));
      const usdt = getUsdtContract();
      if (usdt) {
        const erc20 = new ethers.Contract(usdt, ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"], provider);
        const decimals = await erc20.decimals();
        evm.usdtBalance = parseFloat(ethers.formatUnits(await erc20.balanceOf(signer.address), decimals));
      }
    }
  } catch {}

  return { mode: isTestnet ? "testnet" : "mainnet", btc, evm };
}

module.exports = { getBtcHotWallet, getHotWalletSnapshot };
