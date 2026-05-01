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
const { ethers } = require("ethers");
const router = express.Router();
const auth = require("../middleware/auth");
const { generateAddressForUser } = require("../services/addressGenerator");
const { getEvmRpcUrl, getUsdtContract } = require("../config/networkMode");

const SUPPORTED_CURRENCIES = ["USDT", "ETH_POLYGON", "BTC"];

const CURRENCY_INFO = {
  USDT: { name: "USDT", network: "Polygon", minWithdraw: 0, fee: 0 },
  ETH_POLYGON:  { name: "ETH",  network: "Polygon", minWithdraw: 0, fee: 0 },
  BTC:          { name: "BTC",  network: "Bitcoin", minWithdraw: 0, fee: 0 },
};

function getWalletCurrencyCandidates(currency) {
  return currency === "USDT" ? ["USDT", "USDT_POLYGON", "USDT_TRON"] : [currency];
}




const FEE_PRIORITY_MULTIPLIER = { low: 0.9, medium: 1.0, high: 1.25 };

async function estimateWithdrawalNetworkFee(currency, toAddress, amount, feePriority = "medium") {
  const multiplier = FEE_PRIORITY_MULTIPLIER[feePriority] || FEE_PRIORITY_MULTIPLIER.medium;

  if (currency === "BTC") {
    const base = parseFloat(process.env.BTC_WITHDRAWAL_NETWORK_FEE || "0.00005");
    return parseFloat((base * multiplier).toFixed(8));
  }

  const rpcUrl = getEvmRpcUrl();
  if (!rpcUrl) return 0;
  const provider = rpcUrl.startsWith("ws") ? new ethers.WebSocketProvider(rpcUrl) : new ethers.JsonRpcProvider(rpcUrl);
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.maxFeePerGas || feeData.gasPrice;
  if (!gasPrice) return 0;

  let gasLimit;
  if (currency === "ETH_POLYGON") {
    gasLimit = await provider.estimateGas({ to: toAddress, value: ethers.parseEther(String(amount)) });
  } else if (currency === "USDT") {
    const usdt = getUsdtContract();
    if (!usdt) return 0;
    const iface = new ethers.Interface(["function transfer(address to, uint256 amount) returns (bool)", "function decimals() view returns (uint8)"]);
    const decimalsResult = await provider.call({ to: usdt, data: iface.encodeFunctionData("decimals", []) });
    const decimals = Number(iface.decodeFunctionResult("decimals", decimalsResult)[0]);
    const data = iface.encodeFunctionData("transfer", [toAddress, ethers.parseUnits(String(amount), decimals)]);
    gasLimit = await provider.estimateGas({ to: usdt, data });
  } else {
    return 0;
  }

  const weiFee = gasLimit * gasPrice;
  const nativeFee = parseFloat(ethers.formatEther(weiFee));
  const adjusted = nativeFee * multiplier;
  return parseFloat(adjusted.toFixed(8));
}

const withdrawalVelocity = new Map();
function enforceWithdrawalVelocity(req, res, next) {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || "unknown";
  const key = `${req.user?.id || "anon"}::${ip}`;
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const max = 5;
  const arr = withdrawalVelocity.get(key) || [];
  const filtered = arr.filter((t) => now - t < windowMs);
  if (filtered.length >= max) {
    return res.status(429).json({ error: "Too many withdrawal attempts. Try again later." });
  }
  filtered.push(now);
  withdrawalVelocity.set(key, filtered);
  next();
}

// ─── Get All Balances ─────────────────────────────────────────────────────────
router.get("/balances", auth, async (req, res) => {
  try {
    const result = await req.db.query(
      "SELECT currency, balance, deposit_address FROM wallets WHERE user_id = $1",
      [req.user.id]
    );
    const balances = {};
    for (const row of result.rows) {
      const normalizedCurrency = ["USDT", "USDT_POLYGON", "USDT_TRON"].includes(row.currency)
        ? "USDT"
        : row.currency;
      if (!CURRENCY_INFO[normalizedCurrency]) continue;
      if (!balances[normalizedCurrency]) {
        balances[normalizedCurrency] = {
          balance: 0,
          depositAddress: row.deposit_address,
          ...CURRENCY_INFO[normalizedCurrency],
        };
      }
      balances[normalizedCurrency].balance += parseFloat(row.balance);
      if (!balances[normalizedCurrency].depositAddress && row.deposit_address) {
        balances[normalizedCurrency].depositAddress = row.deposit_address;
      }
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
      `SELECT deposit_address
       FROM wallets
       WHERE user_id = $1
         AND currency = ANY($2::text[])
       ORDER BY CASE
         WHEN currency = 'USDT' THEN 0
         WHEN currency = 'USDT_POLYGON' THEN 1
         WHEN currency = 'USDT_TRON' THEN 2
         ELSE 3
       END
       LIMIT 1`,
      [req.user.id, getWalletCurrencyCandidates(currency)]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Wallet not found" });
    }

    let address = result.rows[0].deposit_address;
    if (!address) {
      await generateAddressForUser(req.user.id);
      const refreshRes = await req.db.query(
        `SELECT deposit_address
         FROM wallets
         WHERE user_id = $1
           AND currency = ANY($2::text[])
         ORDER BY CASE
           WHEN currency = 'USDT' THEN 0
           WHEN currency = 'USDT_POLYGON' THEN 1
           WHEN currency = 'USDT_TRON' THEN 2
           ELSE 3
         END
         LIMIT 1`,
        [req.user.id, getWalletCurrencyCandidates(currency)]
      );
      address = refreshRes.rows[0]?.deposit_address || null;
    }

    if (!address) {
      return res.status(503).json({
        error: "Deposit address not yet assigned. Please try again in a moment.",
        hint: "Address generation failed. Check backend logs and wallet configuration.",
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


// ─── Generate Deposit Address (on-demand) ───────────────────────────────────
router.post("/deposit/:currency/generate", auth, async (req, res) => {
  const { currency } = req.params;
  if (!SUPPORTED_CURRENCIES.includes(currency)) {
    return res.status(400).json({ error: "Unsupported currency" });
  }

  try {
    await generateAddressForUser(req.user.id);
    const addrRes = await req.db.query(
      `SELECT deposit_address FROM wallets WHERE user_id = $1 AND currency = ANY($2::text[]) LIMIT 1`,
      [req.user.id, getWalletCurrencyCandidates(currency)]
    );
    return res.json({ success: true, currency, address: addrRes.rows[0]?.deposit_address || null });
  } catch (err) {
    return res.status(500).json({ error: "Failed to generate deposit address" });
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
router.post("/withdraw", auth, enforceWithdrawalVelocity, async (req, res) => {
  const { currency, amount, toAddress, feePriority = "medium" } = req.body;

  if (!currency || !amount || !toAddress) {
    return res.status(400).json({ error: "currency, amount, and toAddress are required" });
  }
  if (!FEE_PRIORITY_MULTIPLIER[feePriority]) {
    return res.status(400).json({ error: "feePriority must be low, medium, or high" });
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

  const networkFee = await estimateWithdrawalNetworkFee(currency, toAddress, withdrawAmount, feePriority);
  const totalDeducted = parseFloat((withdrawAmount + networkFee).toFixed(8));
  const reviewRequired = withdrawAmount >= parseFloat(process.env.WITHDRAWAL_REVIEW_THRESHOLD || 5000);

  const client = await req.db.connect();
  try {
    await client.query("BEGIN");

    // Lock wallet and check balance
    const walletRes = await client.query(
      `SELECT id, balance
       FROM wallets
       WHERE user_id = $1
         AND currency = ANY($2::text[])
       ORDER BY CASE
         WHEN currency = 'USDT' THEN 0
         WHEN currency = 'USDT_POLYGON' THEN 1
         WHEN currency = 'USDT_TRON' THEN 2
         ELSE 3
       END
       LIMIT 1
       FOR UPDATE`,
      [req.user.id, getWalletCurrencyCandidates(currency)]
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
      [req.user.id, currency, withdrawAmount, networkFee, toAddress, reviewRequired]
    );

    await client.query("COMMIT");

    return res.status(201).json({
      success: true,
      withdrawal: {
        id: wdRes.rows[0].id,
        currency,
        amount: withdrawAmount,
        fee: networkFee,
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
