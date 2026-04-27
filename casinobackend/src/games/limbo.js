/**
 * Limbo Game Logic — Provably Fair
 *
 * Player picks a target multiplier. The game generates a random multiplier.
 * If the generated multiplier >= target, player wins.
 *
 * House edge: 4%
 * Generated multiplier formula:
 *   result = 0.96 / (1 - float)  where float is [0, 1)
 *   Capped at 1,000,000x
 *
 * Win probability for target T: 0.96 / T
 */

const { generateFloat } = require("../engine/rng");

const HOUSE_EDGE = 0.04;
const MAX_MULTIPLIER = 1000000;
const MIN_TARGET = 1.01;
const MAX_TARGET = 1000000;

function generateLimboResult(serverSeed, clientSeed, nonce) {
  const float = generateFloat(serverSeed, clientSeed, nonce);
  // Avoid division by zero
  if (float >= 0.9999999) return 1.00;
  const result = (1 - HOUSE_EDGE) / (1 - float);
  return Math.min(parseFloat(result.toFixed(2)), MAX_MULTIPLIER);
}

function resolveLimboBet({ serverSeed, clientSeed, nonce, betAmount, target }) {
  const result = generateLimboResult(serverSeed, clientSeed, nonce);
  const won = result >= target;
  const multiplier = target;
  const payout = won ? parseFloat((betAmount * multiplier).toFixed(8)) : 0;
  const profit = parseFloat((payout - betAmount).toFixed(8));

  return {
    result,
    target,
    won,
    betAmount,
    multiplier,
    payout,
    profit,
    nonce,
  };
}

function validateLimboBet({ betAmount, target, balance }) {
  if (betAmount <= 0) return { valid: false, error: "Bet amount must be positive" };
  if (betAmount > balance) return { valid: false, error: "Insufficient balance" };
  if (target < MIN_TARGET || target > MAX_TARGET) {
    return { valid: false, error: `Target must be between ${MIN_TARGET} and ${MAX_TARGET}` };
  }
  return { valid: true };
}

module.exports = {
  resolveLimboBet,
  validateLimboBet,
  generateLimboResult,
  MIN_TARGET,
  MAX_TARGET,
  MAX_MULTIPLIER,
};
