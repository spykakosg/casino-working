/**
 * Slots Machine Game Logic — Provably Fair
 *
 * 3 rows x 5 reels with symbols.
 * House edge: ~5%
 *
 * Symbols (weighted):
 *   7      — rare     (weight 2)  | 5-of-a-kind: 100x | 4: 25x | 3: 10x
 *   BAR    — uncommon (weight 4)  | 5-of-a-kind: 50x  | 4: 15x | 3: 5x
 *   Bell   — medium   (weight 6)  | 5-of-a-kind: 25x  | 4: 8x  | 3: 3x
 *   Cherry — common   (weight 8)  | 5-of-a-kind: 10x  | 4: 4x  | 3: 2x
 *   Lemon  — common   (weight 10) | 5-of-a-kind: 5x   | 4: 2x  | 3: 1x
 *
 * Paylines: 5 lines (3 rows + 2 diagonals)
 * Best payline wins.
 */

const { generateFloat } = require("../engine/rng");

const SYMBOLS = [
  { name: "seven",  emoji: "7",   weight: 2,  pay5: 100, pay4: 25, pay3: 10 },
  { name: "bar",    emoji: "BAR", weight: 4,  pay5: 50,  pay4: 15, pay3: 5 },
  { name: "bell",   emoji: "BEL", weight: 6,  pay5: 25,  pay4: 8,  pay3: 3 },
  { name: "cherry", emoji: "CHR", weight: 8,  pay5: 10,  pay4: 4,  pay3: 2 },
  { name: "lemon",  emoji: "LEM", weight: 10, pay5: 5,   pay4: 2,  pay3: 1.5 },
];

const TOTAL_WEIGHT = SYMBOLS.reduce((s, sym) => s + sym.weight, 0);

function pickSymbol(float) {
  let cumulative = 0;
  for (const sym of SYMBOLS) {
    cumulative += sym.weight / TOTAL_WEIGHT;
    if (float < cumulative) return sym;
  }
  return SYMBOLS[SYMBOLS.length - 1];
}

function spinReels(serverSeed, clientSeed, nonce) {
  // 3 rows x 5 reels = 15 symbols
  const grid = [];
  for (let row = 0; row < 3; row++) {
    const rowSymbols = [];
    for (let col = 0; col < 5; col++) {
      const float = generateFloat(serverSeed, clientSeed, nonce, row * 5 + col);
      rowSymbols.push(pickSymbol(float));
    }
    grid.push(rowSymbols);
  }
  return grid;
}

function getPaylines(grid) {
  return [
    [grid[0][0], grid[0][1], grid[0][2], grid[0][3], grid[0][4]], // top row
    [grid[1][0], grid[1][1], grid[1][2], grid[1][3], grid[1][4]], // middle row
    [grid[2][0], grid[2][1], grid[2][2], grid[2][3], grid[2][4]], // bottom row
    [grid[0][0], grid[1][1], grid[2][2], grid[1][3], grid[0][4]], // V shape
    [grid[2][0], grid[1][1], grid[0][2], grid[1][3], grid[2][4]], // inverted V
  ];
}

function evaluatePayline(symbols) {
  const first = symbols[0].name;
  let matchCount = 1;
  for (let i = 1; i < symbols.length; i++) {
    if (symbols[i].name === first) matchCount++;
    else break;
  }

  if (matchCount >= 5) return { match: 5, symbol: symbols[0], multiplier: symbols[0].pay5 };
  if (matchCount >= 4) return { match: 4, symbol: symbols[0], multiplier: symbols[0].pay4 };
  if (matchCount >= 3) return { match: 3, symbol: symbols[0], multiplier: symbols[0].pay3 };
  return { match: 0, symbol: null, multiplier: 0 };
}

function resolveSlotsBet({ serverSeed, clientSeed, nonce, betAmount }) {
  const grid = spinReels(serverSeed, clientSeed, nonce);
  const paylines = getPaylines(grid);

  let bestResult = { match: 0, symbol: null, multiplier: 0, lineIndex: -1 };

  for (let i = 0; i < paylines.length; i++) {
    const result = evaluatePayline(paylines[i]);
    if (result.multiplier > bestResult.multiplier) {
      bestResult = { ...result, lineIndex: i };
    }
  }

  const multiplier = bestResult.multiplier;
  const won = multiplier > 0;
  const payout = won ? parseFloat((betAmount * multiplier).toFixed(8)) : 0;
  const profit = parseFloat((payout - betAmount).toFixed(8));

  const gridResult = grid.map(row => row.map(sym => ({
    name: sym.name,
    emoji: sym.emoji,
  })));

  return {
    grid: gridResult,
    won,
    multiplier,
    matchCount: bestResult.match,
    matchSymbol: bestResult.symbol?.name || null,
    winningLine: bestResult.lineIndex,
    betAmount,
    payout,
    profit,
    nonce,
  };
}

function validateSlotsBet({ betAmount, balance }) {
  if (betAmount <= 0) return { valid: false, error: "Bet amount must be positive" };
  if (betAmount > balance) return { valid: false, error: "Insufficient balance" };
  return { valid: true };
}

module.exports = {
  resolveSlotsBet,
  validateSlotsBet,
  spinReels,
  SYMBOLS,
};
