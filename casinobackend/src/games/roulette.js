/**
 * Roulette Game Logic — Provably Fair
 *
 * European roulette: 0–36 (37 slots)
 * House edge: ~2.7% (from the single zero)
 *
 * Bet types:
 *   straight  — single number (35:1)
 *   split     — two adjacent numbers (17:1)
 *   red/black — 18 numbers (1:1)
 *   odd/even  — 18 numbers (1:1)
 *   low/high  — 1-18 / 19-36 (1:1)
 *   dozen     — 1st12/2nd12/3rd12 (2:1)
 *   column    — col1/col2/col3 (2:1)
 */

const { generateFloat } = require("../engine/rng");

const RED_NUMBERS   = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
const BLACK_NUMBERS = [2,4,6,8,10,11,13,15,17,20,22,24,26,28,29,31,33,35];

const BET_TYPES = {
  straight: { payout: 36, description: "Single number" },
  split:    { payout: 18, description: "Two numbers" },
  corner:   { payout: 9,  description: "Four numbers" },
  red:      { payout: 2,  description: "Red" },
  black:    { payout: 2,  description: "Black" },
  odd:      { payout: 2,  description: "Odd" },
  even:     { payout: 2,  description: "Even" },
  low:      { payout: 2,  description: "1-18" },
  high:     { payout: 2,  description: "19-36" },
  dozen1:   { payout: 3,  description: "1st Dozen (1-12)" },
  dozen2:   { payout: 3,  description: "2nd Dozen (13-24)" },
  dozen3:   { payout: 3,  description: "3rd Dozen (25-36)" },
  column1:  { payout: 3,  description: "1st Column" },
  column2:  { payout: 3,  description: "2nd Column" },
  column3:  { payout: 3,  description: "3rd Column" },
};

function spinRoulette(serverSeed, clientSeed, nonce) {
  const float = generateFloat(serverSeed, clientSeed, nonce);
  return Math.floor(float * 37); // 0-36
}

function getNumberColor(n) {
  if (n === 0) return "green";
  if (RED_NUMBERS.includes(n)) return "red";
  return "black";
}

function getColumn(n) {
  if (n === 0) return 0;
  return ((n - 1) % 3) + 1; // 1, 2, or 3
}

function getDozen(n) {
  if (n === 0) return 0;
  if (n <= 12) return 1;
  if (n <= 24) return 2;
  return 3;
}

function checkWin(betType, betValue, result) {
  switch (betType) {
    case "straight": return result === parseInt(betValue);
    case "split": {
      const nums = String(betValue).split(",").map(Number);
      return nums.includes(result);
    }
    case "corner": {
      const nums = String(betValue).split(",").map(Number);
      return nums.includes(result);
    }
    case "red":      return RED_NUMBERS.includes(result);
    case "black":    return BLACK_NUMBERS.includes(result);
    case "odd":      return result > 0 && result % 2 === 1;
    case "even":     return result > 0 && result % 2 === 0;
    case "low":      return result >= 1 && result <= 18;
    case "high":     return result >= 19 && result <= 36;
    case "dozen1":   return result >= 1 && result <= 12;
    case "dozen2":   return result >= 13 && result <= 24;
    case "dozen3":   return result >= 25 && result <= 36;
    case "column1":  return result > 0 && getColumn(result) === 1;
    case "column2":  return result > 0 && getColumn(result) === 2;
    case "column3":  return result > 0 && getColumn(result) === 3;
    default:         return false;
  }
}

function resolveRouletteBet({ serverSeed, clientSeed, nonce, betAmount, betType, betValue }) {
  const result = spinRoulette(serverSeed, clientSeed, nonce);
  const color = getNumberColor(result);
  const won = checkWin(betType, betValue, result);
  const multiplier = won ? BET_TYPES[betType].payout : 0;
  const payout = won ? parseFloat((betAmount * multiplier).toFixed(8)) : 0;
  const profit = parseFloat((payout - betAmount).toFixed(8));

  return {
    result,
    color,
    betType,
    betValue,
    won,
    betAmount,
    multiplier: BET_TYPES[betType].payout,
    payout,
    profit,
    nonce,
  };
}

function validateRouletteBet({ betAmount, betType, betValue, balance }) {
  if (betAmount <= 0) return { valid: false, error: "Bet amount must be positive" };
  if (betAmount > balance) return { valid: false, error: "Insufficient balance" };
  if (!BET_TYPES[betType]) return { valid: false, error: "Invalid bet type" };
  if (betType === "straight") {
    const num = parseInt(betValue);
    if (isNaN(num) || num < 0 || num > 36) {
      return { valid: false, error: "Straight bet must be 0-36" };
    }
  }
  if (betType === "split") {
    const nums = String(betValue).split(",").map(Number);
    if (nums.length !== 2 || nums.some(n => isNaN(n) || n < 0 || n > 36)) {
      return { valid: false, error: "Split bet must be two numbers 0-36" };
    }
  }
  if (betType === "corner") {
    const nums = String(betValue).split(",").map(Number);
    if (nums.length !== 4 || nums.some(n => isNaN(n) || n < 1 || n > 36)) {
      return { valid: false, error: "Corner bet must be four numbers 1-36" };
    }
  }
  return { valid: true };
}

module.exports = {
  spinRoulette,
  resolveRouletteBet,
  validateRouletteBet,
  getNumberColor,
  BET_TYPES,
  RED_NUMBERS,
  BLACK_NUMBERS,
};
