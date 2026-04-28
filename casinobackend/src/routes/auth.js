/**
 * Auth Routes — /api/auth
 *
 * POST /api/auth/register   - Create account
 * POST /api/auth/login      - Login, receive JWT
 * GET  /api/auth/me         - Get current user + balances
 * PUT  /api/auth/password   - Change password
 * GET  /api/auth/seeds      - Get current seed info per currency
 * PUT  /api/auth/client-seed - Update client seed
 */

const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { generateServerSeed, hashServerSeed, generateClientSeed } = require("../engine/rng");
const auth = require("../middleware/auth");

const SUPPORTED_CURRENCIES = ["USDT", "ETH_POLYGON", "BTC"];
const SALT_ROUNDS = 12;

function normalizeCurrency(currency) {
  return ["USDT", "USDT_POLYGON", "USDT_TRON"].includes(currency) ? "USDT" : currency;
}

function getCurrencyCandidates(currency) {
  return currency === "USDT" ? ["USDT", "USDT_POLYGON", "USDT_TRON"] : [currency];
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );
}

// ─── Register ─────────────────────────────────────────────────────────────────
router.post("/register", async (req, res) => {
  const { username, email, password, referralCode } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "username and password are required" });
  }
  if (username.length < 3 || username.length > 32) {
    return res.status(400).json({ error: "Username must be 3–32 characters" });
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return res.status(400).json({ error: "Username can only contain letters, numbers, and underscores" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  const client = await req.db.connect();
  try {
    await client.query("BEGIN");

    // Check uniqueness
    const existing = await client.query(
      "SELECT id FROM users WHERE username = $1 OR email = $2",
      [username.toLowerCase(), email || null]
    );
    if (existing.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Username or email already taken" });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Create user
    const userRes = await client.query(
      `INSERT INTO users (username, email, password_hash, referred_by_code)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, email, role, created_at`,
      [username.toLowerCase(), email || null, passwordHash, referralCode || null]
    );
    const user = userRes.rows[0];

    // Create a wallet for each supported currency

    if (referralCode) {
      const refRes = await client.query(
        `UPDATE referral_codes
         SET uses_count = uses_count + 1, bonus_credits = bonus_credits + 5
         WHERE code = $1
         RETURNING user_id`,
        [referralCode]
      );
      if (refRes.rows[0]) {
        await client.query(
          `UPDATE wallets
           SET balance = balance + 5
           WHERE user_id = $1 AND currency = 'USDT'`,
          [refRes.rows[0].user_id]
        );
        await client.query(
          `UPDATE wallets
           SET balance = balance + 2
           WHERE user_id = $1 AND currency = 'USDT'`,
          [user.id]
        );
      }
    }
    for (const currency of SUPPORTED_CURRENCIES) {
      const serverSeed = generateServerSeed();
      const clientSeed = generateClientSeed();
      await client.query(
        `INSERT INTO wallets (user_id, currency, server_seed, client_seed)
         VALUES ($1, $2, $3, $4)`,
        [user.id, currency, serverSeed, clientSeed]
      );
    }

    await client.query("COMMIT");

    const ipAddress = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || null;
    const userAgent = req.headers["user-agent"] || null;
    await req.db.query(
      `INSERT INTO sessions (user_id, ip_address, user_agent, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '7 day')`,
      [user.id, ipAddress, userAgent]
    );

    const token = signToken(user);
    return res.status(201).json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        createdAt: user.created_at,
      },
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Register error:", err);
    return res.status(500).json({ error: "Registration failed" });
  } finally {
    client.release();
  }
});

// ─── Login ────────────────────────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "username and password are required" });
  }

  try {
    const userRes = await req.db.query(
      "SELECT id, username, email, password_hash, role, is_banned FROM users WHERE username = $1",
      [username.toLowerCase()]
    );

    if (userRes.rows.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const user = userRes.rows[0];

    if (user.is_banned) {
      return res.status(403).json({ error: "Account is banned" });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = signToken(user);
    return res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Login failed" });
  }
});

// ─── Me ───────────────────────────────────────────────────────────────────────
router.get("/me", auth, async (req, res) => {
  try {
    const userRes = await req.db.query(
      "SELECT id, username, email, role, created_at FROM users WHERE id = $1",
      [req.user.id]
    );
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    // Get all wallet balances
    const walletsRes = await req.db.query(
      "SELECT currency, balance FROM wallets WHERE user_id = $1",
      [req.user.id]
    );

    const balances = {};
    for (const w of walletsRes.rows) {
      const normalized = normalizeCurrency(w.currency);
      balances[normalized] = (balances[normalized] || 0) + parseFloat(w.balance);
    }

    const user = userRes.rows[0];
    return res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      createdAt: user.created_at,
      balances,
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch user" });
  }
});

// ─── Change Password ──────────────────────────────────────────────────────────
router.put("/password", auth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "currentPassword and newPassword required" });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: "New password must be at least 8 characters" });
  }

  try {
    const userRes = await req.db.query(
      "SELECT password_hash FROM users WHERE id = $1",
      [req.user.id]
    );
    const user = userRes.rows[0];
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await req.db.query("UPDATE users SET password_hash = $1 WHERE id = $2", [newHash, req.user.id]);

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to change password" });
  }
});

// ─── Get Seed Info ────────────────────────────────────────────────────────────
router.get("/seeds", auth, async (req, res) => {
  try {
    const res2 = await req.db.query(
      "SELECT currency, server_seed, client_seed, nonce FROM wallets WHERE user_id = $1",
      [req.user.id]
    );

    const seeds = {};
    for (const row of res2.rows) {
      const normalized = normalizeCurrency(row.currency);
      if (seeds[normalized]) continue;
      seeds[normalized] = {
        serverSeedHash: hashServerSeed(row.server_seed), // never expose raw seed
        clientSeed: row.client_seed,
        nonce: row.nonce,
      };
    }

    return res.json({ seeds });
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch seeds" });
  }
});

// ─── Update Client Seed ───────────────────────────────────────────────────────
router.put("/client-seed", auth, async (req, res) => {
  const { currency, clientSeed } = req.body;

  if (!currency || !clientSeed) {
    return res.status(400).json({ error: "currency and clientSeed required" });
  }
  if (clientSeed.length < 1 || clientSeed.length > 128) {
    return res.status(400).json({ error: "clientSeed must be 1–128 characters" });
  }

  try {
    const result = await req.db.query(
      `UPDATE wallets
       SET client_seed = $1
       WHERE id = (
         SELECT id
         FROM wallets
         WHERE user_id = $2
           AND currency = ANY($3::text[])
         ORDER BY CASE
           WHEN currency = 'USDT' THEN 0
           WHEN currency = 'USDT_POLYGON' THEN 1
           WHEN currency = 'USDT_TRON' THEN 2
           ELSE 3
         END
         LIMIT 1
       )
       RETURNING nonce`,
      [clientSeed, req.user.id, getCurrencyCandidates(currency)]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Wallet not found" });
    }
    return res.json({ success: true, nonce: result.rows[0].nonce });
  } catch (err) {
    return res.status(500).json({ error: "Failed to update client seed" });
  }
});

module.exports = router;
