"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import {
  adminGetStats, adminGetUsers, adminGetUser,
  adminBanUser, adminCreditUser, adminResetPnl,
  adminGetPendingWithdrawals, adminProcessWithdrawal,
} from "@/lib/api";

const CURRENCIES = ["USDT_POLYGON", "ETH_POLYGON", "USDT_TRON", "BTC"];
const CURRENCY_LABELS = { USDT_POLYGON: "USDT (Polygon)", ETH_POLYGON: "ETH (Polygon)", USDT_TRON: "USDT (Tron)", BTC: "BTC" };

export default function AdminPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState("stats");

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
    if (!authLoading && user && user.role !== "admin") router.replace("/game/dice");
  }, [user, authLoading, router]);

  if (authLoading) return <LoadingScreen />;
  if (!user || user.role !== "admin") return <LoadingScreen />;

  return (
    <div className="min-h-screen flex flex-col bg-casino-bg">
      {/* Header */}
      <header className="border-b border-casino-border bg-casino-surface/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/game/dice" className="font-display text-2xl text-gold-gradient tracking-widest">CASINOX</Link>
            <span className="text-xs font-mono text-red-400 bg-red-500/10 border border-red-500/30 px-2 py-0.5 rounded">ADMIN</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-casino-muted text-sm font-mono">{user.username}</span>
            <Link href="/game/dice" className="text-casino-muted hover:text-white text-sm transition-colors ml-2">Back to Games</Link>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="max-w-7xl mx-auto w-full px-4 mt-4">
        <div className="flex gap-1 bg-casino-card border border-casino-border rounded-xl p-1">
          {[
            { id: "stats", label: "Overview" },
            { id: "users", label: "Users" },
            { id: "withdrawals", label: "Withdrawals" },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 py-2 text-sm font-mono rounded-lg transition-all ${
                tab === t.id ? "bg-gold/20 text-gold" : "text-casino-muted hover:text-white"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <main className="max-w-7xl mx-auto w-full px-4 py-4 flex-1">
        {tab === "stats" && <StatsPanel />}
        {tab === "users" && <UsersPanel />}
        {tab === "withdrawals" && <WithdrawalsPanel />}
      </main>
    </div>
  );
}

// ─── Stats Panel ──────────────────────────────────────────────────────────────
function StatsPanel() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => { fetchStats(); }, []);

  async function fetchStats() {
    setLoading(true);
    try {
      const data = await adminGetStats();
      setStats(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleReset() {
    if (!confirmReset) { setConfirmReset(true); return; }
    setResetting(true);
    try {
      await adminResetPnl();
      setConfirmReset(false);
      fetchStats();
    } catch (err) {
      setError(err.message);
    } finally {
      setResetting(false);
    }
  }

  if (loading) return <div className="text-center text-casino-muted py-12 font-mono">Loading stats...</div>;
  if (error) return <ErrorBox message={error} />;
  if (!stats) return null;

  return (
    <div className="space-y-4">
      {/* Top cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Users" value={stats.users.total} />
        <StatCard label="Users (24h)" value={stats.users.last24h} />
        <StatCard label="Total Bets" value={stats.bets.total.toLocaleString()} />
        <StatCard label="Total Wins" value={stats.bets.totalWins.toLocaleString()} />
      </div>

      {/* All-time PnL */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StatCard label="Total Wagered" value={`$${stats.bets.totalWagered.toFixed(2)}`} large />
        <StatCard
          label="House Profit (All Time)"
          value={`$${stats.bets.houseProfit.toFixed(2)}`}
          color={stats.bets.houseProfit >= 0 ? "text-green-400" : "text-red-400"}
          large
        />
        <StatCard label="Pending Withdrawals" value={stats.pendingWithdrawals} large />
      </div>

      {/* Daily PnL */}
      <div className="bg-casino-card border border-casino-border rounded-xl p-4">
        <h3 className="text-sm font-mono text-casino-muted uppercase tracking-widest mb-3">Today&apos;s PnL</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-casino-surface rounded-lg p-3">
            <div className="text-xs font-mono text-casino-muted">Bets Today</div>
            <div className="text-white font-mono font-bold">{stats.daily.total.toLocaleString()}</div>
          </div>
          <div className="bg-casino-surface rounded-lg p-3">
            <div className="text-xs font-mono text-casino-muted">Wagered Today</div>
            <div className="text-white font-mono font-bold">${stats.daily.totalWagered.toFixed(2)}</div>
          </div>
          <div className="bg-casino-surface rounded-lg p-3">
            <div className="text-xs font-mono text-casino-muted">House Profit Today</div>
            <div className={`font-mono font-bold ${stats.daily.houseProfit >= 0 ? "text-green-400" : "text-red-400"}`}>
              ${stats.daily.houseProfit.toFixed(2)}
            </div>
          </div>
          <div className="bg-casino-surface rounded-lg p-3">
            <div className="text-xs font-mono text-casino-muted">Wins Today</div>
            <div className="text-white font-mono font-bold">{stats.daily.totalWins.toLocaleString()}</div>
          </div>
        </div>
      </div>

      {/* Deposits by currency */}
      {stats.deposits.length > 0 && (
        <div className="bg-casino-card border border-casino-border rounded-xl p-4">
          <h3 className="text-sm font-mono text-casino-muted uppercase tracking-widest mb-3">Deposits by Currency</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {stats.deposits.map(d => (
              <div key={d.currency} className="bg-casino-surface rounded-lg p-3">
                <div className="text-xs font-mono text-casino-muted">{d.currency}</div>
                <div className="text-white font-mono font-bold">{parseFloat(d.total).toFixed(4)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reset button */}
      <div className="bg-casino-card border border-casino-border rounded-xl p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-mono text-casino-muted uppercase tracking-widest">Reset PnL</h3>
            <p className="text-xs text-casino-muted mt-1">Deletes all bet records. This cannot be undone.</p>
          </div>
          <div className="flex gap-2">
            {confirmReset && (
              <button
                onClick={() => setConfirmReset(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-mono text-casino-muted hover:text-white border border-casino-border transition-colors"
              >
                Cancel
              </button>
            )}
            <button
              onClick={handleReset}
              disabled={resetting}
              className={`px-4 py-1.5 rounded-lg text-xs font-mono font-semibold transition-all ${
                confirmReset
                  ? "bg-red-600 text-white hover:bg-red-700"
                  : "bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20"
              }`}
            >
              {resetting ? "Resetting..." : confirmReset ? "Confirm Reset" : "Reset PnL"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Users Panel ──────────────────────────────────────────────────────────────
function UsersPanel() {
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedUser, setSelectedUser] = useState(null);

  useEffect(() => { fetchUsers(); }, []);

  async function fetchUsers(s) {
    setLoading(true);
    try {
      const data = await adminGetUsers(50, 0, s || search);
      setUsers(data.users);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleSearch(e) {
    e.preventDefault();
    fetchUsers();
  }

  async function handleSelectUser(id) {
    try {
      const data = await adminGetUser(id);
      setSelectedUser(data);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="space-y-4">
      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by username or email..."
          className="flex-1 bg-casino-card border border-casino-border rounded-lg px-4 py-2 text-white font-mono text-sm placeholder-casino-muted focus:outline-none focus:border-gold transition-colors"
        />
        <button type="submit" className="btn-gold px-4 py-2 text-sm font-mono">Search</button>
      </form>

      {error && <ErrorBox message={error} />}

      {/* User detail modal */}
      {selectedUser && (
        <UserDetailPanel
          data={selectedUser}
          onClose={() => setSelectedUser(null)}
          onRefresh={() => handleSelectUser(selectedUser.user.id)}
          onUsersRefresh={fetchUsers}
        />
      )}

      {/* Users table */}
      <div className="bg-casino-card border border-casino-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-casino-border">
          <h3 className="text-sm font-mono text-casino-muted uppercase tracking-widest">
            Users ({users.length})
          </h3>
        </div>

        {loading ? (
          <div className="text-center text-casino-muted py-8 font-mono">Loading...</div>
        ) : users.length === 0 ? (
          <div className="text-center text-casino-muted py-8 font-mono">No users found</div>
        ) : (
          <div className="divide-y divide-casino-border">
            {users.map(u => (
              <button
                key={u.id}
                onClick={() => handleSelectUser(u.id)}
                className="w-full px-4 py-3 flex items-center gap-4 hover:bg-casino-surface/50 transition-colors text-left"
              >
                <div className="w-8 h-8 rounded-full bg-gold/20 flex items-center justify-center text-gold font-mono text-sm font-bold shrink-0">
                  {u.username[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-white font-mono text-sm font-medium truncate">{u.username}</div>
                  <div className="text-casino-muted text-xs font-mono truncate">{u.email || "No email"}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {u.role === "admin" && (
                    <span className="text-xs font-mono text-red-400 bg-red-500/10 border border-red-500/30 px-2 py-0.5 rounded">admin</span>
                  )}
                  {u.is_banned && (
                    <span className="text-xs font-mono text-orange-400 bg-orange-500/10 border border-orange-500/30 px-2 py-0.5 rounded">banned</span>
                  )}
                </div>
                <div className="text-casino-muted text-xs font-mono shrink-0">
                  {new Date(u.created_at).toLocaleDateString()}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── User Detail Panel ────────────────────────────────────────────────────────
function UserDetailPanel({ data, onClose, onRefresh, onUsersRefresh }) {
  const { user, wallets, stats } = data;
  const [creditCurrency, setCreditCurrency] = useState("USDT_POLYGON");
  const [creditAmount, setCreditAmount] = useState("");
  const [creditLoading, setCreditLoading] = useState(false);
  const [creditMsg, setCreditMsg] = useState("");
  const [banLoading, setBanLoading] = useState(false);

  async function handleCredit(e) {
    e.preventDefault();
    setCreditLoading(true);
    setCreditMsg("");
    try {
      const result = await adminCreditUser(user.id, creditCurrency, parseFloat(creditAmount));
      setCreditMsg(`Credited ${creditAmount} ${creditCurrency}. New balance: ${result.newBalance}`);
      setCreditAmount("");
      onRefresh();
    } catch (err) {
      setCreditMsg(`Error: ${err.message}`);
    } finally {
      setCreditLoading(false);
    }
  }

  async function handleBan() {
    setBanLoading(true);
    try {
      await adminBanUser(user.id, !user.is_banned);
      onRefresh();
      onUsersRefresh();
    } catch (err) {
      setCreditMsg(`Error: ${err.message}`);
    } finally {
      setBanLoading(false);
    }
  }

  return (
    <div className="bg-casino-card border border-gold/30 rounded-xl p-4 space-y-4 glow-gold">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gold/20 flex items-center justify-center text-gold font-mono text-lg font-bold">
            {user.username[0].toUpperCase()}
          </div>
          <div>
            <div className="text-white font-mono font-bold">{user.username}</div>
            <div className="text-casino-muted text-xs font-mono">{user.email || "No email"} · ID: {user.id}</div>
          </div>
        </div>
        <button onClick={onClose} className="text-casino-muted hover:text-white text-xl transition-colors">x</button>
      </div>

      {/* Wallets */}
      <div>
        <h4 className="text-xs font-mono text-casino-muted uppercase tracking-widest mb-2">Wallets</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {wallets.map(w => (
            <div key={w.currency} className="bg-casino-surface rounded-lg p-3">
              <div className="text-xs font-mono text-casino-muted">{w.currency}</div>
              <div className="text-white font-mono font-bold text-sm">{parseFloat(w.balance).toFixed(5)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Bet Stats */}
      <div>
        <h4 className="text-xs font-mono text-casino-muted uppercase tracking-widest mb-2">Betting Stats</h4>
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-casino-surface rounded-lg p-3">
            <div className="text-xs font-mono text-casino-muted">Total Bets</div>
            <div className="text-white font-mono font-bold text-sm">{parseInt(stats.total || 0).toLocaleString()}</div>
          </div>
          <div className="bg-casino-surface rounded-lg p-3">
            <div className="text-xs font-mono text-casino-muted">Wagered</div>
            <div className="text-white font-mono font-bold text-sm">{parseFloat(stats.wagered || 0).toFixed(2)}</div>
          </div>
          <div className="bg-casino-surface rounded-lg p-3">
            <div className="text-xs font-mono text-casino-muted">Profit</div>
            <div className={`font-mono font-bold text-sm ${parseFloat(stats.profit || 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
              {parseFloat(stats.profit || 0).toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      {/* Credit Form */}
      <div>
        <h4 className="text-xs font-mono text-casino-muted uppercase tracking-widest mb-2">Credit Funds</h4>
        <form onSubmit={handleCredit} className="flex gap-2 items-end">
          <select
            value={creditCurrency}
            onChange={e => setCreditCurrency(e.target.value)}
            className="bg-casino-surface border border-casino-border rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-gold"
          >
            {CURRENCIES.map(c => (
              <option key={c} value={c}>{CURRENCY_LABELS[c]}</option>
            ))}
          </select>
          <input
            type="number"
            value={creditAmount}
            onChange={e => setCreditAmount(e.target.value)}
            placeholder="Amount"
            step="any"
            min="0"
            required
            className="flex-1 bg-casino-surface border border-casino-border rounded-lg px-3 py-2 text-white font-mono text-sm placeholder-casino-muted focus:outline-none focus:border-gold"
          />
          <button
            type="submit"
            disabled={creditLoading}
            className="btn-gold px-4 py-2 text-sm font-mono"
          >
            {creditLoading ? "..." : "Credit"}
          </button>
        </form>
        {creditMsg && (
          <div className={`text-xs font-mono mt-2 ${creditMsg.startsWith("Error") ? "text-red-400" : "text-green-400"}`}>
            {creditMsg}
          </div>
        )}
      </div>

      {/* Ban button */}
      <div className="flex gap-2 pt-2 border-t border-casino-border">
        <button
          onClick={handleBan}
          disabled={banLoading}
          className={`px-4 py-2 rounded-lg text-sm font-mono font-semibold transition-all ${
            user.is_banned
              ? "bg-green-500/10 border border-green-500/30 text-green-400 hover:bg-green-500/20"
              : "bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20"
          }`}
        >
          {banLoading ? "..." : user.is_banned ? "Unban User" : "Ban User"}
        </button>
      </div>
    </div>
  );
}

// ─── Withdrawals Panel ────────────────────────────────────────────────────────
function WithdrawalsPanel() {
  const [withdrawals, setWithdrawals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState({});
  const [txHashes, setTxHashes] = useState({});

  useEffect(() => { fetchWithdrawals(); }, []);

  async function fetchWithdrawals() {
    setLoading(true);
    try {
      const data = await adminGetPendingWithdrawals();
      setWithdrawals(data.withdrawals);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleProcess(id, action) {
    setProcessing(p => ({ ...p, [id]: true }));
    try {
      await adminProcessWithdrawal(id, action, txHashes[id]);
      fetchWithdrawals();
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessing(p => ({ ...p, [id]: false }));
    }
  }

  if (loading) return <div className="text-center text-casino-muted py-12 font-mono">Loading...</div>;
  if (error) return <ErrorBox message={error} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-mono text-casino-muted uppercase tracking-widest">
          Pending Withdrawals ({withdrawals.length})
        </h3>
        <button onClick={fetchWithdrawals} className="text-casino-muted hover:text-white text-sm font-mono transition-colors">
          Refresh
        </button>
      </div>

      {withdrawals.length === 0 ? (
        <div className="bg-casino-card border border-casino-border rounded-xl p-8 text-center text-casino-muted font-mono">
          No pending withdrawals
        </div>
      ) : (
        <div className="space-y-3">
          {withdrawals.map(w => (
            <div key={w.id} className="bg-casino-card border border-casino-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-white font-mono font-bold text-sm">{w.username}</span>
                  <span className="text-casino-muted text-xs font-mono ml-2">ID: {w.user_id}</span>
                </div>
                <div className="text-right">
                  <div className="text-white font-mono font-bold">{parseFloat(w.amount).toFixed(8)} {w.currency}</div>
                  {parseFloat(w.fee) > 0 && (
                    <div className="text-casino-muted text-xs font-mono">Fee: {parseFloat(w.fee).toFixed(8)}</div>
                  )}
                </div>
              </div>

              <div className="text-xs font-mono text-casino-muted break-all">
                To: {w.to_address}
              </div>

              <div className="flex items-center gap-2">
                <input
                  value={txHashes[w.id] || ""}
                  onChange={e => setTxHashes(h => ({ ...h, [w.id]: e.target.value }))}
                  placeholder="TX hash (optional for approve)"
                  className="flex-1 bg-casino-surface border border-casino-border rounded-lg px-3 py-1.5 text-white font-mono text-xs placeholder-casino-muted focus:outline-none focus:border-gold"
                />
                <button
                  onClick={() => handleProcess(w.id, "approve")}
                  disabled={processing[w.id]}
                  className="bg-green-500/10 border border-green-500/30 text-green-400 hover:bg-green-500/20 px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition-all"
                >
                  {processing[w.id] ? "..." : "Approve"}
                </button>
                <button
                  onClick={() => handleProcess(w.id, "reject")}
                  disabled={processing[w.id]}
                  className="bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition-all"
                >
                  {processing[w.id] ? "..." : "Reject"}
                </button>
              </div>

              <div className="text-xs text-casino-muted font-mono">
                Submitted: {new Date(w.created_at).toLocaleString()}
                {w.review_required && <span className="text-yellow-400 ml-2">Review Required</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Shared Components ────────────────────────────────────────────────────────
function StatCard({ label, value, color, large }) {
  return (
    <div className="bg-casino-card border border-casino-border rounded-xl p-4">
      <div className="text-xs font-mono text-casino-muted uppercase tracking-widest mb-1">{label}</div>
      <div className={`font-mono font-bold ${large ? "text-xl" : "text-lg"} ${color || "text-white"}`}>{value}</div>
    </div>
  );
}

function ErrorBox({ message }) {
  return (
    <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-4 py-3 font-mono">
      {message}
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-casino-muted font-mono animate-pulse">Loading...</div>
    </div>
  );
}
