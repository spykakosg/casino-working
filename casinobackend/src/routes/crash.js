/**
 * Crash Routes — /api/crash
 *
 * WebSocket: GET /api/crash/ws   (upgrade)
 * REST:
 *   POST /api/crash/bet          - Place a bet
 *   POST /api/crash/cashout      - Cash out
 *   GET  /api/crash/state        - Current game state
 *   GET  /api/crash/history      - Past rounds
 *   GET  /api/crash/verify/:id   - Verify a past round
 */

const express  = require("express");
const router   = express.Router();
const { WebSocketServer } = require("ws");
const jwt      = require("jsonwebtoken");
const CrashRoom = require("../engine/crashRoom");
const auth     = require("../middleware/auth");

let room = null; // singleton CrashRoom

/**
 * Called once from app.js to boot the crash game
 */
function initCrash(server, db) {
  const wss = new WebSocketServer({ noServer: true });

  // Broadcast to all connected clients
  function broadcast(msg) {
    const data = JSON.stringify(msg);
    wss.clients.forEach(ws => {
      if (ws.readyState === 1) ws.send(data);
    });
  }

  room = new CrashRoom(db, broadcast);
  room.start();

  // Handle WS upgrade at /api/crash/ws
  server.on("upgrade", (req, socket, head) => {
    if (req.url !== "/api/crash/ws") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, ws => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws, req) => {
    let userId   = null;
    let username = null;

    // Send current state immediately on connect
    ws.send(JSON.stringify({ type: "init", ...room.getState() }));

    ws.on("message", async raw => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      // Auth message — client sends JWT to identify themselves
      if (msg.type === "auth") {
        try {
          const payload = jwt.verify(msg.token, process.env.JWT_SECRET);
          userId   = payload.sub;
          username = payload.username;
          ws.send(JSON.stringify({ type: "auth_ok", username }));
        } catch {
          ws.send(JSON.stringify({ type: "error", message: "Invalid token" }));
        }
        return;
      }

      if (!userId) {
        ws.send(JSON.stringify({ type: "error", message: "Not authenticated" }));
        return;
      }

      // Bet
      if (msg.type === "bet") {
        try {
          const result = await room.placeBet(userId, username, {
            betAmount:   parseFloat(msg.betAmount),
            currency:    msg.currency,
            autoCashout: msg.autoCashout ? parseFloat(msg.autoCashout) : null,
          });
          ws.send(JSON.stringify({ type: "bet_accepted", ...result }));
        } catch (err) {
          ws.send(JSON.stringify({ type: "error", message: err.message }));
        }
        return;
      }

      // Cashout
      if (msg.type === "cashout") {
        try {
          const result = await room.cashOut(userId);
          ws.send(JSON.stringify({ type: "cashout_accepted", ...result }));
        } catch (err) {
          ws.send(JSON.stringify({ type: "error", message: err.message }));
        }
        return;
      }
    });

    ws.on("close", () => {});
  });

  console.log("🚀 Crash game started");
  return router;
}

// ─── REST endpoints ───────────────────────────────────────────────────────────

// Current game state
router.get("/state", (req, res) => {
  if (!room) return res.status(503).json({ error: "Crash game not initialized" });
  res.json(room.getState());
});

// Bet via REST (fallback for clients without WS)
router.post("/bet", auth, async (req, res) => {
  if (!room) return res.status(503).json({ error: "Crash game not initialized" });
  const { betAmount, currency, autoCashout } = req.body;
  try {
    const result = await room.placeBet(req.user.id, req.user.username, {
      betAmount: parseFloat(betAmount),
      currency,
      autoCashout: autoCashout ? parseFloat(autoCashout) : null,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Cashout via REST
router.post("/cashout", auth, async (req, res) => {
  if (!room) return res.status(503).json({ error: "Crash game not initialized" });
  try {
    const result = await room.cashOut(req.user.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Round history
router.get("/history", async (req, res) => {
  const { limit = 20, offset = 0 } = req.query;
  try {
    const result = await req.db.query(
      `SELECT id, crash_point, server_seed, server_seed_hash, started_at, crashed_at
       FROM crash_rounds
       WHERE status = 'crashed'
       ORDER BY id DESC
       LIMIT $1 OFFSET $2`,
      [Math.min(parseInt(limit), 100), parseInt(offset)]
    );
    res.json({ rounds: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Verify a past round
router.get("/verify/:id", async (req, res) => {
  try {
    const result = await req.db.query(
      `SELECT id, crash_point, server_seed, server_seed_hash FROM crash_rounds WHERE id = $1`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Round not found" });

    const round = result.rows[0];
    if (!round.server_seed) return res.json({ message: "Round not yet complete" });

    const { verifyCrashPoint } = require("../games/crash");
    const verification = verifyCrashPoint(
      round.server_seed,
      round.server_seed_hash,
      round.id,
      parseFloat(round.crash_point)
    );

    res.json({ round, verification });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, initCrash };

// Player's own crash bet history
router.get("/my-bets", auth, async (req, res) => {
  const { limit = 20, offset = 0 } = req.query;
  try {
    const result = await req.db.query(
      `SELECT cb.id, cb.round_id, cb.currency, cb.bet_amount, cb.auto_cashout,
              cb.cashout_at, cb.payout, cb.won, cb.created_at,
              cr.crash_point, cr.server_seed_hash
       FROM crash_bets cb
       JOIN crash_rounds cr ON cr.id = cb.round_id
       WHERE cb.user_id = $1
       ORDER BY cb.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, Math.min(parseInt(limit), 100), parseInt(offset)]
    );
    res.json({ bets: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
