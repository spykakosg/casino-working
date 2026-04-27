/**
 * Max bet enforcement — $10 USD equivalent for all currencies.
 * BTC/ETH prices are fetched from CoinGecko and cached for 60s.
 */

let priceCache = { btc: 94000, eth: 1800, updatedAt: 0 };

async function refreshPrices() {
  const now = Date.now();
  if (now - priceCache.updatedAt < 60_000 && priceCache.btc > 0) return;
  try {
    const resp = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd");
    const data = await resp.json();
    priceCache = { btc: data.bitcoin.usd, eth: data.ethereum.usd, updatedAt: now };
  } catch {}
}

const MAX_BET_USD = 10;

function getMaxBet(currency) {
  switch (currency) {
    case "BTC":
      return priceCache.btc > 0 ? MAX_BET_USD / priceCache.btc : 0.00013;
    case "ETH_POLYGON":
      return priceCache.eth > 0 ? MAX_BET_USD / priceCache.eth : 0.006;
    default:
      return MAX_BET_USD;
  }
}

async function validateMaxBet(currency, betAmount) {
  await refreshPrices();
  const max = getMaxBet(currency);
  if (betAmount > max * 1.01) {
    return { valid: false, error: `Max bet is ${max.toFixed(8)} ${currency} (~$${MAX_BET_USD} USD)` };
  }
  return { valid: true };
}

module.exports = { validateMaxBet, getMaxBet, refreshPrices };
