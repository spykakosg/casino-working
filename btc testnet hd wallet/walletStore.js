const fs = require("fs");

const FILE = "wallet.json";

function saveWallet(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function loadWallet() {
  if (!fs.existsSync(FILE)) return null;
  return JSON.parse(fs.readFileSync(FILE));
}

function initWallet(mnemonic) {
  const data = {
    mnemonic,
    nextIndex: 0,
  };
  saveWallet(data);
}

function getNextIndex() {
  const w = loadWallet();
  return w.nextIndex;
}

function incrementIndex() {
  const w = loadWallet();
  w.nextIndex += 1;
  saveWallet(w);
}

module.exports = {
  saveWallet,
  loadWallet,
  initWallet,
  getNextIndex,
  incrementIndex,
};