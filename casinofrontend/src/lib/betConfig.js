import { getPrices } from "./api";

const MAX_BET_USD = 10;
let cachedPrices = { btc: 94000, eth: 1800, updatedAt: 0 };

export async function fetchPrices() {
  try {
    const data = await getPrices();
    if (data.btc > 0) cachedPrices = data;
  } catch {}
  return cachedPrices;
}

export function isCrypto(currency) {
  return currency === "BTC" || currency === "ETH_POLYGON";
}

export function betDecimals(currency) {
  return isCrypto(currency) ? 8 : 3;
}

export function displayDecimals(currency) {
  return isCrypto(currency) ? 10 : 5;
}

export function minBet(currency) {
  return isCrypto(currency) ? 0.00000001 : 0.001;
}

export function defaultBet(currency) {
  return isCrypto(currency) ? "0.00001" : "1";
}

export function stepSize(currency) {
  return isCrypto(currency) ? 0.00000001 : 1;
}

export function maxBetForCurrency(currency) {
  if (!isCrypto(currency)) return MAX_BET_USD;
  const price = currency === "BTC" ? cachedPrices.btc : cachedPrices.eth;
  if (!price || price <= 0) return 999;
  return parseFloat((MAX_BET_USD / price).toFixed(8));
}

export function clampBet(value, currency) {
  const min = minBet(currency);
  const max = maxBetForCurrency(currency);
  const dec = betDecimals(currency);
  let v = parseFloat(value);
  if (isNaN(v) || v < min) v = min;
  if (v > max) v = max;
  return v.toFixed(dec);
}

export function halfBet(current, currency) {
  const dec = betDecimals(currency);
  const min = minBet(currency);
  return Math.max(min, parseFloat(current) / 2).toFixed(dec);
}

export function doubleBet(current, currency) {
  const dec = betDecimals(currency);
  const max = maxBetForCurrency(currency);
  return Math.min(max, parseFloat(current) * 2).toFixed(dec);
}

export function stepUp(current, currency) {
  const step = stepSize(currency);
  const max = maxBetForCurrency(currency);
  const dec = betDecimals(currency);
  return Math.min(max, parseFloat(current) + step).toFixed(dec);
}

export function stepDown(current, currency) {
  const step = stepSize(currency);
  const min = minBet(currency);
  const dec = betDecimals(currency);
  return Math.max(min, parseFloat(current) - step).toFixed(dec);
}

export function maxBetAmount(currency, balance) {
  const max = maxBetForCurrency(currency);
  const dec = betDecimals(currency);
  return Math.min(max, balance || 0).toFixed(dec);
}
