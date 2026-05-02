const fs = require("fs");

function saveWallet(mnemonic) {
  fs.writeFileSync("wallet.json", JSON.stringify({ mnemonic }, null, 2));
}

function loadWallet() {
  if (!fs.existsSync("wallet.json")) return null;

  const data = JSON.parse(fs.readFileSync("wallet.json"));
  return data.mnemonic;
}

module.exports = { saveWallet, loadWallet };