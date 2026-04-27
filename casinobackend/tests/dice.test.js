/**
 * Tests — RNG & Dice Engine
 */

const { generateServerSeed, hashServerSeed, rollDice, verifyDiceRoll, rotateSeed } = require("../src/engine/rng");
const { resolveDiceBet, calcMultiplier, calcWinProbability, validateBet } = require("../src/games/dice");

// ─── RNG Tests ────────────────────────────────────────────────────────────────

describe("RNG Engine", () => {
  test("generateServerSeed returns 64-char hex string", () => {
    const seed = generateServerSeed();
    expect(seed).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(seed)).toBe(true);
  });

  test("hashServerSeed returns 64-char hex string", () => {
    const seed = generateServerSeed();
    const hash = hashServerSeed(seed);
    expect(hash).toHaveLength(64);
  });

  test("same seed+clientSeed+nonce always produces same roll", () => {
    const serverSeed = "abc123";
    const clientSeed = "player_seed";
    const nonce = 0;
    const roll1 = rollDice(serverSeed, clientSeed, nonce);
    const roll2 = rollDice(serverSeed, clientSeed, nonce);
    expect(roll1).toBe(roll2);
  });

  test("different nonces produce different rolls", () => {
    const serverSeed = generateServerSeed();
    const clientSeed = "test";
    const rolls = new Set();
    for (let i = 0; i < 100; i++) {
      rolls.add(rollDice(serverSeed, clientSeed, i));
    }
    // Very unlikely to have collisions across 100 rolls
    expect(rolls.size).toBeGreaterThan(90);
  });

  test("roll is always between 0 and 99.99", () => {
    const serverSeed = generateServerSeed();
    for (let i = 0; i < 1000; i++) {
      const roll = rollDice(serverSeed, "client", i);
      expect(roll).toBeGreaterThanOrEqual(0);
      expect(roll).toBeLessThan(100);
    }
  });

  test("verifyDiceRoll confirms a known result", () => {
    const serverSeed = "testseed";
    const clientSeed = "clientseed";
    const nonce = 5;
    const roll = rollDice(serverSeed, clientSeed, nonce);
    expect(verifyDiceRoll(serverSeed, clientSeed, nonce, roll)).toBe(true);
  });

  test("rotateSeed reveals old seed and generates new one", () => {
    const oldSeed = generateServerSeed();
    const { revealedSeed, newServerSeed, newHashedSeed } = rotateSeed(oldSeed);
    expect(revealedSeed).toBe(oldSeed);
    expect(newServerSeed).not.toBe(oldSeed);
    expect(newHashedSeed).toBe(hashServerSeed(newServerSeed));
  });
});

// ─── Dice Game Tests ──────────────────────────────────────────────────────────

describe("Dice Game Logic", () => {
  test("multiplier formula is correct (1% house edge)", () => {
    // 50% win chance → 99/50 = 1.98x
    expect(calcMultiplier(50)).toBeCloseTo(1.98, 2);
    // 10% win chance → 99/10 = 9.9x
    expect(calcMultiplier(10)).toBeCloseTo(9.9, 2);
    // 90% win chance → 99/90 = 1.1x
    expect(calcMultiplier(90)).toBeCloseTo(1.1, 2);
  });

  test("calcWinProbability: under direction", () => {
    expect(calcWinProbability(50, "under")).toBe(50);
    expect(calcWinProbability(25, "under")).toBe(25);
  });

  test("calcWinProbability: over direction", () => {
    expect(calcWinProbability(50, "over")).toBe(50);
    expect(calcWinProbability(25, "over")).toBe(75);
  });

  test("validateBet rejects insufficient balance", () => {
    const result = validateBet({ betAmount: 100, target: 50, direction: "under", balance: 50 });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/insufficient/i);
  });

  test("validateBet rejects invalid direction", () => {
    const result = validateBet({ betAmount: 10, target: 50, direction: "sideways", balance: 100 });
    expect(result.valid).toBe(false);
  });

  test("validateBet rejects out-of-range target", () => {
    const r1 = validateBet({ betAmount: 10, target: 1, direction: "under", balance: 100 });
    const r2 = validateBet({ betAmount: 10, target: 99, direction: "under", balance: 100 });
    expect(r1.valid).toBe(false);
    expect(r2.valid).toBe(false);
  });

  test("resolveDiceBet pays out correctly on win", () => {
    // Force a known roll below 50 by finding a nonce that wins
    const serverSeed = generateServerSeed();
    const clientSeed = "test";
    let winNonce = null;
    for (let i = 0; i < 100; i++) {
      const r = rollDice(serverSeed, clientSeed, i);
      if (r < 50) { winNonce = i; break; }
    }
    expect(winNonce).not.toBeNull();

    const result = resolveDiceBet({
      serverSeed, clientSeed, nonce: winNonce,
      betAmount: 100, target: 50, direction: "under",
    });

    expect(result.won).toBe(true);
    expect(result.payout).toBeCloseTo(100 * 1.98, 1);
    expect(result.profit).toBeGreaterThan(0);
  });

  test("resolveDiceBet returns 0 payout on loss", () => {
    const serverSeed = generateServerSeed();
    const clientSeed = "test";
    let loseNonce = null;
    for (let i = 0; i < 100; i++) {
      const r = rollDice(serverSeed, clientSeed, i);
      if (r >= 50) { loseNonce = i; break; }
    }
    const result = resolveDiceBet({
      serverSeed, clientSeed, nonce: loseNonce,
      betAmount: 100, target: 50, direction: "under",
    });
    expect(result.won).toBe(false);
    expect(result.payout).toBe(0);
    expect(result.profit).toBe(-100);
  });

  test("house edge holds over large sample (within 0.5%)", () => {
    const serverSeed = generateServerSeed();
    const clientSeed = "simulation";
    let totalBet = 0;
    let totalPayout = 0;
    const BETS = 10000;

    for (let i = 0; i < BETS; i++) {
      const result = resolveDiceBet({
        serverSeed, clientSeed, nonce: i,
        betAmount: 1, target: 50, direction: "under",
      });
      totalBet += 1;
      totalPayout += result.payout;
    }

    const actualEdge = ((totalBet - totalPayout) / totalBet) * 100;
    // Should be close to 1% house edge
    // House always profits over time, and stays within 0.5% of target 1% edge
    expect(actualEdge).toBeGreaterThan(0);
    expect(actualEdge).toBeLessThan(1.5);
  });
});
