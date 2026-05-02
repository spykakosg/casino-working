const bitcoin = require("bitcoinjs-lib");
const axios = require("axios");
const { getUTXOs } = require("./balance");
const { deriveAddress, network } = require("./wallet");

const ecc = require("tiny-secp256k1");
const { ECPairFactory } = require("ecpair");
const ECPair = ECPairFactory(ecc);

async function sendBTC(mnemonic, index, toAddress, amountSats) {
  const sender = await deriveAddress(mnemonic, index);

  const utxos = await getUTXOs(sender.address);

  if (!utxos.length) throw new Error("No funds");

  const psbt = new bitcoin.Psbt({ network });

  let inputSum = 0;

  for (const utxo of utxos) {
    if (inputSum >= amountSats + 1000) break;

    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      witnessUtxo: {
        script: bitcoin.address.toOutputScript(sender.address, network),
        value: utxo.value,
      },
    });

    inputSum += utxo.value;
  }

  if (inputSum < amountSats + 1000) {
    throw new Error("Not enough balance");
  }

  const fee = 1000;
  const change = inputSum - amountSats - fee;

  psbt.addOutput({
    address: toAddress,
    value: amountSats,
  });

  if (change > 0) {
    psbt.addOutput({
      address: sender.address,
      value: change,
    });
  }

  const keyPair = ECPair.fromWIF(sender.privateKeyWIF, network);

  psbt.signAllInputs(keyPair);
  psbt.finalizeAllInputs();

  const txHex = psbt.extractTransaction().toHex();

  const res = await axios.post(
    "https://blockstream.info/testnet/api/tx",
    txHex
  );

  return res.data;
}

module.exports = { sendBTC };