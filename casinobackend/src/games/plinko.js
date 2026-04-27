/**
 * Plinko Game Logic — Provably Fair
 *
 * A ball drops through a pyramid of pegs.
 * At each peg the ball goes left (0) or right (1).
 * The final bucket determines the multiplier.
 *
 * Config:
 *   rows: 8, 12, or 16
 *   risk: low, medium, high
 *
 * Each row uses a different cursor value for the RNG.
 */

const { generateFloat } = require("../engine/rng");

const MULTIPLIERS = {
  8: {
    low:    [5.6, 2.1, 1.1, 1.0, 0.5, 1.0, 1.1, 2.1, 5.6],
    medium: [13,  3.0, 1.3, 0.7, 0.4, 0.7, 1.3, 3.0, 13],
    high:   [29,  4.0, 1.5, 0.3, 0.2, 0.3, 1.5, 4.0, 29],
  },
  12: {
    low:    [10,  3.0, 1.6, 1.4, 1.1, 1.0, 0.5, 1.0, 1.1, 1.4, 1.6, 3.0, 10],
    medium: [33,  11,  4.0, 2.0, 1.1, 0.6, 0.3, 0.6, 1.1, 2.0, 4.0, 11,  33],
    high:   [170, 24,  8.1, 2.0, 0.7, 0.2, 0.2, 0.2, 0.7, 2.0, 8.1, 24,  170],
  },
  16: {
    low:    [16,  9.0, 2.0, 1.4, 1.4, 1.2, 1.1, 1.0, 0.5, 1.0, 1.1, 1.2, 1.4, 1.4, 2.0, 9.0, 16],
    medium: [110, 41,  10,  5.0, 3.0, 1.5, 1.0, 0.5, 0.3, 0.5, 1.0, 1.5, 3.0, 5.0, 10,  41,  110],
    high:   [1000,130, 26,  9.0, 4.0, 2.0, 0.2, 0.2, 0.2, 0.2, 0.2, 2.0, 4.0, 9.0, 26,  130, 1000],
  },
};

const VALID_ROWS = [8, 12, 16];
const VALID_RISKS = ["low", "medium", "high"];

function dropPlinko(serverSeed, clientSeed, nonce, rows) {
  const path = [];
  let position = 0;
  for (let i = 0; i < rows; i++) {
    const float = generateFloat(serverSeed, clientSeed, nonce, i);
    const direction = float < 0.5 ? 0 : 1; // 0 = left, 1 = right
    position += direction;
    path.push(direction);
  }
  return { path, bucket: position };
}

function resolvePlinkoBet({ serverSeed, clientSeed, nonce, betAmount, rows, risk }) {
  const { path, bucket } = dropPlinko(serverSeed, clientSeed, nonce, rows);
  const multipliers = MULTIPLIERS[rows][risk];
  const multiplier = multipliers[bucket];
  const payout = parseFloat((betAmount * multiplier).toFixed(8));
  const profit = parseFloat((payout - betAmount).toFixed(8));
  const won = payout > betAmount;

  return {
    path,
    bucket,
    rows,
    risk,
    won,
    betAmount,
    multiplier,
    payout,
    profit,
    nonce,
  };
}

function validatePlinkoBet({ betAmount, rows, risk, balance }) {
  if (betAmount <= 0) return { valid: false, error: "Bet amount must be positive" };
  if (betAmount > balance) return { valid: false, error: "Insufficient balance" };
  if (!VALID_ROWS.includes(rows)) return { valid: false, error: "Rows must be 8, 12, or 16" };
  if (!VALID_RISKS.includes(risk)) return { valid: false, error: "Risk must be low, medium, or high" };
  return { valid: true };
}

module.exports = {
  resolvePlinkoBet,
  validatePlinkoBet,
  dropPlinko,
  MULTIPLIERS,
  VALID_ROWS,
  VALID_RISKS,
};
