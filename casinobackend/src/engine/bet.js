/**
 * Bet Engine
 *
 * Handles the full lifecycle of a bet:
 *  1. Validate player balance (with DB row lock to prevent race conditions)
 *  2. Deduct bet amount atomically
 *  3. Resolve game outcome
 *  4. Credit winnings if won
 *  5. Record bet in history
 *  6. Increment nonce
 *
 * All balance changes happen inside a single PostgreSQL transaction.
 */

const { resolveDiceBet, validateBet } = require("../games/dice");
const { resolveRouletteBet, validateRouletteBet } = require("../games/roulette");
const { resolveBlackjackGame, validateBlackjackBet } = require("../games/blackjack");
const { resolvePlinkoBet, validatePlinkoBet } = require("../games/plinko");
const { resolveLimboBet, validateLimboBet } = require("../games/limbo");
const { resolveSlotsBet, validateSlotsBet } = require("../games/slots");
const { rotateSeed, hashServerSeed } = require("./rng");

/**
 * Place a dice bet
 *
 * @param {object} db      - pg Pool instance
 * @param {object} params
 * @param {number} params.userId
 * @param {string} params.currency   - "USDT_POLYGON" | "ETH_POLYGON" | "USDT_TRON" | "BTC"
 * @param {number} params.betAmount  - in the currency's base unit (e.g. USDT amount)
 * @param {number} params.target
 * @param {string} params.direction  - "under" | "over"
 *
 * @returns {object} bet result
 */
async function placeDiceBet(db, { userId, currency, betAmount, target, direction }) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    // 1. Lock the user's wallet row and read balance
    const walletRes = await client.query(
      `SELECT id, balance, server_seed, client_seed, nonce
       FROM wallets
       WHERE user_id = $1 AND currency = $2
       FOR UPDATE`,
      [userId, currency]
    );

    if (walletRes.rows.length === 0) {
      throw new Error(`No ${currency} wallet found for user`);
    }

    const wallet = walletRes.rows[0];
    const balance = parseFloat(wallet.balance);

    // 2. Validate the bet
    const validation = validateBet({ betAmount, target, direction, balance });
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // 3. Deduct bet amount immediately
    await client.query(
      `UPDATE wallets SET balance = balance - $1 WHERE id = $2`,
      [betAmount, wallet.id]
    );

    // 4. Resolve the outcome
    const result = resolveDiceBet({
      serverSeed: wallet.server_seed,
      clientSeed: wallet.client_seed,
      nonce: wallet.nonce,
      betAmount,
      target,
      direction,
    });

    // 5. Credit payout (partial or full — e.g. plinko 0.5x returns partial)
    if (result.payout > 0) {
      await client.query(
        `UPDATE wallets SET balance = balance + $1 WHERE id = $2`,
        [result.payout, wallet.id]
      );
    }

    // 6. Increment nonce
    await client.query(
      `UPDATE wallets SET nonce = nonce + 1 WHERE id = $1`,
      [wallet.id]
    );

    // 7. Record the bet
    const betRes = await client.query(
      `INSERT INTO bets (
        user_id, currency, game, bet_amount, payout, profit,
        won, roll, target, direction, multiplier,
        server_seed_hash, client_seed, nonce,
        created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, NOW())
      RETURNING id`,
      [
        userId,
        currency,
        "dice",
        betAmount,
        result.payout,
        result.profit,
        result.won,
        result.roll,
        target,
        direction,
        result.multiplier,
        hashServerSeed(wallet.server_seed), // never store raw seed in bet log
        wallet.client_seed,
        wallet.nonce,
      ]
    );

    // 8. Read updated balance
    const updatedWallet = await client.query(
      `SELECT balance FROM wallets WHERE id = $1`,
      [wallet.id]
    );

    await client.query("COMMIT");

    return {
      betId: betRes.rows[0].id,
      ...result,
      newBalance: parseFloat(updatedWallet.rows[0].balance),
      currency,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Rotate server seed (user requests new seed)
 * Reveals the old server seed for verification, issues a new one
 */
async function rotateServerSeed(db, userId, currency) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const walletRes = await client.query(
      `SELECT id, server_seed FROM wallets WHERE user_id = $1 AND currency = $2 FOR UPDATE`,
      [userId, currency]
    );

    if (walletRes.rows.length === 0) throw new Error("Wallet not found");

    const { id, server_seed } = walletRes.rows[0];
    const { revealedSeed, newServerSeed, newHashedSeed } = rotateSeed(server_seed);

    await client.query(
      `UPDATE wallets SET server_seed = $1, nonce = 0 WHERE id = $2`,
      [newServerSeed, id]
    );

    await client.query("COMMIT");

    return {
      revealedServerSeed: revealedSeed, // user can now verify past bets
      newServerSeedHash: newHashedSeed, // hash of next seed (commitment)
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get bet history for a user
 */
async function getBetHistory(db, userId, { limit = 20, offset = 0, game = null } = {}) {
  const gameFilter = game ? `AND game = $3` : "";
  const params = game ? [userId, limit, game] : [userId, limit];

  const res = await db.query(
    `SELECT id, currency, game, bet_amount, payout, profit, won,
            roll, target, direction, multiplier, client_seed,
            server_seed_hash, nonce, created_at
     FROM bets
     WHERE user_id = $1 ${gameFilter}
     ORDER BY created_at DESC
     LIMIT $2 OFFSET ${offset}`,
    params
  );

  return res.rows;
}

async function placeRouletteBet(db, { userId, currency, betAmount, betType, betValue }) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const walletRes = await client.query(
      `SELECT id, balance, server_seed, client_seed, nonce FROM wallets WHERE user_id = $1 AND currency = $2 FOR UPDATE`,
      [userId, currency]
    );
    if (walletRes.rows.length === 0) throw new Error(`No ${currency} wallet found for user`);
    const wallet = walletRes.rows[0];
    const balance = parseFloat(wallet.balance);

    const validation = validateRouletteBet({ betAmount, betType, betValue, balance });
    if (!validation.valid) throw new Error(validation.error);

    await client.query(`UPDATE wallets SET balance = balance - $1 WHERE id = $2`, [betAmount, wallet.id]);

    const result = resolveRouletteBet({
      serverSeed: wallet.server_seed, clientSeed: wallet.client_seed,
      nonce: wallet.nonce, betAmount, betType, betValue,
    });

    if (result.payout > 0) {
      await client.query(`UPDATE wallets SET balance = balance + $1 WHERE id = $2`, [result.payout, wallet.id]);
    }

    await client.query(`UPDATE wallets SET nonce = nonce + 1 WHERE id = $1`, [wallet.id]);

    const betRes = await client.query(
      `INSERT INTO bets (user_id, currency, game, bet_amount, payout, profit, won, roll, multiplier, server_seed_hash, client_seed, nonce, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, NOW()) RETURNING id`,
      [userId, currency, "roulette", betAmount, result.payout, result.profit, result.won,
       result.result, result.multiplier, hashServerSeed(wallet.server_seed), wallet.client_seed, wallet.nonce]
    );

    const updatedWallet = await client.query(`SELECT balance FROM wallets WHERE id = $1`, [wallet.id]);
    await client.query("COMMIT");
    return { betId: betRes.rows[0].id, ...result, newBalance: parseFloat(updatedWallet.rows[0].balance), currency };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
  finally { client.release(); }
}

async function placeBlackjackBet(db, { userId, currency, betAmount, actions }) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const walletRes = await client.query(
      `SELECT id, balance, server_seed, client_seed, nonce FROM wallets WHERE user_id = $1 AND currency = $2 FOR UPDATE`,
      [userId, currency]
    );
    if (walletRes.rows.length === 0) throw new Error(`No ${currency} wallet found for user`);
    const wallet = walletRes.rows[0];
    const balance = parseFloat(wallet.balance);

    const validation = validateBlackjackBet({ betAmount, balance });
    if (!validation.valid) throw new Error(validation.error);

    await client.query(`UPDATE wallets SET balance = balance - $1 WHERE id = $2`, [betAmount, wallet.id]);

    const result = resolveBlackjackGame({
      serverSeed: wallet.server_seed, clientSeed: wallet.client_seed,
      nonce: wallet.nonce, betAmount, actions,
    });

    // For double down, deduct extra bet amount
    if (result.doubled) {
      await client.query(`UPDATE wallets SET balance = balance - $1 WHERE id = $2`, [betAmount, wallet.id]);
    }

    if (result.payout > 0) {
      await client.query(`UPDATE wallets SET balance = balance + $1 WHERE id = $2`, [result.payout, wallet.id]);
    }

    await client.query(`UPDATE wallets SET nonce = nonce + 1 WHERE id = $1`, [wallet.id]);

    const betRes = await client.query(
      `INSERT INTO bets (user_id, currency, game, bet_amount, payout, profit, won, multiplier, server_seed_hash, client_seed, nonce, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, NOW()) RETURNING id`,
      [userId, currency, "blackjack", result.betAmount, result.payout, result.profit, result.won,
       result.multiplier, hashServerSeed(wallet.server_seed), wallet.client_seed, wallet.nonce]
    );

    const updatedWallet = await client.query(`SELECT balance FROM wallets WHERE id = $1`, [wallet.id]);
    await client.query("COMMIT");
    return { betId: betRes.rows[0].id, ...result, newBalance: parseFloat(updatedWallet.rows[0].balance), currency };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
  finally { client.release(); }
}

async function placePlinkoBet(db, { userId, currency, betAmount, rows, risk }) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const walletRes = await client.query(
      `SELECT id, balance, server_seed, client_seed, nonce FROM wallets WHERE user_id = $1 AND currency = $2 FOR UPDATE`,
      [userId, currency]
    );
    if (walletRes.rows.length === 0) throw new Error(`No ${currency} wallet found for user`);
    const wallet = walletRes.rows[0];
    const balance = parseFloat(wallet.balance);

    const validation = validatePlinkoBet({ betAmount, rows, risk, balance });
    if (!validation.valid) throw new Error(validation.error);

    await client.query(`UPDATE wallets SET balance = balance - $1 WHERE id = $2`, [betAmount, wallet.id]);

    const result = resolvePlinkoBet({
      serverSeed: wallet.server_seed, clientSeed: wallet.client_seed,
      nonce: wallet.nonce, betAmount, rows, risk,
    });

    if (result.payout > 0) {
      await client.query(`UPDATE wallets SET balance = balance + $1 WHERE id = $2`, [result.payout, wallet.id]);
    }

    await client.query(`UPDATE wallets SET nonce = nonce + 1 WHERE id = $1`, [wallet.id]);

    const betRes = await client.query(
      `INSERT INTO bets (user_id, currency, game, bet_amount, payout, profit, won, multiplier, server_seed_hash, client_seed, nonce, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, NOW()) RETURNING id`,
      [userId, currency, "plinko", betAmount, result.payout, result.profit, result.won,
       result.multiplier, hashServerSeed(wallet.server_seed), wallet.client_seed, wallet.nonce]
    );

    const updatedWallet = await client.query(`SELECT balance FROM wallets WHERE id = $1`, [wallet.id]);
    await client.query("COMMIT");
    return { betId: betRes.rows[0].id, ...result, newBalance: parseFloat(updatedWallet.rows[0].balance), currency };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
  finally { client.release(); }
}

async function placeLimboBet(db, { userId, currency, betAmount, target }) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const walletRes = await client.query(
      `SELECT id, balance, server_seed, client_seed, nonce FROM wallets WHERE user_id = $1 AND currency = $2 FOR UPDATE`,
      [userId, currency]
    );
    if (walletRes.rows.length === 0) throw new Error(`No ${currency} wallet found`);
    const wallet = walletRes.rows[0];
    const balance = parseFloat(wallet.balance);

    const validation = validateLimboBet({ betAmount, target, balance });
    if (!validation.valid) throw new Error(validation.error);

    await client.query(`UPDATE wallets SET balance = balance - $1 WHERE id = $2`, [betAmount, wallet.id]);

    const result = resolveLimboBet({
      serverSeed: wallet.server_seed, clientSeed: wallet.client_seed,
      nonce: wallet.nonce, betAmount, target,
    });

    if (result.payout > 0) {
      await client.query(`UPDATE wallets SET balance = balance + $1 WHERE id = $2`, [result.payout, wallet.id]);
    }

    await client.query(`UPDATE wallets SET nonce = nonce + 1 WHERE id = $1`, [wallet.id]);

    const betRes = await client.query(
      `INSERT INTO bets (user_id, currency, game, bet_amount, payout, profit, won, multiplier, roll, server_seed_hash, client_seed, nonce, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, NOW()) RETURNING id`,
      [userId, currency, "limbo", betAmount, result.payout, result.profit, result.won,
       result.multiplier, result.result, hashServerSeed(wallet.server_seed), wallet.client_seed, wallet.nonce]
    );

    const updatedWallet = await client.query(`SELECT balance FROM wallets WHERE id = $1`, [wallet.id]);
    await client.query("COMMIT");
    return { betId: betRes.rows[0].id, ...result, newBalance: parseFloat(updatedWallet.rows[0].balance), currency };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
  finally { client.release(); }
}

async function placeSlotsBet(db, { userId, currency, betAmount }) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const walletRes = await client.query(
      `SELECT id, balance, server_seed, client_seed, nonce FROM wallets WHERE user_id = $1 AND currency = $2 FOR UPDATE`,
      [userId, currency]
    );
    if (walletRes.rows.length === 0) throw new Error(`No ${currency} wallet found`);
    const wallet = walletRes.rows[0];
    const balance = parseFloat(wallet.balance);

    const validation = validateSlotsBet({ betAmount, balance });
    if (!validation.valid) throw new Error(validation.error);

    await client.query(`UPDATE wallets SET balance = balance - $1 WHERE id = $2`, [betAmount, wallet.id]);

    const result = resolveSlotsBet({
      serverSeed: wallet.server_seed, clientSeed: wallet.client_seed,
      nonce: wallet.nonce, betAmount,
    });

    if (result.payout > 0) {
      await client.query(`UPDATE wallets SET balance = balance + $1 WHERE id = $2`, [result.payout, wallet.id]);
    }

    await client.query(`UPDATE wallets SET nonce = nonce + 1 WHERE id = $1`, [wallet.id]);

    const betRes = await client.query(
      `INSERT INTO bets (user_id, currency, game, bet_amount, payout, profit, won, multiplier, server_seed_hash, client_seed, nonce, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, NOW()) RETURNING id`,
      [userId, currency, "slots", betAmount, result.payout, result.profit, result.won,
       result.multiplier, hashServerSeed(wallet.server_seed), wallet.client_seed, wallet.nonce]
    );

    const updatedWallet = await client.query(`SELECT balance FROM wallets WHERE id = $1`, [wallet.id]);
    await client.query("COMMIT");
    return { betId: betRes.rows[0].id, ...result, newBalance: parseFloat(updatedWallet.rows[0].balance), currency };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
  finally { client.release(); }
}

module.exports = {
  placeDiceBet,
  placeRouletteBet,
  placeBlackjackBet,
  placePlinkoBet,
  placeLimboBet,
  placeSlotsBet,
  rotateServerSeed,
  getBetHistory,
};
