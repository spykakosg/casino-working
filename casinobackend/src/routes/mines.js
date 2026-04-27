/**
 * Mines Routes — /api/mines
 *
 * POST /start    - Start a new mines game (deducts bet)
 * POST /reveal   - Reveal a tile
 * POST /cashout  - Cash out current winnings
 */

const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const { hashServerSeed } = require("../engine/rng");
const { generateMinePositions, calculateMultiplier, getNextMultiplier, validateMinesBet } = require("../games/mines");
const auth = require("../middleware/auth");
const { validateMaxBet } = require("../engine/maxBet");

const games = new Map();
const GAME_TTL = 10 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [id, g] of games) {
    if (now - g.createdAt > GAME_TTL) games.delete(id);
  }
}, 60_000);

router.post("/start", auth, async (req, res) => {
  const { currency, betAmount, mineCount } = req.body;
  const userId = req.user.id;

  if (!currency || !betAmount || !mineCount) {
    return res.status(400).json({ error: "currency, betAmount, mineCount required" });
  }

  const validCurrencies = ["USDT_POLYGON", "ETH_POLYGON", "USDT_TRON", "BTC"];
  if (!validCurrencies.includes(currency)) return res.status(400).json({ error: "Invalid currency" });

  const amount = parseFloat(betAmount);
  const mines = parseInt(mineCount);

  const maxCheck = await validateMaxBet(currency, amount);
  if (!maxCheck.valid) return res.status(400).json({ error: maxCheck.error });

  const client = await req.db.connect();
  try {
    await client.query("BEGIN");
    const walletRes = await client.query(
      `SELECT id, balance, server_seed, client_seed, nonce FROM wallets WHERE user_id = $1 AND currency = $2 FOR UPDATE`,
      [userId, currency]
    );
    if (walletRes.rows.length === 0) throw new Error(`No ${currency} wallet found`);
    const wallet = walletRes.rows[0];
    const balance = parseFloat(wallet.balance);

    const validation = validateMinesBet({ betAmount: amount, mineCount: mines, balance });
    if (!validation.valid) throw new Error(validation.error);

    await client.query(`UPDATE wallets SET balance = balance - $1 WHERE id = $2`, [amount, wallet.id]);
    const updatedBal = await client.query(`SELECT balance FROM wallets WHERE id = $1`, [wallet.id]);
    await client.query("COMMIT");

    const minePositions = generateMinePositions(wallet.server_seed, wallet.client_seed, wallet.nonce, mines);

    const gameId = crypto.randomUUID();
    games.set(gameId, {
      gameId, userId, currency,
      betAmount: amount, mineCount: mines,
      walletId: wallet.id,
      serverSeed: wallet.server_seed, clientSeed: wallet.client_seed,
      nonce: wallet.nonce,
      minePositions,
      revealed: [],
      finished: false,
      createdAt: Date.now(),
    });

    return res.json({
      gameId,
      mineCount: mines,
      nextMultiplier: getNextMultiplier(mines, 0),
      balance: parseFloat(updatedBal.rows[0].balance),
    });
  } catch (err) {
    await client.query("ROLLBACK");
    const isUserError = ["Insufficient balance", "Mine count", "Bet amount"].some(e => err.message.includes(e));
    return res.status(isUserError ? 400 : 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.post("/reveal", auth, async (req, res) => {
  const { gameId, tileIndex } = req.body;
  const userId = req.user.id;

  if (!gameId || tileIndex === undefined) return res.status(400).json({ error: "gameId and tileIndex required" });

  const session = games.get(gameId);
  if (!session) return res.status(404).json({ error: "Game not found or expired" });
  if (session.userId !== userId) return res.status(403).json({ error: "Not your game" });
  if (session.finished) return res.status(400).json({ error: "Game already finished" });

  const tile = parseInt(tileIndex);
  if (tile < 0 || tile > 24) return res.status(400).json({ error: "Invalid tile index" });
  if (session.revealed.includes(tile)) return res.status(400).json({ error: "Tile already revealed" });

  const isMine = session.minePositions.includes(tile);

  if (isMine) {
    session.finished = true;
    games.delete(gameId);

    // Record loss
    const client = await req.db.connect();
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE wallets SET nonce = nonce + 1 WHERE id = $1`, [session.walletId]);
      await client.query(
        `INSERT INTO bets (user_id, currency, game, bet_amount, payout, profit, won, multiplier, server_seed_hash, client_seed, nonce, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, NOW())`,
        [session.userId, session.currency, "mines", session.betAmount, 0, -session.betAmount, false,
         0, hashServerSeed(session.serverSeed), session.clientSeed, session.nonce]
      );
      await client.query("COMMIT");
    } catch (err) { await client.query("ROLLBACK"); throw err; }
    finally { client.release(); }

    const finalBal = await req.db.query(`SELECT balance FROM wallets WHERE id = $1`, [session.walletId]);

    return res.json({
      gameId, tileIndex: tile, isMine: true,
      minePositions: session.minePositions,
      gameOver: true,
      payout: 0, profit: -session.betAmount,
      balance: parseFloat(finalBal.rows[0].balance),
    });
  }

  session.revealed.push(tile);
  const currentMultiplier = calculateMultiplier(session.mineCount, session.revealed.length);
  const safeTilesLeft = 25 - session.mineCount - session.revealed.length;

  // Auto-win if all safe tiles revealed
  if (safeTilesLeft === 0) {
    session.finished = true;
    games.delete(gameId);
    const payout = parseFloat((session.betAmount * currentMultiplier).toFixed(8));
    const profit = parseFloat((payout - session.betAmount).toFixed(8));

    const client = await req.db.connect();
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE wallets SET balance = balance + $1 WHERE id = $2`, [payout, session.walletId]);
      await client.query(`UPDATE wallets SET nonce = nonce + 1 WHERE id = $1`, [session.walletId]);
      await client.query(
        `INSERT INTO bets (user_id, currency, game, bet_amount, payout, profit, won, multiplier, server_seed_hash, client_seed, nonce, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, NOW())`,
        [session.userId, session.currency, "mines", session.betAmount, payout, profit, true,
         currentMultiplier, hashServerSeed(session.serverSeed), session.clientSeed, session.nonce]
      );
      await client.query("COMMIT");
    } catch (err) { await client.query("ROLLBACK"); throw err; }
    finally { client.release(); }

    const finalBal = await req.db.query(`SELECT balance FROM wallets WHERE id = $1`, [session.walletId]);

    return res.json({
      gameId, tileIndex: tile, isMine: false,
      minePositions: session.minePositions,
      gameOver: true, autoWin: true,
      currentMultiplier, payout, profit,
      balance: parseFloat(finalBal.rows[0].balance),
    });
  }

  return res.json({
    gameId, tileIndex: tile, isMine: false,
    revealed: session.revealed,
    currentMultiplier,
    currentPayout: parseFloat((session.betAmount * currentMultiplier).toFixed(8)),
    nextMultiplier: getNextMultiplier(session.mineCount, session.revealed.length),
    gameOver: false,
  });
});

router.post("/cashout", auth, async (req, res) => {
  const { gameId } = req.body;
  const userId = req.user.id;

  if (!gameId) return res.status(400).json({ error: "gameId required" });

  const session = games.get(gameId);
  if (!session) return res.status(404).json({ error: "Game not found or expired" });
  if (session.userId !== userId) return res.status(403).json({ error: "Not your game" });
  if (session.finished) return res.status(400).json({ error: "Game already finished" });
  if (session.revealed.length === 0) return res.status(400).json({ error: "Must reveal at least one tile" });

  session.finished = true;
  games.delete(gameId);

  const multiplier = calculateMultiplier(session.mineCount, session.revealed.length);
  const payout = parseFloat((session.betAmount * multiplier).toFixed(8));
  const profit = parseFloat((payout - session.betAmount).toFixed(8));

  const client = await req.db.connect();
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE wallets SET balance = balance + $1 WHERE id = $2`, [payout, session.walletId]);
    await client.query(`UPDATE wallets SET nonce = nonce + 1 WHERE id = $1`, [session.walletId]);
    await client.query(
      `INSERT INTO bets (user_id, currency, game, bet_amount, payout, profit, won, multiplier, server_seed_hash, client_seed, nonce, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, NOW())`,
      [session.userId, session.currency, "mines", session.betAmount, payout, profit, true,
       multiplier, hashServerSeed(session.serverSeed), session.clientSeed, session.nonce]
    );
    await client.query("COMMIT");
  } catch (err) { await client.query("ROLLBACK"); throw err; }
  finally { client.release(); }

  const finalBal = await req.db.query(`SELECT balance FROM wallets WHERE id = $1`, [session.walletId]);

  return res.json({
    gameId,
    minePositions: session.minePositions,
    multiplier, payout, profit,
    balance: parseFloat(finalBal.rows[0].balance),
  });
});

module.exports = router;
