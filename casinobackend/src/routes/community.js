const express = require("express");
const crypto = require("crypto");
const auth = require("../middleware/auth");
const { rollDice, hashServerSeed } = require("../engine/rng");

const router = express.Router();

async function ensureReferralTable(db) {
  await db.query(
    `CREATE TABLE IF NOT EXISTS referral_codes (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code VARCHAR(32) UNIQUE NOT NULL,
      uses_count INTEGER NOT NULL DEFAULT 0,
      bonus_credits NUMERIC(28, 8) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  );

  await db.query(
    `CREATE TABLE IF NOT EXISTS referral_earnings (
      id BIGSERIAL PRIMARY KEY,
      referrer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      referred_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      currency VARCHAR(20) NOT NULL,
      game VARCHAR(32) NOT NULL,
      wager_amount NUMERIC(28, 8) NOT NULL,
      commission_rate NUMERIC(8, 4) NOT NULL,
      commission_amount NUMERIC(28, 8) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  );
}

router.get("/profile", auth, async (req, res) => {
  try {
    const [statsRes, betsRes, seedsRes] = await Promise.all([
      req.db.query(
        `SELECT COUNT(*)::int AS total_bets,
                COALESCE(SUM(bet_amount), 0) AS total_wagered,
                COALESCE(SUM(profit), 0) AS net_profit,
                COALESCE(SUM(CASE WHEN won THEN 1 ELSE 0 END), 0)::int AS wins
         FROM bets WHERE user_id = $1`,
        [req.user.id]
      ),
      req.db.query(
        `SELECT id, game, currency, bet_amount, payout, profit, won, created_at
         FROM bets WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [req.user.id]
      ),
      req.db.query(
        `SELECT currency, client_seed, nonce, server_seed FROM wallets WHERE user_id = $1`,
        [req.user.id]
      )
    ]);

    const stats = statsRes.rows[0];
    const totalBets = Number(stats.total_bets || 0);

    res.json({
      stats: {
        totalBets,
        totalWagered: Number(stats.total_wagered || 0),
        netProfit: Number(stats.net_profit || 0),
        wins: Number(stats.wins || 0),
        winRate: totalBets > 0 ? Number(((Number(stats.wins) / totalBets) * 100).toFixed(2)) : 0,
      },
      bets: betsRes.rows,
      seeds: seedsRes.rows.map((s) => ({
        currency: s.currency,
        clientSeed: s.client_seed,
        nonce: s.nonce,
        serverSeedHash: hashServerSeed(s.server_seed),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to load profile" });
  }
});

router.get("/leaderboard", async (req, res) => {
  const period = req.query.period || "all";

  let timeFilter = "";
  if (period === "daily") timeFilter = "AND b.created_at >= NOW() - INTERVAL '1 day'";
  if (period === "weekly") timeFilter = "AND b.created_at >= NOW() - INTERVAL '7 day'";

  const metric = "COALESCE(SUM(b.bet_amount), 0)";

  try {
    const result = await req.db.query(
      `SELECT u.id, u.username, ${metric} AS value,
              COUNT(*)::int as bets
       FROM bets b
       JOIN users u ON u.id = b.user_id
       WHERE 1=1 ${timeFilter}
       GROUP BY u.id, u.username
       ORDER BY value DESC
       LIMIT 50`
    );

    res.json({ period, type: "wagered", leaderboard: result.rows.map((r, i) => ({ rank: i + 1, ...r, value: Number(r.value) })) });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch leaderboard" });
  }
});

router.post("/referral/create", auth, async (req, res) => {
  try {
    await ensureReferralTable(req.db);
    const existing = await req.db.query(
      `SELECT code FROM referral_codes WHERE user_id = $1`,
      [req.user.id]
    );
    if (existing.rows[0]) {
      return res.json({ code: existing.rows[0].code, existing: true });
    }

    let code = crypto.randomBytes(4).toString("hex").toUpperCase();
    let saved = false;
    for (let i = 0; i < 5 && !saved; i += 1) {
      try {
        await req.db.query(
          `INSERT INTO referral_codes (user_id, code)
           VALUES ($1, $2)`,
          [req.user.id, code]
        );
        saved = true;
      } catch (err) {
        if (err.code !== "23505") throw err;
        code = crypto.randomBytes(4).toString("hex").toUpperCase();
      }
    }

    if (!saved) {
      return res.status(500).json({ error: "Failed to generate unique affiliate code" });
    }

    res.json({ code, existing: false });
  } catch (err) {
    res.status(400).json({ error: "Unable to create referral code" });
  }
});

router.get("/referral/me", auth, async (req, res) => {
  try {
    await ensureReferralTable(req.db);
    const result = await req.db.query(
      `SELECT code, uses_count, bonus_credits FROM referral_codes WHERE user_id = $1`,
      [req.user.id]
    );
    res.json({ referral: result.rows[0] || null });
  } catch (err) {
    res.status(500).json({ error: "Failed to load referral" });
  }
});


router.get("/referral/stats", auth, async (req, res) => {
  try {
    await ensureReferralTable(req.db);
    const codeRes = await req.db.query(`SELECT code FROM referral_codes WHERE user_id = $1`, [req.user.id]);
    if (!codeRes.rows[0]) return res.json({ code: null, totals: { referees: 0, totalWagered: 0, totalCommission: 0 }, affiliates: [] });

    const code = codeRes.rows[0].code;
    const listRes = await req.db.query(
      `SELECT u.id, u.username,
              COALESCE(SUM(b.bet_amount), 0) AS wagered,
              COALESCE(SUM(re.commission_amount), 0) AS commission,
              MAX(b.created_at) AS last_bet_at
       FROM users u
       LEFT JOIN bets b ON b.user_id = u.id
       LEFT JOIN referral_earnings re ON re.referred_user_id = u.id AND re.referrer_user_id = $1
       WHERE u.referred_by_code = $2
       GROUP BY u.id, u.username
       ORDER BY wagered DESC`,
      [req.user.id, code]
    );

    const totals = listRes.rows.reduce((acc, row) => {
      acc.referees += 1;
      acc.totalWagered += parseFloat(row.wagered || 0);
      acc.totalCommission += parseFloat(row.commission || 0);
      return acc;
    }, { referees: 0, totalWagered: 0, totalCommission: 0 });

    res.json({
      code,
      totals,
      affiliates: listRes.rows.map((r) => ({
        id: r.id,
        username: r.username,
        wagered: parseFloat(r.wagered || 0),
        commission: parseFloat(r.commission || 0),
        lastBetAt: r.last_bet_at,
      })),
    });
  } catch (err) {
    if (err.code === "42P01") {
      return res.json({ code: null, totals: { referees: 0, totalWagered: 0, totalCommission: 0 }, affiliates: [] });
    }
    res.status(500).json({ error: "Failed to load affiliate stats" });
  }
});

router.get("/provably-fair/verify", (req, res) => {
  const { serverSeed, clientSeed, nonce } = req.query;
  if (!serverSeed || !clientSeed || nonce === undefined) {
    return res.status(400).json({ error: "serverSeed, clientSeed and nonce are required" });
  }

  const roll = rollDice(serverSeed, clientSeed, Number(nonce));
  res.json({ roll, serverSeedHash: hashServerSeed(serverSeed), clientSeed, nonce: Number(nonce) });
});

module.exports = router;
