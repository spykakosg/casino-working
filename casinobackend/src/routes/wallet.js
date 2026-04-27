/**
 * Wallet Routes — /api/wallet
 *
 * GET  /api/wallet/balances           - All currency balances
 * GET  /api/wallet/deposit/:currency  - Get deposit address for a currency
 * GET  /api/wallet/deposits           - Deposit history
 * POST /api/wallet/withdraw           - Request a withdrawal
 * GET  /api/wallet/withdrawals        - Withdrawal history
 */

const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");

const SUPPORTED_CURRENCIES = ["USDT_POLYGON", "ETH_POLYGON", "USDT_TRON", "BTC"];

const CURRENCY_INFO = {
  USDT_POLYGON: { name: "USDT", network: "Polygon", minWithdraw: 1, fee: 0.5 },
  ETH_POLYGON:  { name: "ETH",  network: "Polygon", minWithdraw: 0.001, fee: 0.0005 },
  USDT_TRON:    { name: "USDT", network: "Tron (TRC-20)", minWithdraw: 1, fee: 1 },
  BTC:          { name: "BTC",  network: "Bitcoin", minWithdraw: 0.0001, fee: 0.00005 },
};

// ─── Get All Balances ─────────────────────────────────────────────────────────
router.get("/balances", auth, async (req, res) => {
  try {
    const result = await req.db.query(
      "SELECT currency, balance, deposit_address FROM wallets WHERE user_id = $1",
      [req.user.id]
    );
    const balances = {};
    for (const row of result.rows) {
      balances[row.currency] = {
        balance: parseFloat(row.balance),
        depositAddress: row.deposit_address,
        ...CURRENCY_INFO[row.currency],
      };
    }
    return res.json({ balances });
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch balances" });
  }
});

// ─── Get Deposit Address ──────────────────────────────────────────────────────
router.get("/deposit/:currency", auth, async (req, res) => {
  const { currency } = req.params;

  if (!SUPPORTED_CURRENCIES.includes(currency)) {
    return res.status(400).json({ error: `Unsupported currency. Use: ${SUPPORTED_CURRENCIES.join(", ")}` });
  }

  try {
    const result = await req.db.query(
      "SELECT deposit_address FROM wallets WHERE user_id = $1 AND currency = $2",
      [req.user.id, currency]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Wallet not found" });
    }

    const address = result.rows[0].deposit_address;

    if (!address) {
      // Address not yet generated — this will be populated by the deposit watcher service
      return res.status(503).json({
        error: "Deposit address not yet assigned. Please try again in a moment.",
        hint: "The deposit watcher service needs to be running to assign addresses.",
      });
    }

    return res.json({
      currency,
      address,
      network: CURRENCY_INFO[currency].network,
      minDeposit: 0.01,
      confirmationsRequired: currency === "BTC" ? 3 : 2,
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch deposit address" });
  }
});

// ─── Deposit History ──────────────────────────────────────────────────────────
router.get("/deposits", auth, async (req, res) => {
  const { limit = 20, offset = 0 } = req.query;
  try {
    const result = await req.db.query(
      `SELECT id, currency, amount, tx_hash, from_address, status, created_at, confirmed_at
       FROM deposits
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, Math.min(parseInt(limit), 100), parseInt(offset)]
    );
    return res.json({ deposits: result.rows });
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch deposits" });
  }
});

// ─── Request Withdrawal ───────────────────────────────────────────────────────
router.post("/withdraw", auth, async (req, res) => {
  const { currency, amount, toAddress } = req.body;

  if (!currency || !amount || !toAddress) {
    return res.status(400).json({ error: "currency, amount, and toAddress are required" });
  }
  if (!SUPPORTED_CURRENCIES.includes(currency)) {
    return res.status(400).json({ error: "Unsupported currency" });
  }

  const withdrawAmount = parseFloat(amount);
  if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
    return res.status(400).json({ error: "Invalid amount" });
  }

  const info = CURRENCY_INFO[currency];
  if (withdrawAmount < info.minWithdraw) {
    return res.status(400).json({ error: `Minimum withdrawal is ${info.minWithdraw} ${info.name}` });
  }

  const totalDeducted = parseFloat((withdrawAmount + info.fee).toFixed(8));
  const reviewRequired = withdrawAmount >= parseFloat(process.env.WITHDRAWAL_REVIEW_THRESHOLD || 5000);

  const client = await req.db.connect();
  try {
    await client.query("BEGIN");

    // Lock wallet and check balance
    const walletRes = await client.query(
      "SELECT id, balance FROM wallets WHERE user_id = $1 AND currency = $2 FOR UPDATE",
      [req.user.id, currency]
    );

    if (walletRes.rows.length === 0) {
      throw new Error("Wallet not found");
    }

    const balance = parseFloat(walletRes.rows[0].balance);
    if (totalDeducted > balance) {
      throw new Error(`Insufficient balance. You need ${totalDeducted} ${info.name} (amount + fee), but have ${balance}`);
    }

    // Deduct from balance immediately
    await client.query(
      "UPDATE wallets SET balance = balance - $1 WHERE id = $2",
      [totalDeducted, walletRes.rows[0].id]
    );

    // Create withdrawal record
    const wdRes = await client.query(
      `INSERT INTO withdrawals (user_id, currency, amount, fee, to_address, review_required)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, status`,
      [req.user.id, currency, withdrawAmount, info.fee, toAddress, reviewRequired]
    );

    await client.query("COMMIT");

    return res.status(201).json({
      success: true,
      withdrawal: {
        id: wdRes.rows[0].id,
        currency,
        amount: withdrawAmount,
        fee: info.fee,
        toAddress,
        status: wdRes.rows[0].status,
        reviewRequired,
      },
      message: reviewRequired
        ? "Withdrawal queued for manual review (large amount)"
        : "Withdrawal queued for processing",
    });
  } catch (err) {
    await client.query("ROLLBACK");
    const userErrors = ["Insufficient balance", "Minimum withdrawal", "Wallet not found"];
    const isUserError = userErrors.some((e) => err.message.includes(e));
    return res.status(isUserError ? 400 : 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── Withdrawal History ───────────────────────────────────────────────────────
router.get("/withdrawals", auth, async (req, res) => {
  const { limit = 20, offset = 0 } = req.query;
  try {
    const result = await req.db.query(
      `SELECT id, currency, amount, fee, to_address, tx_hash, status, created_at, processed_at
       FROM withdrawals
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, Math.min(parseInt(limit), 100), parseInt(offset)]
    );
    return res.json({ withdrawals: result.rows });
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch withdrawals" });
  }
});

module.exports = router;
