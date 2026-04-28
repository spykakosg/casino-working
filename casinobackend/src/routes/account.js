const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const router = express.Router();

router.post("/request-email-verification", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "email is required" });

  try {
    const userRes = await req.db.query("SELECT id FROM users WHERE email = $1", [email]);
    if (!userRes.rows[0]) return res.json({ success: true });

    const token = crypto.randomBytes(20).toString("hex");
    await req.db.query(
      `INSERT INTO email_verification_tokens (user_id, token, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 day')`,
      [userRes.rows[0].id, token]
    );

    console.log(`Email verification token for ${email}: ${token}`);
    return res.json({ success: true, message: "Verification email queued" });
  } catch {
    return res.status(500).json({ error: "Failed to request verification" });
  }
});

router.post("/verify-email", async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: "token is required" });

  const client = await req.db.connect();
  try {
    await client.query("BEGIN");
    const tokenRes = await client.query(
      `SELECT user_id FROM email_verification_tokens
       WHERE token = $1 AND used_at IS NULL AND expires_at > NOW()`,
      [token]
    );
    if (!tokenRes.rows[0]) throw new Error("Invalid or expired token");

    await client.query("UPDATE users SET email_verified = true WHERE id = $1", [tokenRes.rows[0].user_id]);
    await client.query("UPDATE email_verification_tokens SET used_at = NOW() WHERE token = $1", [token]);
    await client.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.post("/request-password-reset", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "email is required" });

  try {
    const userRes = await req.db.query("SELECT id FROM users WHERE email = $1", [email]);
    if (!userRes.rows[0]) return res.json({ success: true });

    const token = crypto.randomBytes(20).toString("hex");
    await req.db.query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '30 minute')`,
      [userRes.rows[0].id, token]
    );

    console.log(`Password reset token for ${email}: ${token}`);
    return res.json({ success: true, message: "Password reset email queued" });
  } catch {
    return res.status(500).json({ error: "Failed to request password reset" });
  }
});

router.post("/reset-password", async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) return res.status(400).json({ error: "token and newPassword are required" });
  if (newPassword.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });

  const client = await req.db.connect();
  try {
    await client.query("BEGIN");
    const tokenRes = await client.query(
      `SELECT user_id FROM password_reset_tokens
       WHERE token = $1 AND used_at IS NULL AND expires_at > NOW()`,
      [token]
    );
    if (!tokenRes.rows[0]) throw new Error("Invalid or expired token");

    const hash = await bcrypt.hash(newPassword, 12);
    await client.query("UPDATE users SET password_hash = $1 WHERE id = $2", [hash, tokenRes.rows[0].user_id]);
    await client.query("UPDATE password_reset_tokens SET used_at = NOW() WHERE token = $1", [token]);
    await client.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
