/**
 * Admin Routes — /api/admin
 * All routes require role = "admin"
 *
 * GET  /api/admin/stats               - Platform overview (includes daily PnL)
 * POST /api/admin/stats/reset          - Reset PnL tracking
 * GET  /api/admin/users               - List users
 * GET  /api/admin/users/:id           - Single user detail
 * PUT  /api/admin/users/:id/ban       - Ban/unban user
 * PUT  /api/admin/users/:id/credit    - Credit funds to user wallet
 * GET  /api/admin/withdrawals/pending - Pending withdrawals
 * PUT  /api/admin/withdrawals/:id     - Approve or reject withdrawal
 */

const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");

// Admin guard middleware
function adminOnly(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

router.use(auth, adminOnly);

// ─── Platform Stats ───────────────────────────────────────────────────────────
router.get("/stats", async (req, res) => {
  try {
    const [usersRes, betsRes, dailyBetsRes, depositRes, withdrawalRes] = await Promise.all([
      req.db.query("SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24h') AS last_24h FROM users"),
      req.db.query(`SELECT COUNT(*) AS total_bets,
                          SUM(bet_amount) AS total_wagered,
                          -SUM(profit) AS house_profit,
                          COUNT(*) FILTER (WHERE won = true) AS total_wins
                   FROM bets`),
      req.db.query(`SELECT COUNT(*) AS total_bets,
                          SUM(bet_amount) AS total_wagered,
                          -SUM(profit) AS house_profit,
                          COUNT(*) FILTER (WHERE won = true) AS total_wins
                   FROM bets WHERE created_at >= CURRENT_DATE`),
      req.db.query("SELECT currency, SUM(amount) AS total FROM deposits WHERE status = 'confirmed' GROUP BY currency"),
      req.db.query("SELECT COUNT(*) AS pending FROM withdrawals WHERE status = 'pending'"),
    ]);

    return res.json({
      users: {
        total: parseInt(usersRes.rows[0].total),
        last24h: parseInt(usersRes.rows[0].last_24h),
      },
      bets: {
        total: parseInt(betsRes.rows[0].total_bets),
        totalWagered: parseFloat(betsRes.rows[0].total_wagered || 0),
        houseProfit: parseFloat(betsRes.rows[0].house_profit || 0),
        totalWins: parseInt(betsRes.rows[0].total_wins),
      },
      daily: {
        total: parseInt(dailyBetsRes.rows[0].total_bets),
        totalWagered: parseFloat(dailyBetsRes.rows[0].total_wagered || 0),
        houseProfit: parseFloat(dailyBetsRes.rows[0].house_profit || 0),
        totalWins: parseInt(dailyBetsRes.rows[0].total_wins),
      },
      deposits: depositRes.rows,
      pendingWithdrawals: parseInt(withdrawalRes.rows[0].pending),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Reset PnL (deletes all bet records) ─────────────────────────────────────
router.post("/stats/reset", async (req, res) => {
  try {
    const result = await req.db.query("DELETE FROM bets");
    return res.json({ success: true, deletedBets: result.rowCount });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── List Users ───────────────────────────────────────────────────────────────
router.get("/users", async (req, res) => {
  const { limit = 50, offset = 0, search } = req.query;
  try {
    const searchClause = search ? `WHERE username ILIKE $3 OR email ILIKE $3` : "";
    const params = search
      ? [Math.min(parseInt(limit), 200), parseInt(offset), `%${search}%`]
      : [Math.min(parseInt(limit), 200), parseInt(offset)];

    const result = await req.db.query(
      `SELECT id, username, email, role, is_banned, created_at
       FROM users ${searchClause}
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      params
    );
    return res.json({ users: result.rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Single User ──────────────────────────────────────────────────────────────
router.get("/users/:id", async (req, res) => {
  try {
    const [userRes, walletsRes, betsRes] = await Promise.all([
      req.db.query("SELECT id, username, email, role, is_banned, created_at FROM users WHERE id = $1", [req.params.id]),
      req.db.query("SELECT currency, balance FROM wallets WHERE user_id = $1", [req.params.id]),
      req.db.query(
        `SELECT COUNT(*) AS total, SUM(bet_amount) AS wagered, SUM(profit) AS profit
         FROM bets WHERE user_id = $1`,
        [req.params.id]
      ),
    ]);

    if (userRes.rows.length === 0) return res.status(404).json({ error: "User not found" });

    return res.json({
      user: userRes.rows[0],
      wallets: walletsRes.rows,
      stats: betsRes.rows[0],
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Ban / Unban User ─────────────────────────────────────────────────────────
router.put("/users/:id/ban", async (req, res) => {
  const { banned } = req.body; // true = ban, false = unban
  if (typeof banned !== "boolean") {
    return res.status(400).json({ error: "banned must be true or false" });
  }
  try {
    await req.db.query("UPDATE users SET is_banned = $1 WHERE id = $2", [banned, req.params.id]);
    return res.json({ success: true, banned });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Credit Funds to User ─────────────────────────────────────────────────────
router.put("/users/:id/credit", async (req, res) => {
  const { currency, amount } = req.body;
  const VALID_CURRENCIES = ["USDT_POLYGON", "ETH_POLYGON", "USDT_TRON", "BTC"];

  if (!currency || !VALID_CURRENCIES.includes(currency)) {
    return res.status(400).json({ error: `currency must be one of: ${VALID_CURRENCIES.join(", ")}` });
  }
  const creditAmount = parseFloat(amount);
  if (!amount || isNaN(creditAmount) || creditAmount <= 0) {
    return res.status(400).json({ error: "amount must be a positive number" });
  }

  try {
    const walletRes = await req.db.query(
      "UPDATE wallets SET balance = balance + $1, updated_at = NOW() WHERE user_id = $2 AND currency = $3 RETURNING balance",
      [creditAmount, req.params.id, currency]
    );

    if (walletRes.rows.length === 0) {
      return res.status(404).json({ error: `No ${currency} wallet found for user ${req.params.id}` });
    }

    return res.json({
      success: true,
      userId: parseInt(req.params.id),
      currency,
      credited: creditAmount,
      newBalance: parseFloat(walletRes.rows[0].balance),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Pending Withdrawals ──────────────────────────────────────────────────────
router.get("/withdrawals/pending", async (req, res) => {
  try {
    const result = await req.db.query(
      `SELECT w.id, w.user_id, u.username, w.currency, w.amount, w.fee,
              w.to_address, w.review_required, w.created_at
       FROM withdrawals w
       JOIN users u ON u.id = w.user_id
       WHERE w.status = 'pending'
       ORDER BY w.created_at ASC`
    );
    return res.json({ withdrawals: result.rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Approve / Reject Withdrawal ─────────────────────────────────────────────
router.put("/withdrawals/:id", async (req, res) => {
  const { action, txHash } = req.body; // action: "approve" | "reject"

  if (!["approve", "reject"].includes(action)) {
    return res.status(400).json({ error: "action must be 'approve' or 'reject'" });
  }

  const client = await req.db.connect();
  try {
    await client.query("BEGIN");

    const wdRes = await client.query(
      "SELECT * FROM withdrawals WHERE id = $1 FOR UPDATE",
      [req.params.id]
    );
    if (wdRes.rows.length === 0) throw new Error("Withdrawal not found");
    const wd = wdRes.rows[0];

    if (wd.status !== "pending") {
      throw new Error(`Cannot ${action} a withdrawal with status '${wd.status}'`);
    }

    if (action === "approve") {
      await client.query(
        `UPDATE withdrawals SET status = 'sent', tx_hash = $1, processed_at = NOW() WHERE id = $2`,
        [txHash || null, wd.id]
      );
    } else {
      // Reject — refund balance
      await client.query(
        "UPDATE withdrawals SET status = 'failed', processed_at = NOW() WHERE id = $1",
        [wd.id]
      );
      await client.query(
        "UPDATE wallets SET balance = balance + $1 WHERE user_id = $2 AND currency = $3",
        [parseFloat(wd.amount) + parseFloat(wd.fee), wd.user_id, wd.currency]
      );
    }

    await client.query("COMMIT");
    return res.json({ success: true, action });
  } catch (err) {
    await client.query("ROLLBACK");
    return res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
