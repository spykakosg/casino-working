const axios = require("axios");

async function getUTXOs(address) {
  const res = await axios.get(
    `https://blockstream.info/testnet/api/address/${address}/utxo`
  );
  return res.data;
}

async function getBalance(address) {
  const utxos = await getUTXOs(address);
  return utxos.reduce((sum, u) => sum + u.value, 0);
}

module.exports = { getUTXOs, getBalance };