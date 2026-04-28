const CRYPTO_CURRENCIES = new Set(["BTC", "ETH_POLYGON"]);

function isCryptoCurrency(currency) {
  return CRYPTO_CURRENCIES.has(currency);
}

function getMinBet(currency) {
  return isCryptoCurrency(currency) ? 0.00000100 : 0.001;
}

function getMinBetDecimals(currency) {
  return isCryptoCurrency(currency) ? 8 : 3;
}

function validateMinimumBet(currency, betAmount) {
  const min = getMinBet(currency);
  if (betAmount < min) {
    return {
      valid: false,
      error: `Minimum bet is ${min.toFixed(getMinBetDecimals(currency))} ${currency}`,
    };
  }
  return { valid: true };
}

module.exports = {
  isCryptoCurrency,
  getMinBet,
  getMinBetDecimals,
  validateMinimumBet,
};
