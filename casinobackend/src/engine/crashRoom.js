/**
 * Crash Game Room
 *
 * WAITING (5s) → RUNNING (until crash) → CRASHED (3s) → WAITING ...
 *
 * Bets placed during RUNNING are queued for the NEXT round.
 * Bets placed during WAITING go into the current round.
 */

const crypto = require("crypto");
const { getCrashPoint, getMultiplierAtTime, getTimeForMultiplier } = require("../games/crash");

const WAITING_DURATION_MS = 5000;  // 5s betting window
const CRASHED_DURATION_MS = 3000;  // 3s result display
const TICK_INTERVAL_MS    = 100;

class CrashRoom {
  constructor(db, broadcast) {
    this.db        = db;
    this.broadcast = broadcast;

    this.state      = "waiting";
    this.roundId    = null;
    this.serverSeed = null;
    this.seedHash   = null;
    this.crashPoint = null;
    this.startedAt  = null;
    this.waitingStartedAt = null;

    this.bets       = new Map(); // current round: userId → bet
    this.queuedBets = new Map(); // next round: userId → pending bet params
    this.history    = [];
    this.tickTimer  = null;
    this.phaseTimer = null;
  }

  async start() {
    await this._loadHistory();
    this._beginWaiting();
  }

  // ─── WAITING ───────────────────────────────────────────────────────────────
  async _beginWaiting() {
    this.state            = "waiting";
    this.bets             = new Map();
    this.waitingStartedAt = Date.now();
    this.serverSeed       = crypto.randomBytes(32).toString("hex");
    this.seedHash         = crypto.createHash("sha256").update(this.serverSeed).digest("hex");

    // Process queued bets from last round — place them for this round
    const pendingQueue = new Map(this.queuedBets);
    this.queuedBets = new Map();

    const result = await this.db.query(
      `INSERT INTO crash_rounds (server_seed, server_seed_hash, status)
       VALUES ($1, $2, 'waiting') RETURNING id`,
      [this.serverSeed, this.seedHash]
    );
    this.roundId    = result.rows[0].id;
    this.crashPoint = getCrashPoint(this.serverSeed, this.roundId);

    this.broadcast({
      type: "waiting",
      roundId: this.roundId,
      serverSeedHash: this.seedHash,
      duration: WAITING_DURATION_MS,
      waitingStartedAt: this.waitingStartedAt,
      history: this.history,
    });

    // Auto-place queued bets
    for (const [userId, params] of pendingQueue.entries()) {
      try {
        await this._placeBetInternal(userId, params.username, params);
        // Notify the user their queued bet was placed
        this.broadcast({
          type: "queued_bet_placed",
          userId,
          username: params.username,
          betAmount: params.betAmount,
          currency: params.currency,
        });
      } catch (err) {
        console.error(`Failed to place queued bet for user ${userId}:`, err.message);
      }
    }

    this.phaseTimer = setTimeout(() => this._beginRunning(), WAITING_DURATION_MS);
  }

  // ─── RUNNING ───────────────────────────────────────────────────────────────
  async _beginRunning() {
    this.state     = "running";
    this.startedAt = Date.now();

    await this.db.query(
      `UPDATE crash_rounds SET status = 'running', started_at = NOW() WHERE id = $1`,
      [this.roundId]
    );

    this.broadcast({ type: "running", roundId: this.roundId, startedAt: this.startedAt });

    this.tickTimer  = setInterval(() => this._tick(), TICK_INTERVAL_MS);
    const crashTime = getTimeForMultiplier(this.crashPoint);
    this.phaseTimer = setTimeout(() => this._crash(), crashTime);
  }

  _tick() {
    if (this.state !== "running") return;
    const elapsed           = Date.now() - this.startedAt;
    const currentMultiplier = getMultiplierAtTime(elapsed);
    for (const [userId, bet] of this.bets.entries()) {
      if (!bet.cashedOut && bet.autoCashout && currentMultiplier >= bet.autoCashout) {
        this._processCashout(userId, currentMultiplier);
      }
    }
  }

  // ─── CRASHED ───────────────────────────────────────────────────────────────
  async _crash() {
    clearInterval(this.tickTimer);
    this.state = "crashed";

    for (const [userId, bet] of this.bets.entries()) {
      if (!bet.cashedOut) await this._settleLoss(userId, bet);
    }

    await this.db.query(
      `UPDATE crash_rounds SET status='crashed', crash_point=$1, server_seed=$2, crashed_at=NOW() WHERE id=$3`,
      [this.crashPoint, this.serverSeed, this.roundId]
    );

    this.history.unshift(this.crashPoint);
    if (this.history.length > 20) this.history.pop();

    this.broadcast({
      type: "crashed",
      roundId: this.roundId,
      crashPoint: this.crashPoint,
      serverSeed: this.serverSeed,
    });

    this.phaseTimer = setTimeout(() => this._beginWaiting(), CRASHED_DURATION_MS);
  }

  // ─── Place Bet (public) ────────────────────────────────────────────────────
  async placeBet(userId, username, { betAmount, currency, autoCashout }) {
    if (betAmount <= 0) throw new Error("Bet amount must be positive");

    // During RUNNING — queue for next round
    if (this.state === "running") {
      if (this.queuedBets.has(userId)) throw new Error("You already have a bet queued for the next round");
      if (this.bets.has(userId)) throw new Error("You already have an active bet this round");

      // Pre-deduct balance now so user can't spend it
      const client = await this.db.connect();
      try {
        await client.query("BEGIN");
        const walletRes = await client.query(
          `SELECT id, balance FROM wallets WHERE user_id = $1 AND currency = $2 FOR UPDATE`,
          [userId, currency]
        );
        if (!walletRes.rows.length) throw new Error("Wallet not found");
        const balance = parseFloat(walletRes.rows[0].balance);
        if (betAmount > balance) throw new Error("Insufficient balance");

        await client.query(
          `UPDATE wallets SET balance = balance - $1 WHERE id = $2`,
          [betAmount, walletRes.rows[0].id]
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }

      this.queuedBets.set(userId, { username, betAmount, currency, autoCashout: autoCashout || null, preDeducted: true });
      return { success: true, queued: true, message: "Bet queued for the next round" };
    }

    // During WAITING — place immediately
    if (this.state === "waiting") {
      if (this.bets.has(userId)) throw new Error("You already have a bet this round");
      return this._placeBetInternal(userId, username, { betAmount, currency, autoCashout });
    }

    // During CRASHED
    if (this.state === "crashed") {
      throw new Error("Round just ended — wait a moment for the next round");
    }
  }

  async _placeBetInternal(userId, username, { betAmount, currency, autoCashout, preDeducted }) {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");

      if (!preDeducted) {
        const walletRes = await client.query(
          `SELECT id, balance FROM wallets WHERE user_id = $1 AND currency = $2 FOR UPDATE`,
          [userId, currency]
        );
        if (!walletRes.rows.length) throw new Error("Wallet not found");
        const balance = parseFloat(walletRes.rows[0].balance);
        if (betAmount > balance) throw new Error("Insufficient balance");
        await client.query(
          `UPDATE wallets SET balance = balance - $1 WHERE id = $2`,
          [betAmount, walletRes.rows[0].id]
        );
      }

      await client.query(
        `INSERT INTO crash_bets (round_id, user_id, currency, bet_amount, auto_cashout)
         VALUES ($1, $2, $3, $4, $5)`,
        [this.roundId, userId, currency, betAmount, autoCashout || null]
      );

      await client.query("COMMIT");

      this.bets.set(userId, {
        username, betAmount, currency,
        autoCashout: autoCashout || null,
        cashedOut: false, payout: 0,
      });

      this.broadcast({ type: "player_bet", username, betAmount, currency });
      return { success: true, queued: false, betAmount, currency };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  // ─── Cash Out ──────────────────────────────────────────────────────────────
  async cashOut(userId) {
    if (this.state !== "running") throw new Error("Game is not running");
    const bet = this.bets.get(userId);
    if (!bet) throw new Error("No active bet this round");
    if (bet.cashedOut) throw new Error("Already cashed out");
    const elapsed    = Date.now() - this.startedAt;
    const multiplier = getMultiplierAtTime(elapsed);
    return this._processCashout(userId, multiplier);
  }

  async _processCashout(userId, multiplier) {
    const bet = this.bets.get(userId);
    if (!bet || bet.cashedOut) return;
    bet.cashedOut = true;
    const payout = parseFloat((bet.betAmount * multiplier).toFixed(8));
    bet.payout   = payout;

    await this.db.query(
      `UPDATE wallets SET balance = balance + $1 WHERE user_id = $2 AND currency = $3`,
      [payout, userId, bet.currency]
    );
    await this.db.query(
      `UPDATE crash_bets SET cashout_at=$1, payout=$2, won=true WHERE round_id=$3 AND user_id=$4`,
      [multiplier, payout, this.roundId, userId]
    );
    this.broadcast({ type: "player_cashout", username: bet.username, multiplier, payout });
    return { success: true, multiplier, payout };
  }

  async _settleLoss(userId, bet) {
    await this.db.query(
      `UPDATE crash_bets SET payout=0, won=false WHERE round_id=$1 AND user_id=$2`,
      [this.roundId, userId]
    );
  }

  getState() {
    const elapsed = this.state === "running" ? Date.now() - this.startedAt : 0;
    return {
      state: this.state,
      roundId: this.roundId,
      serverSeedHash: this.seedHash,
      startedAt: this.startedAt,
      waitingStartedAt: this.waitingStartedAt,
      waitingDuration: WAITING_DURATION_MS,
      history: this.history,
      currentMultiplier: this.state === "running" ? getMultiplierAtTime(elapsed) : null,
      activeBets: [...this.bets.entries()].map(([, b]) => ({
        username: b.username, betAmount: b.betAmount,
        currency: b.currency, cashedOut: b.cashedOut, payout: b.payout,
      })),
    };
  }

  hasBet(userId)  { return this.bets.has(userId) || this.queuedBets.has(userId); }
  getBet(userId)  { return this.bets.get(userId); }

  async _loadHistory() {
    try {
      const res = await this.db.query(
        `SELECT crash_point FROM crash_rounds WHERE status='crashed' ORDER BY id DESC LIMIT 20`
      );
      this.history = res.rows.map(r => parseFloat(r.crash_point));
    } catch {}
  }

  stop() {
    clearInterval(this.tickTimer);
    clearTimeout(this.phaseTimer);
  }
}

module.exports = CrashRoom;
