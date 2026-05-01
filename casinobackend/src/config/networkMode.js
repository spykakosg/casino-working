const isTestnet = String(process.env.TESTNET_MODE || "").toLowerCase() === "true";

function getEvmRpcUrl() {
  return (isTestnet ? process.env.TESTNET_EVM_RPC_URL : process.env.ALCHEMY_POLYGON_URL || "").trim();
}

function getBtcExplorerBaseUrl() {
  const fallback = isTestnet ? "https://blockstream.info/testnet/api" : "https://blockstream.info/api";
  return (process.env.BTC_EXPLORER_BASE_URL || fallback).replace(/\/$/, "");
}

function getUsdtContract() {
  if (isTestnet) {
    return (process.env.TESTNET_USDT_CONTRACT || "").trim();
  }
  return "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";
}

module.exports = {
  isTestnet,
  getEvmRpcUrl,
  getBtcExplorerBaseUrl,
  getUsdtContract,
};
