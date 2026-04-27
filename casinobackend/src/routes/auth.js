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

const SUPPORTED_CURRENCIES = ["USDT_POLYGON", "ETH_POLYGON", "USDT_TRON", "BTC"];
const SALT_ROUNDS = 12;

function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );
}

// ─── Register ─────────────────────────────────────────────────────────────────
router.post("/register", async (req, res) => {
  const { username, email, password } = req.body;

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
      `INSERT INTO users (username, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username, email, role, created_at`,
      [username.toLowerCase(), email || null, passwordHash]
    );
    const user = userRes.rows[0];

    // Create a wallet for each supported currency
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
      balances[w.currency] = parseFloat(w.balance);
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
      seeds[row.currency] = {
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
      "UPDATE wallets SET client_seed = $1 WHERE user_id = $2 AND currency = $3 RETURNING nonce",
      [clientSeed, req.user.id, currency]
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
