/**
 * Mines Game Logic — Provably Fair
 *
 * 5x5 grid (25 tiles). Player chooses number of mines (1-24).
 * Each tile reveal that isn't a mine increases the multiplier.
 * Cash out at any time to collect winnings.
 *
 * Multiplier formula (house edge ~3%):
 *   After revealing k safe tiles with m mines in 25 total tiles:
 *   multiplier = 0.97 * (25! / (25-k)!) / ((25-m)! / (25-m-k)!)
 *   Simplified: product of (25-i)/(25-m-i) for i=0..k-1, times 0.97
 */

const { generateFloat } = require("../engine/rng");

const GRID_SIZE = 25;

function generateMinePositions(serverSeed, clientSeed, nonce, mineCount) {
  const positions = [];
  const available = Array.from({ length: GRID_SIZE }, (_, i) => i);

  for (let i = 0; i < mineCount; i++) {
    const float = generateFloat(serverSeed, clientSeed, nonce, i);
    const idx = Math.floor(float * available.length);
    positions.push(available[idx]);
    available.splice(idx, 1);
  }

  return positions.sort((a, b) => a - b);
}

function calculateMultiplier(mineCount, revealedCount) {
  if (revealedCount === 0) return 1;
  let multiplier = 0.97; // 3% house edge
  const safeTiles = GRID_SIZE - mineCount;
  for (let i = 0; i < revealedCount; i++) {
    multiplier *= (GRID_SIZE - i) / (safeTiles - i);
  }
  return parseFloat(multiplier.toFixed(4));
}

function getNextMultiplier(mineCount, currentRevealed) {
  return calculateMultiplier(mineCount, currentRevealed + 1);
}

function validateMinesBet({ betAmount, mineCount, balance }) {
  if (betAmount <= 0) return { valid: false, error: "Bet amount must be positive" };
  if (betAmount > balance) return { valid: false, error: "Insufficient balance" };
  if (!Number.isInteger(mineCount) || mineCount < 1 || mineCount > 24) {
    return { valid: false, error: "Mine count must be between 1 and 24" };
  }
  return { valid: true };
}

module.exports = {
  generateMinePositions,
  calculateMultiplier,
  getNextMultiplier,
  validateMinesBet,
  GRID_SIZE,
};
