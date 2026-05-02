const bitcoin = require("bitcoinjs-lib");
const bip39 = require("bip39");
const ecc = require("tiny-secp256k1");
const { BIP32Factory } = require("bip32");

bitcoin.initEccLib(ecc);
const bip32 = BIP32Factory(ecc);

const network = bitcoin.networks.testnet;

async function createHDWallet() {
  return bip39.generateMnemonic();
}

async function deriveAddress(mnemonic, index = 0) {
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const root = bip32.fromSeed(seed, network);

  const path = `m/84'/1'/0'/0/${index}`;
  const child = root.derivePath(path);

  const { address } = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(child.publicKey),
    network,
  });

  return {
    index,
    address,
    privateKeyWIF: child.toWIF(),
    publicKey: child.publicKey,
  };
}

module.exports = { createHDWallet, deriveAddress, network };