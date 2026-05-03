/**
 * Admin Routes — /api/admin
 * All routes require role = "admin"
 *
 * GET  /api/admin/stats               - Platform overview (includes daily PnL)
 * POST /api/admin/stats/reset          - Reset PnL tracking
 * GET  /api/admin/users               - List users
 * GET  /api/admin/users/:id           - Single user detail
 * PUT  /api/admin/users/:id/ban       - Ban/unban user
 * DELETE /api/admin/users/:id          - Delete user
 * PUT  /api/admin/users/:id/credit    - Credit funds to user wallet
 * GET  /api/admin/withdrawals/pending - Pending withdrawals
 * PUT  /api/admin/withdrawals/:id     - Approve or reject withdrawal
 */

const express = require("express");
const bitcoin = require("bitcoinjs-lib");
const ecc = require("tiny-secp256k1");
const { ECPairFactory } = require("ecpair");
const { ethers } = require("ethers");
const router = express.Router();
const auth = require("../middleware/auth");
const { getHotWalletSnapshot, getBtcHotWallet } = require("../services/hotWallet");
const { isTestnet, getEvmRpcUrl, getUsdtContract, getBtcExplorerBaseUrl } = require("../config/networkMode");

bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);

// Admin guard middleware
function adminOnly(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

router.use(auth, adminOnly);

router.get("/hot-wallet", async (_req, res) => {
  try {
    const snapshot = await getHotWalletSnapshot();
    return res.json(snapshot);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

async function getBtcFeeRate(baseApiUrl) {
  try {
    const resp = await fetch(`${baseApiUrl}/fee-estimates`);
    const data = await resp.json();
    const economy = Number(data["6"]);
    const normal = Number(data["3"]);
    const fast = Number(data["1"]);
    const minConfigured = Number(process.env.BTC_MIN_SAT_PER_VB || "1");
    const chosen = Number.isFinite(economy) ? economy : (Number.isFinite(normal) ? normal : fast);
    return Math.max(minConfigured, Math.floor(chosen || minConfigured));
  } catch {
    return Number(process.env.BTC_MIN_SAT_PER_VB || "1");
  }
}

async function estimateNetworkFee(currency, toAddress, amount) {
  if (currency === "BTC") {
    const feeRate = await getBtcFeeRate(getBtcExplorerBaseUrl());
    return parseFloat(((Math.ceil(140 * feeRate)) / 100_000_000).toFixed(8));
  }
  const provider = new ethers.JsonRpcProvider(getEvmRpcUrl());
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.maxFeePerGas || feeData.gasPrice;
  if (!gasPrice) return 0;
  let gasLimit;
  if (currency === "ETH_POLYGON") {
    gasLimit = await provider.estimateGas({ to: toAddress, value: ethers.parseEther(String(amount)) });
  } else {
    const usdt = getUsdtContract();
    const iface = new ethers.Interface(["function transfer(address to, uint256 amount) returns (bool)", "function decimals() view returns (uint8)"]);
    const decimalsResult = await provider.call({ to: usdt, data: iface.encodeFunctionData("decimals", []) });
    const decimals = Number(iface.decodeFunctionResult("decimals", decimalsResult)[0]);
    const data = iface.encodeFunctionData("transfer", [toAddress, ethers.parseUnits(String(amount), decimals)]);
    gasLimit = await provider.estimateGas({ to: usdt, data });
  }
  return parseFloat(ethers.formatEther(gasLimit * gasPrice));
}

router.post("/hot-wallet/estimate", async (req, res) => {
  const { currency, amount, toAddress } = req.body;
  try {
    const fee = await estimateNetworkFee(currency, toAddress, parseFloat(amount));
    return res.json({ fee, total: parseFloat((parseFloat(amount) + fee).toFixed(8)) });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post("/hot-wallet/withdraw", async (req, res) => {
  const { currency, amount, toAddress } = req.body;
  const amt = parseFloat(amount);
  try {
    if (currency === "BTC") {
      const network = isTestnet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;
      const base = getBtcExplorerBaseUrl().replace(/\/$/, "");
      const { child, address: fromAddress } = await getBtcHotWallet();
      const keyPair = ECPair.fromWIF(child.toWIF(), network);
      const utxos = await (await fetch(`${base}/address/${fromAddress}/utxo`)).json();
      const psbt = new bitcoin.Psbt({ network });
      const out = Math.round(amt * 100_000_000);
      const feeRate = await getBtcFeeRate(base);
      let sum = 0; let ins = 0;
      for (const u of utxos) {
        const est = Math.ceil((10 + ((ins + 1) * 68) + (2 * 31)) * feeRate);
        if (sum >= out + est) break;
        psbt.addInput({ hash: u.txid, index: u.vout, witnessUtxo: { script: bitcoin.address.toOutputScript(fromAddress, network), value: u.value } });
        sum += u.value; ins++;
      }
      const fee = Math.ceil((10 + (ins * 68) + (2 * 31)) * feeRate);
      psbt.addOutput({ address: toAddress, value: out });
      const change = sum - out - fee;
      if (change > 0) psbt.addOutput({ address: fromAddress, value: change });
      psbt.signAllInputs(keyPair); psbt.finalizeAllInputs();
      const txHex = psbt.extractTransaction().toHex();
      const resp = await fetch(`${base}/tx`, { method: "POST", body: txHex });
      const txHash = (await resp.text()).trim();
      if (!resp.ok) throw new Error(txHash);
      return res.json({ success: true, txHash, fee: parseFloat((fee / 100_000_000).toFixed(8)) });
    }

    const provider = new ethers.JsonRpcProvider(getEvmRpcUrl());
    const signer = new ethers.Wallet(process.env.TESTNET_PAYOUT_PRIVATE_KEY, provider);
    const feeData = await provider.getFeeData();
    const minPriority = ethers.parseUnits(process.env.EVM_MIN_PRIORITY_GWEI || "0.03", "gwei");
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas && feeData.maxPriorityFeePerGas > minPriority ? feeData.maxPriorityFeePerGas : minPriority;
    const maxFeePerGas = feeData.maxFeePerGas && feeData.maxFeePerGas > maxPriorityFeePerGas ? feeData.maxFeePerGas : maxPriorityFeePerGas * 2n;
    const feeOverrides = { maxFeePerGas, maxPriorityFeePerGas };
    let tx;
    if (currency === "ETH_POLYGON") {
      tx = await signer.sendTransaction({ to: toAddress, value: ethers.parseEther(String(amt)), ...feeOverrides });
    } else {
      const usdt = getUsdtContract();
      const erc20 = new ethers.Contract(usdt, ["function transfer(address to, uint256 amount) returns (bool)", "function decimals() view returns (uint8)"], signer);
      const decimals = await erc20.decimals();
      tx = await erc20.transfer(toAddress, ethers.parseUnits(String(amt), decimals), feeOverrides);
    }
    return res.json({ success: true, txHash: tx.hash });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// ─── Platform Stats ───────────────────────────────────────────────────────────
router.get("/stats", async (req, res) => {
  try {
    const [usersRes, betsRes, dailyBetsRes, depositRes, withdrawalRes, pnlByCurrencyRes, dailyPnlByCurrencyRes, byGameRes, trendRes] = await Promise.all([
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
      req.db.query(`SELECT currency, COALESCE(-SUM(profit), 0) AS house_profit
                   FROM bets
                   WHERE currency IN ('BTC', 'ETH_POLYGON')
                   GROUP BY currency`),
      req.db.query(`SELECT currency, COALESCE(-SUM(profit), 0) AS house_profit
                   FROM bets
                   WHERE currency IN ('BTC', 'ETH_POLYGON')
                     AND created_at >= CURRENT_DATE
                   GROUP BY currency`),
      req.db.query(`SELECT game,
                          COALESCE(SUM(bet_amount), 0) AS total_wagered,
                          COALESCE(SUM(payout), 0) AS total_payout,
                          COALESCE(-SUM(profit), 0) AS house_profit
                   FROM bets
                   GROUP BY game
                   ORDER BY total_wagered DESC`),
      req.db.query(`SELECT to_char(day, 'YYYY-MM-DD') AS day,
                          COALESCE(SUM(bet_amount), 0) AS wagered,
                          COALESCE(SUM(payout), 0) AS payout,
                          COALESCE(-SUM(profit), 0) AS house_profit
                   FROM (
                     SELECT generate_series(current_date - interval '6 day', current_date, interval '1 day')::date AS day
                   ) d
                   LEFT JOIN bets b ON b.created_at::date = d.day
                   GROUP BY day
                   ORDER BY day ASC`),
    ]);

    const byGame = byGameRes.rows.map((row) => {
      const wagered = parseFloat(row.total_wagered || 0);
      const payout = parseFloat(row.total_payout || 0);
      const houseProfit = parseFloat(row.house_profit || 0);
      const edgePct = wagered > 0 ? (houseProfit / wagered) * 100 : 0;
      return { game: row.game, wagered, payout, houseProfit, edgePct };
    });

    const payoutTrend = trendRes.rows.map((row) => ({
      day: row.day,
      wagered: parseFloat(row.wagered || 0),
      payout: parseFloat(row.payout || 0),
      houseProfit: parseFloat(row.house_profit || 0),
    }));

    const pnlByCurrency = { allTime: { BTC: 0, ETH_POLYGON: 0 }, daily: { BTC: 0, ETH_POLYGON: 0 } };
    for (const row of pnlByCurrencyRes.rows) pnlByCurrency.allTime[row.currency] = parseFloat(row.house_profit || 0);
    for (const row of dailyPnlByCurrencyRes.rows) pnlByCurrency.daily[row.currency] = parseFloat(row.house_profit || 0);

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
      pnlByCurrency,
      reconciliation: { byGame, payoutTrend },
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

    const normalizedWallets = {};
    for (const row of walletsRes.rows) {
      const normalizedCurrency = ["USDT", "USDT_POLYGON", "USDT_TRON"].includes(row.currency)
        ? "USDT"
        : row.currency;
      if (!normalizedWallets[normalizedCurrency]) normalizedWallets[normalizedCurrency] = 0;
      normalizedWallets[normalizedCurrency] += parseFloat(row.balance || 0);
    }
    const wallets = Object.entries(normalizedWallets).map(([currency, balance]) => ({ currency, balance }));

    return res.json({
      user: userRes.rows[0],
      wallets,
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

// ─── Delete User ──────────────────────────────────────────────────────────────
router.delete("/users/:id", async (req, res) => {
  const client = await req.db.connect();
  try {
    await client.query("BEGIN");

    const userRes = await client.query(
      "SELECT id, username, role FROM users WHERE id = $1 FOR UPDATE",
      [req.params.id]
    );
    if (userRes.rows.length === 0 || userRes.rows[0].role === "admin") {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "User not found or cannot delete admin user" });
    }

    const crashTableRes = await client.query("SELECT to_regclass('public.crash_bets') AS t");
    if (crashTableRes.rows[0].t) {
      await client.query("DELETE FROM crash_bets WHERE user_id = $1", [req.params.id]);
    }
    await client.query("DELETE FROM bets WHERE user_id = $1", [req.params.id]);
    await client.query("DELETE FROM deposits WHERE user_id = $1", [req.params.id]);
    await client.query("DELETE FROM withdrawals WHERE user_id = $1", [req.params.id]);
    await client.query("DELETE FROM sessions WHERE user_id = $1", [req.params.id]);
    await client.query("DELETE FROM wallets WHERE user_id = $1", [req.params.id]);
    await client.query("DELETE FROM users WHERE id = $1", [req.params.id]);

    await client.query("COMMIT");
    return res.json({ success: true, deleted: { id: userRes.rows[0].id, username: userRes.rows[0].username } });
  } catch (err) {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── Credit Funds to User ─────────────────────────────────────────────────────
router.put("/users/:id/credit", async (req, res) => {
  const { currency, amount } = req.body;
  const VALID_CURRENCIES = ["USDT", "ETH_POLYGON", "BTC"];
  const currencyCandidates = currency === "USDT"
    ? ["USDT", "USDT_POLYGON", "USDT_TRON"]
    : [currency];

  if (!currency || !VALID_CURRENCIES.includes(currency)) {
    return res.status(400).json({ error: `currency must be one of: ${VALID_CURRENCIES.join(", ")}` });
  }
  const creditAmount = parseFloat(amount);
  if (!amount || isNaN(creditAmount) || creditAmount <= 0) {
    return res.status(400).json({ error: "amount must be a positive number" });
  }

  try {
    const walletRes = await req.db.query(
      `UPDATE wallets
       SET balance = balance + $1, updated_at = NOW()
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
       RETURNING balance, currency`,
      [creditAmount, req.params.id, currencyCandidates]
    );

    if (walletRes.rows.length === 0) {
      return res.status(404).json({ error: `No ${currency} wallet found for user ${req.params.id}` });
    }

    return res.json({
      success: true,
      userId: parseInt(req.params.id),
      currency: walletRes.rows[0].currency,
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
  const { action } = req.body; // action: "approve" | "reject"

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
        `UPDATE withdrawals
         SET status = 'processing'
         WHERE id = $1`,
        [wd.id]
      );
      await client.query(
        `INSERT INTO withdrawal_jobs (withdrawal_id, status)
         VALUES ($1, 'queued')
         ON CONFLICT (withdrawal_id)
         DO UPDATE SET status = 'queued', last_error = NULL, next_retry_at = NOW(), updated_at = NOW()`,
        [wd.id]
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
