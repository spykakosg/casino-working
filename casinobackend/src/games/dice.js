/**
 * Dice Game Logic
 *
 * Rules:
 *  - Roll is a number between 0.00 and 99.99
 *  - Player chooses a target number (1.00 – 98.00) and a direction:
 *      "under"  → win if roll < target
 *      "over"   → win if roll > target
 *  - House edge: 1%
 *  - Multiplier = (100 - houseEdge) / winProbability
 *
 * Example:
 *  Target: 50, Direction: under
 *  Win probability: 50%
 *  Multiplier: 99 / 50 = 1.98x
 *  If you bet 100 USDT → win 198 USDT (profit: 98 USDT)
 */

const { rollDice } = require("../engine/rng");

const HOUSE_EDGE = 1; // 1%
const MIN_TARGET = 2; // min probability: 2% (max multiplier ~49.5x)
const MAX_TARGET = 98; // max probability: 98% (min multiplier ~1.01x)
const MAX_MULTIPLIER = 49.5;
const MIN_BET_USDT = 0.001;

/**
 * Calculate win probability for a given target + direction
 * @returns {number} probability as a percentage (e.g. 50.00)
 */
function calcWinProbability(target, direction) {
  if (direction === "under") {
    return target; // e.g. target=50 → 50% chance of rolling < 50
  } else {
    return 100 - target; // e.g. target=50 → 50% chance of rolling > 50
  }
}

/**
 * Calculate the payout multiplier
 * multiplier = (100 - houseEdge) / winProbability
 * @returns {number} e.g. 1.98
 */
function calcMultiplier(winProbability) {
  const multiplier = (100 - HOUSE_EDGE) / winProbability;
  return Math.min(parseFloat(multiplier.toFixed(4)), MAX_MULTIPLIER);
}

/**
 * Validate a bet before processing
 * @returns {{ valid: boolean, error?: string }}
 */
function validateBet({ betAmount, target, direction, balance }) {
  if (!["under", "over"].includes(direction)) {
    return { valid: false, error: "Direction must be 'under' or 'over'" };
  }
  if (target < MIN_TARGET || target > MAX_TARGET) {
    return {
      valid: false,
      error: `Target must be between ${MIN_TARGET} and ${MAX_TARGET}`,
    };
  }
  if (betAmount < MIN_BET_USDT) {
    return {
      valid: false,
      error: `Minimum bet is ${MIN_BET_USDT} USDT`,
    };
  }
  if (betAmount > balance) {
    return { valid: false, error: "Insufficient balance" };
  }
  return { valid: true };
}

/**
 * Resolve a dice bet
 *
 * @param {object} params
 * @param {string} params.serverSeed
 * @param {string} params.clientSeed
 * @param {number} params.nonce
 * @param {number} params.betAmount  - in USDT equivalent
 * @param {number} params.target     - e.g. 50.00
 * @param {string} params.direction  - "under" | "over"
 *
 * @returns {object} result
 */
function resolveDiceBet({ serverSeed, clientSeed, nonce, betAmount, target, direction }) {
  const roll = rollDice(serverSeed, clientSeed, nonce);
  const winProbability = calcWinProbability(target, direction);
  const multiplier = calcMultiplier(winProbability);

  const won =
    direction === "under" ? roll < target : roll > target;

  const payout = won ? parseFloat((betAmount * multiplier).toFixed(8)) : 0;
  const profit = parseFloat((payout - betAmount).toFixed(8));

  return {
    roll,            // the rolled number (0.00–99.99)
    target,
    direction,
    won,
    betAmount,
    multiplier,
    winProbability,
    payout,          // total returned to player (0 if lost)
    profit,          // net gain/loss
    nonce,
  };
}

/**
 * Get game info / limits for the frontend
 */
function getDiceGameInfo() {
  return {
    houseEdge: HOUSE_EDGE,
    minTarget: MIN_TARGET,
    maxTarget: MAX_TARGET,
    maxMultiplier: MAX_MULTIPLIER,
    minBet: MIN_BET_USDT,
    directions: ["under", "over"],
    // Example presets shown in the UI
    presets: [
      { label: "Safe", target: 90, direction: "under", multiplier: calcMultiplier(90) },
      { label: "Balanced", target: 50, direction: "under", multiplier: calcMultiplier(50) },
      { label: "Risky", target: 10, direction: "under", multiplier: calcMultiplier(10) },
      { label: "Moon", target: 3, direction: "under", multiplier: calcMultiplier(3) },
    ],
  };
}

module.exports = {
  resolveDiceBet,
  validateBet,
  calcMultiplier,
  calcWinProbability,
  getDiceGameInfo,
  HOUSE_EDGE,
};
