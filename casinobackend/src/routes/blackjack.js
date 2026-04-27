/**
 * Blackjack Routes — /api/games/blackjack
 *
 * POST /deal   - Start a new hand (deducts bet, returns initial cards)
 * POST /action - Hit, stand, or double on an active hand
 *
 * Game sessions are stored in memory (keyed by a UUID).
 * Each session has a 5-minute TTL.
 */

const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const { hashServerSeed } = require("../engine/rng");
const { dealInitialHands, drawCard, handValue, isBlackjack, cardValue } = require("../games/blackjack");
const auth = require("../middleware/auth");
const { validateMaxBet } = require("../engine/maxBet");

// In-memory game sessions — { gameId: { userId, wallet, cards, ... } }
const games = new Map();
const GAME_TTL = 5 * 60 * 1000;

// Cleanup stale games every 60s
setInterval(() => {
  const now = Date.now();
  for (const [id, g] of games) {
    if (now - g.createdAt > GAME_TTL) games.delete(id);
  }
}, 60_000);

// ─── Deal ─────────────────────────────────────────────────────────────────────
router.post("/deal", auth, async (req, res) => {
  const { currency, betAmount } = req.body;
  const userId = req.user.id;

  if (!currency || !betAmount) {
    return res.status(400).json({ error: "currency and betAmount required" });
  }

  const validCurrencies = ["USDT_POLYGON", "ETH_POLYGON", "USDT_TRON", "BTC"];
  if (!validCurrencies.includes(currency)) {
    return res.status(400).json({ error: "Invalid currency" });
  }

  const amount = parseFloat(betAmount);
  if (isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: "betAmount must be positive" });
  }

  const maxCheck = await validateMaxBet(currency, amount);
  if (!maxCheck.valid) return res.status(400).json({ error: maxCheck.error });

  const client = await req.db.connect();
  try {
    await client.query("BEGIN");

    const walletRes = await client.query(
      `SELECT id, balance, server_seed, client_seed, nonce
       FROM wallets WHERE user_id = $1 AND currency = $2 FOR UPDATE`,
      [userId, currency]
    );

    if (walletRes.rows.length === 0) throw new Error(`No ${currency} wallet found`);
    const wallet = walletRes.rows[0];
    const balance = parseFloat(wallet.balance);

    if (amount > balance) throw new Error("Insufficient balance");

    // Deduct bet
    await client.query(`UPDATE wallets SET balance = balance - $1 WHERE id = $2`, [amount, wallet.id]);
    const updatedBal = await client.query(`SELECT balance FROM wallets WHERE id = $1`, [wallet.id]);

    await client.query("COMMIT");

    // Deal cards
    const { playerCards, dealerCards } = dealInitialHands(
      wallet.server_seed, wallet.client_seed, wallet.nonce
    );

    const gameId = crypto.randomUUID();
    const session = {
      gameId,
      userId,
      currency,
      betAmount: amount,
      walletId: wallet.id,
      serverSeed: wallet.server_seed,
      clientSeed: wallet.client_seed,
      nonce: wallet.nonce,
      playerCards: [...playerCards],
      dealerCards: [...dealerCards],
      nextCursor: 4,
      doubled: false,
      finished: false,
      createdAt: Date.now(),
    };

    // Check for natural blackjack
    const playerBJ = isBlackjack(playerCards);
    const dealerBJ = isBlackjack(dealerCards);

    if (playerBJ || dealerBJ) {
      session.finished = true;
      let outcome, multiplier;
      if (playerBJ && dealerBJ) { outcome = "push"; multiplier = 1; }
      else if (playerBJ)        { outcome = "blackjack"; multiplier = 2.5; }
      else                      { outcome = "dealer_blackjack"; multiplier = 0; }

      const payout = parseFloat((amount * multiplier).toFixed(8));
      const profit = parseFloat((payout - amount).toFixed(8));

      // Credit payout
      if (payout > 0) {
        const c2 = await req.db.connect();
        try {
          await c2.query(`UPDATE wallets SET balance = balance + $1 WHERE id = $2`, [payout, wallet.id]);
          await c2.query(`UPDATE wallets SET nonce = nonce + 1 WHERE id = $1`, [wallet.id]);
          await c2.query(
            `INSERT INTO bets (user_id, currency, game, bet_amount, payout, profit, won, multiplier, server_seed_hash, client_seed, nonce, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, NOW())`,
            [userId, currency, "blackjack", amount, payout, profit, multiplier > 1,
             multiplier, hashServerSeed(wallet.server_seed), wallet.client_seed, wallet.nonce]
          );
        } finally { c2.release(); }
      } else {
        const c2 = await req.db.connect();
        try {
          await c2.query(`UPDATE wallets SET nonce = nonce + 1 WHERE id = $1`, [wallet.id]);
          await c2.query(
            `INSERT INTO bets (user_id, currency, game, bet_amount, payout, profit, won, multiplier, server_seed_hash, client_seed, nonce, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, NOW())`,
            [userId, currency, "blackjack", amount, 0, -amount, false,
             0, hashServerSeed(wallet.server_seed), wallet.client_seed, wallet.nonce]
          );
        } finally { c2.release(); }
      }

      const finalBal = await req.db.query(`SELECT balance FROM wallets WHERE id = $1`, [wallet.id]);

      return res.json({
        gameId,
        playerCards,
        dealerCards,
        playerValue: handValue(playerCards),
        dealerValue: handValue(dealerCards),
        finished: true,
        outcome,
        payout,
        profit,
        multiplier,
        balance: parseFloat(finalBal.rows[0].balance),
      });
    }

    games.set(gameId, session);

    return res.json({
      gameId,
      playerCards,
      dealerUpCard: dealerCards[0],
      playerValue: handValue(playerCards),
      finished: false,
      balance: parseFloat(updatedBal.rows[0].balance),
    });
  } catch (err) {
    await client.query("ROLLBACK");
    const isUserError = ["Insufficient balance"].some(e => err.message.includes(e));
    return res.status(isUserError ? 400 : 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── Action ───────────────────────────────────────────────────────────────────
router.post("/action", auth, async (req, res) => {
  const { gameId, action } = req.body;
  const userId = req.user.id;

  if (!gameId || !action) {
    return res.status(400).json({ error: "gameId and action required" });
  }

  if (!["hit", "stand", "double"].includes(action)) {
    return res.status(400).json({ error: "action must be hit, stand, or double" });
  }

  const session = games.get(gameId);
  if (!session) return res.status(404).json({ error: "Game not found or expired" });
  if (session.userId !== userId) return res.status(403).json({ error: "Not your game" });
  if (session.finished) return res.status(400).json({ error: "Game already finished" });

  const { serverSeed, clientSeed, nonce, playerCards, dealerCards, betAmount, walletId, currency } = session;

  if (action === "hit") {
    const card = drawCard(serverSeed, clientSeed, nonce, session.nextCursor);
    session.nextCursor++;
    playerCards.push(card);

    if (handValue(playerCards) > 21) {
      // Bust
      session.finished = true;
      games.delete(gameId);
      await finishGame(req.db, session, "bust");

      const finalBal = await req.db.query(`SELECT balance FROM wallets WHERE id = $1`, [walletId]);
      return res.json({
        gameId,
        playerCards,
        dealerCards,
        playerValue: handValue(playerCards),
        dealerValue: handValue(dealerCards),
        finished: true,
        outcome: "bust",
        payout: 0,
        profit: -betAmount,
        multiplier: 0,
        balance: parseFloat(finalBal.rows[0].balance),
      });
    }

    return res.json({
      gameId,
      playerCards,
      playerValue: handValue(playerCards),
      finished: false,
    });
  }

  if (action === "double") {
    // Deduct extra bet
    const client = await req.db.connect();
    try {
      await client.query("BEGIN");
      const wal = await client.query(
        `SELECT balance FROM wallets WHERE id = $1 FOR UPDATE`, [walletId]
      );
      if (parseFloat(wal.rows[0].balance) < betAmount) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Insufficient balance to double" });
      }
      await client.query(`UPDATE wallets SET balance = balance - $1 WHERE id = $2`, [betAmount, walletId]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      return res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }

    session.doubled = true;
    const card = drawCard(serverSeed, clientSeed, nonce, session.nextCursor);
    session.nextCursor++;
    playerCards.push(card);

    if (handValue(playerCards) > 21) {
      session.finished = true;
      games.delete(gameId);
      await finishGame(req.db, session, "bust");

      const finalBal = await req.db.query(`SELECT balance FROM wallets WHERE id = $1`, [walletId]);
      return res.json({
        gameId,
        playerCards,
        dealerCards,
        playerValue: handValue(playerCards),
        dealerValue: handValue(dealerCards),
        finished: true,
        outcome: "bust",
        payout: 0,
        profit: -(betAmount * 2),
        multiplier: 0,
        balance: parseFloat(finalBal.rows[0].balance),
      });
    }

    // Double means stand after one card — fall through to dealer play
  }

  // Stand (or after double)
  // Play dealer hand
  let cursor = session.nextCursor;
  while (handValue(dealerCards) < 17) {
    dealerCards.push(drawCard(serverSeed, clientSeed, nonce, cursor));
    cursor++;
  }

  const playerVal = handValue(playerCards);
  const dealerVal = handValue(dealerCards);

  let outcome;
  if (dealerVal > 21)          outcome = "dealer_bust";
  else if (playerVal > dealerVal) outcome = "win";
  else if (playerVal < dealerVal) outcome = "lose";
  else                          outcome = "push";

  session.finished = true;
  games.delete(gameId);

  const totalBet = session.doubled ? betAmount * 2 : betAmount;
  let multiplier;
  if (outcome === "win" || outcome === "dealer_bust") multiplier = 2;
  else if (outcome === "push") multiplier = 1;
  else multiplier = 0;

  const payout = parseFloat((totalBet * multiplier).toFixed(8));
  const profit = parseFloat((payout - totalBet).toFixed(8));

  // Credit payout and record bet
  const dbClient = await req.db.connect();
  try {
    await dbClient.query("BEGIN");
    if (payout > 0) {
      await dbClient.query(`UPDATE wallets SET balance = balance + $1 WHERE id = $2`, [payout, walletId]);
    }
    await dbClient.query(`UPDATE wallets SET nonce = nonce + 1 WHERE id = $1`, [walletId]);
    await dbClient.query(
      `INSERT INTO bets (user_id, currency, game, bet_amount, payout, profit, won, multiplier, server_seed_hash, client_seed, nonce, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, NOW())`,
      [userId, currency, "blackjack", totalBet, payout, profit, multiplier > 1,
       multiplier, hashServerSeed(serverSeed), clientSeed, nonce]
    );
    await dbClient.query("COMMIT");
  } catch (err) {
    await dbClient.query("ROLLBACK");
    throw err;
  } finally {
    dbClient.release();
  }

  const finalBal = await req.db.query(`SELECT balance FROM wallets WHERE id = $1`, [walletId]);

  return res.json({
    gameId,
    playerCards,
    dealerCards,
    playerValue: playerVal,
    dealerValue: dealerVal,
    finished: true,
    outcome,
    payout,
    profit,
    multiplier,
    balance: parseFloat(finalBal.rows[0].balance),
  });
});

async function finishGame(db, session, outcome) {
  const totalBet = session.doubled ? session.betAmount * 2 : session.betAmount;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE wallets SET nonce = nonce + 1 WHERE id = $1`, [session.walletId]);
    await client.query(
      `INSERT INTO bets (user_id, currency, game, bet_amount, payout, profit, won, multiplier, server_seed_hash, client_seed, nonce, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, NOW())`,
      [session.userId, session.currency, "blackjack", totalBet, 0, -totalBet, false,
       0, hashServerSeed(session.serverSeed), session.clientSeed, session.nonce]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = router;
