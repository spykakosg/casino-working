const { isCryptoCurrency } = require("./currency");

function storageDecimals(currency) {
  return isCryptoCurrency(currency) ? 10 : 5;
}

function roundAmount(value, currency) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Number(num.toFixed(storageDecimals(currency)));
}

module.exports = {
  storageDecimals,
  roundAmount,
};
