/**
 * Game Routes — /api/games
 *
 * POST /api/games/dice/bet        - Place a dice bet
 * POST /api/games/dice/seed       - Rotate server seed
 * GET  /api/games/dice/info       - Game config / presets
 * GET  /api/games/dice/verify     - Verify a past bet result
 * GET  /api/games/bets            - Bet history
 */

const express = require("express");
const router = express.Router();
const { placeDiceBet, placeRouletteBet, placePlinkoBet, placeLimboBet, placeSlotsBet, rotateServerSeed, getBetHistory } = require("../engine/bet");
const { getDiceGameInfo } = require("../games/dice");
const { BET_TYPES } = require("../games/roulette");
const { MULTIPLIERS, VALID_ROWS, VALID_RISKS } = require("../games/plinko");
const { MIN_TARGET, MAX_TARGET } = require("../games/limbo");
const { rollDice, hashServerSeed } = require("../engine/rng");
const auth = require("../middleware/auth");
const { validateMaxBet } = require("../engine/maxBet");

// ─── Dice: Place Bet ──────────────────────────────────────────────────────────
router.post("/dice/bet", auth, async (req, res) => {
  const { currency, betAmount, target, direction } = req.body;
  const userId = req.user.id;

  // Basic input checks
  if (!currency || !betAmount || target === undefined || !direction) {
    return res.status(400).json({ error: "Missing required fields: currency, betAmount, target, direction" });
  }

  const validCurrencies = ["USDT_POLYGON", "ETH_POLYGON", "USDT_TRON", "BTC"];
  if (!validCurrencies.includes(currency)) {
    return res.status(400).json({ error: `Invalid currency. Supported: ${validCurrencies.join(", ")}` });
  }

  const amount = parseFloat(betAmount);
  if (isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: "betAmount must be a positive number" });
  }

  const maxCheck = await validateMaxBet(currency, amount);
  if (!maxCheck.valid) return res.status(400).json({ error: maxCheck.error });

  try {
    const result = await placeDiceBet(req.db, {
      userId,
      currency,
      betAmount: amount,
      target: parseFloat(target),
      direction,
    });

    return res.json({
      success: true,
      bet: {
        id: result.betId,
        roll: result.roll,
        target: result.target,
        direction: result.direction,
        won: result.won,
        betAmount: result.betAmount,
        payout: result.payout,
        profit: result.profit,
        multiplier: result.multiplier,
        currency: result.currency,
        nonce: result.nonce,
      },
      balance: result.newBalance,
    });
  } catch (err) {
    // Distinguish user errors from server errors
    const userErrors = ["Insufficient balance", "Minimum bet", "Target must be", "Direction must be"];
    const isUserError = userErrors.some((e) => err.message.includes(e));
    return res.status(isUserError ? 400 : 500).json({ error: err.message });
  }
});

// ─── Dice: Game Info ──────────────────────────────────────────────────────────
router.get("/dice/info", (req, res) => {
  return res.json(getDiceGameInfo());
});

// ─── Dice: Verify Past Bet ───────────────────────────────────────────────────
// Anyone can verify — just pass serverSeed (revealed after rotation), clientSeed, nonce
router.get("/dice/verify", (req, res) => {
  const { serverSeed, clientSeed, nonce } = req.query;

  if (!serverSeed || !clientSeed || nonce === undefined) {
    return res.status(400).json({ error: "serverSeed, clientSeed, nonce required" });
  }

  const roll = rollDice(serverSeed, clientSeed, parseInt(nonce));
  const serverSeedHash = hashServerSeed(serverSeed);

  return res.json({
    roll,
    serverSeedHash,
    clientSeed,
    nonce: parseInt(nonce),
    message: "Verify serverSeedHash matches what was shown before the bet",
  });
});

// ─── Dice: Rotate Server Seed ────────────────────────────────────────────────
router.post("/dice/seed", auth, async (req, res) => {
  const { currency } = req.body;

  if (!currency) return res.status(400).json({ error: "currency required" });

  try {
    const result = await rotateServerSeed(req.db, req.user.id, currency);
    return res.json({
      success: true,
      revealedServerSeed: result.revealedServerSeed,
      newServerSeedHash: result.newServerSeedHash,
      message: "Old seed revealed. New seed hash committed. Nonce reset to 0.",
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Roulette: Place Bet ──────────────────────────────────────────────────────
router.post("/roulette/bet", auth, async (req, res) => {
  const { currency, betAmount, betType, betValue } = req.body;

  if (!currency || !betAmount || !betType) {
    return res.status(400).json({ error: "Missing required fields: currency, betAmount, betType" });
  }

  const validCurrencies = ["USDT_POLYGON", "ETH_POLYGON", "USDT_TRON", "BTC"];
  if (!validCurrencies.includes(currency)) {
    return res.status(400).json({ error: `Invalid currency` });
  }

  const amount = parseFloat(betAmount);
  if (isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: "betAmount must be a positive number" });
  }

  const maxCheck2 = await validateMaxBet(currency, amount);
  if (!maxCheck2.valid) return res.status(400).json({ error: maxCheck2.error });

  try {
    const result = await placeRouletteBet(req.db, {
      userId: req.user.id, currency, betAmount: amount, betType,
      betValue: betValue !== undefined ? betValue : null,
    });
    return res.json({ success: true, bet: result, balance: result.newBalance });
  } catch (err) {
    const isUserError = ["Insufficient balance", "Invalid bet", "Straight bet"].some(e => err.message.includes(e));
    return res.status(isUserError ? 400 : 500).json({ error: err.message });
  }
});

router.get("/roulette/info", (_req, res) => {
  return res.json({ betTypes: BET_TYPES });
});

// ─── Plinko: Place Bet ────────────────────────────────────────────────────────
router.post("/plinko/bet", auth, async (req, res) => {
  const { currency, betAmount, rows, risk } = req.body;

  if (!currency || !betAmount || !rows || !risk) {
    return res.status(400).json({ error: "Missing required fields: currency, betAmount, rows, risk" });
  }

  const validCurrencies = ["USDT_POLYGON", "ETH_POLYGON", "USDT_TRON", "BTC"];
  if (!validCurrencies.includes(currency)) {
    return res.status(400).json({ error: `Invalid currency` });
  }

  const amount = parseFloat(betAmount);
  if (isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: "betAmount must be a positive number" });
  }

  const maxCheck3 = await validateMaxBet(currency, amount);
  if (!maxCheck3.valid) return res.status(400).json({ error: maxCheck3.error });

  try {
    const result = await placePlinkoBet(req.db, {
      userId: req.user.id, currency, betAmount: amount, rows: parseInt(rows), risk,
    });
    return res.json({ success: true, bet: result, balance: result.newBalance });
  } catch (err) {
    const isUserError = ["Insufficient balance", "Rows must", "Risk must"].some(e => err.message.includes(e));
    return res.status(isUserError ? 400 : 500).json({ error: err.message });
  }
});

router.get("/plinko/info", (_req, res) => {
  return res.json({ multipliers: MULTIPLIERS, validRows: VALID_ROWS, validRisks: VALID_RISKS });
});

// ─── Limbo: Place Bet ─────────────────────────────────────────────────────────
router.post("/limbo/bet", auth, async (req, res) => {
  const { currency, betAmount, target } = req.body;

  if (!currency || !betAmount || !target) {
    return res.status(400).json({ error: "Missing required fields: currency, betAmount, target" });
  }

  const validCurrencies = ["USDT_POLYGON", "ETH_POLYGON", "USDT_TRON", "BTC"];
  if (!validCurrencies.includes(currency)) return res.status(400).json({ error: "Invalid currency" });

  const amount = parseFloat(betAmount);
  if (isNaN(amount) || amount <= 0) return res.status(400).json({ error: "betAmount must be positive" });

  const maxCheck4 = await validateMaxBet(currency, amount);
  if (!maxCheck4.valid) return res.status(400).json({ error: maxCheck4.error });

  const targetVal = parseFloat(target);
  if (isNaN(targetVal) || targetVal < MIN_TARGET || targetVal > MAX_TARGET) {
    return res.status(400).json({ error: `Target must be between ${MIN_TARGET} and ${MAX_TARGET}` });
  }

  try {
    const result = await placeLimboBet(req.db, {
      userId: req.user.id, currency, betAmount: amount, target: targetVal,
    });
    return res.json({ success: true, bet: result, balance: result.newBalance });
  } catch (err) {
    const isUserError = ["Insufficient balance", "Target must", "Bet amount"].some(e => err.message.includes(e));
    return res.status(isUserError ? 400 : 500).json({ error: err.message });
  }
});

// ─── Slots: Place Bet ─────────────────────────────────────────────────────────
router.post("/slots/bet", auth, async (req, res) => {
  const { currency, betAmount } = req.body;

  if (!currency || !betAmount) {
    return res.status(400).json({ error: "Missing required fields: currency, betAmount" });
  }

  const validCurrencies = ["USDT_POLYGON", "ETH_POLYGON", "USDT_TRON", "BTC"];
  if (!validCurrencies.includes(currency)) return res.status(400).json({ error: "Invalid currency" });

  const amount = parseFloat(betAmount);
  if (isNaN(amount) || amount <= 0) return res.status(400).json({ error: "betAmount must be positive" });

  const maxCheck5 = await validateMaxBet(currency, amount);
  if (!maxCheck5.valid) return res.status(400).json({ error: maxCheck5.error });

  try {
    const result = await placeSlotsBet(req.db, {
      userId: req.user.id, currency, betAmount: amount,
    });
    return res.json({ success: true, bet: result, balance: result.newBalance });
  } catch (err) {
    const isUserError = ["Insufficient balance", "Bet amount"].some(e => err.message.includes(e));
    return res.status(isUserError ? 400 : 500).json({ error: err.message });
  }
});

// ─── Bet History ─────────────────────────────────────────────────────────────
router.get("/bets", auth, async (req, res) => {
  const { limit = 20, offset = 0, game } = req.query;

  try {
    const bets = await getBetHistory(req.db, req.user.id, {
      limit: Math.min(parseInt(limit), 100),
      offset: parseInt(offset),
      game: game || null,
    });
    return res.json({ bets });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
