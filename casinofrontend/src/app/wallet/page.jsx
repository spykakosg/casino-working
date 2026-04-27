"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import Navbar from "@/components/Navbar";
import {
  getBalances, getDepositAddress, requestWithdrawal,
  getDepositHistory, getWithdrawalHistory,
} from "@/lib/api";

const CURRENCIES = ["USDT_POLYGON", "ETH_POLYGON", "USDT_TRON", "BTC"];
const CURRENCY_LABELS = {
  USDT_POLYGON: { name: "USDT", network: "Polygon", color: "text-purple-400" },
  ETH_POLYGON:  { name: "ETH",  network: "Polygon", color: "text-blue-400" },
  USDT_TRON:    { name: "USDT", network: "Tron",    color: "text-red-400" },
  BTC:          { name: "BTC",  network: "Bitcoin", color: "text-orange-400" },
};

export default function WalletPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [balances, setBalances]           = useState({});
  const [activeCurrency, setActiveCurrency] = useState("USDT_POLYGON");
  const [tab, setTab]                     = useState("deposit"); // deposit | withdraw | history
  const [depositAddress, setDepositAddress] = useState(null);
  const [depositLoading, setDepositLoading] = useState(false);
  const [deposits, setDeposits]           = useState([]);
  const [withdrawals, setWithdrawals]     = useState([]);
  const [copied, setCopied]               = useState(false);

  // Withdraw form
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawAddress, setWithdrawAddress] = useState("");
  const [withdrawError, setWithdrawError]   = useState("");
  const [withdrawSuccess, setWithdrawSuccess] = useState("");
  const [withdrawLoading, setWithdrawLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  useEffect(() => {
    if (user) {
      fetchBalances();
      fetchHistory();
    }
  }, [user]);

  useEffect(() => {
    if (tab === "deposit") fetchDepositAddress();
  }, [tab, activeCurrency]);

  async function fetchBalances() {
    try {
      const data = await getBalances();
      const map = {};
      for (const [k, v] of Object.entries(data.balances)) map[k] = v.balance;
      setBalances(map);
    } catch {}
  }

  async function fetchDepositAddress() {
    setDepositLoading(true);
    try {
      const data = await getDepositAddress(activeCurrency);
      setDepositAddress(data.address);
    } catch (err) {
      setDepositAddress(null);
    } finally {
      setDepositLoading(false);
    }
  }

  async function fetchHistory() {
    try {
      const [d, w] = await Promise.all([getDepositHistory(), getWithdrawalHistory()]);
      setDeposits(d.deposits);
      setWithdrawals(w.withdrawals);
    } catch {}
  }

  async function handleWithdraw(e) {
    e.preventDefault();
    setWithdrawError("");
    setWithdrawSuccess("");
    setWithdrawLoading(true);
    try {
      await requestWithdrawal(activeCurrency, parseFloat(withdrawAmount), withdrawAddress);
      setWithdrawSuccess("Withdrawal submitted successfully!");
      setWithdrawAmount("");
      setWithdrawAddress("");
      fetchBalances();
      fetchHistory();
    } catch (err) {
      setWithdrawError(err.message);
    } finally {
      setWithdrawLoading(false);
    }
  }

  function copyAddress() {
    if (!depositAddress) return;
    navigator.clipboard.writeText(depositAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const balancesForNav = {};
  for (const [k, v] of Object.entries(balances)) balancesForNav[k] = v;

  if (authLoading) return <LoadingScreen />;

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar balances={balancesForNav} activeCurrency={activeCurrency} onCurrencyChange={setActiveCurrency} />

      <main className="max-w-4xl mx-auto w-full px-4 py-6 space-y-6">
        {/* Balance Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {CURRENCIES.map(c => {
            const info = CURRENCY_LABELS[c];
            const bal = balances[c] ?? 0;
            return (
              <button
                key={c}
                onClick={() => setActiveCurrency(c)}
                className={`bg-casino-card border rounded-xl p-4 text-left transition-all ${
                  activeCurrency === c
                    ? "border-gold/50 glow-gold"
                    : "border-casino-border hover:border-casino-muted"
                }`}
              >
                <div className={`text-xs font-mono font-semibold mb-1 ${info.color}`}>
                  {info.name}
                </div>
                <div className="text-white font-mono font-bold text-lg">
                  {bal.toFixed(4)}
                </div>
                <div className="text-casino-muted text-xs mt-0.5">{info.network}</div>
              </button>
            );
          })}
        </div>

        {/* Tabs */}
        <div className="bg-casino-card border border-casino-border rounded-2xl overflow-hidden">
          <div className="flex border-b border-casino-border">
            {[["deposit", "Deposit"], ["withdraw", "Withdraw"], ["history", "History"]].map(([t, label]) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-3.5 text-sm font-mono uppercase tracking-widest transition-colors ${
                  tab === t
                    ? "text-gold border-b-2 border-gold bg-gold/5"
                    : "text-casino-muted hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="p-6">
            {/* Deposit Tab */}
            {tab === "deposit" && (
              <div className="space-y-5">
                <div>
                  <h3 className="font-semibold mb-1">
                    Deposit {CURRENCY_LABELS[activeCurrency].name}
                  </h3>
                  <p className="text-casino-muted text-sm">
                    Send {CURRENCY_LABELS[activeCurrency].name} to your unique address below.
                    Your balance will be credited after 2 confirmations.
                  </p>
                </div>

                {depositLoading ? (
                  <div className="h-24 flex items-center justify-center">
                    <div className="w-6 h-6 border-2 border-gold border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : depositAddress ? (
                  <div>
                    <div className="bg-casino-surface border border-casino-border rounded-xl p-4 flex items-center gap-3">
                      <code className="flex-1 text-gold font-mono text-sm break-all">
                        {depositAddress}
                      </code>
                      <button
                        onClick={copyAddress}
                        className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-mono transition-all ${
                          copied
                            ? "bg-green-500/20 text-green-400 border border-green-500/30"
                            : "bg-casino-card border border-casino-border text-casino-muted hover:text-white"
                        }`}
                      >
                        {copied ? "Copied!" : "Copy"}
                      </button>
                    </div>
                    <p className="text-casino-muted text-xs mt-3 font-mono">
                      ⚠ Only send {CURRENCY_LABELS[activeCurrency].name} on {CURRENCY_LABELS[activeCurrency].network} network to this address.
                    </p>
                  </div>
                ) : (
                  <div className="bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 rounded-xl p-4 text-sm">
                    Deposit address not yet assigned. Make sure the deposit watcher service is running (<code className="font-mono">npm run watcher</code> in the backend).
                  </div>
                )}
              </div>
            )}

            {/* Withdraw Tab */}
            {tab === "withdraw" && (
              <form onSubmit={handleWithdraw} className="space-y-4">
                <div>
                  <h3 className="font-semibold mb-1">Withdraw {CURRENCY_LABELS[activeCurrency].name}</h3>
                  <p className="text-casino-muted text-sm">
                    Available: <span className="text-white font-mono">{(balances[activeCurrency] ?? 0).toFixed(8)}</span>
                  </p>
                </div>

                {withdrawError && (
                  <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-4 py-3">
                    {withdrawError}
                  </div>
                )}
                {withdrawSuccess && (
                  <div className="bg-green-500/10 border border-green-500/30 text-green-400 text-sm rounded-xl px-4 py-3">
                    {withdrawSuccess}
                  </div>
                )}

                <div>
                  <label className="text-xs text-casino-muted font-mono uppercase tracking-widest block mb-2">Amount</label>
                  <input
                    type="number" min="0.01" step="0.01"
                    value={withdrawAmount}
                    onChange={e => setWithdrawAmount(e.target.value)}
                    className="w-full bg-casino-surface border border-casino-border rounded-lg px-4 py-3 text-white font-mono focus:outline-none focus:border-gold transition-colors"
                    placeholder="0.00"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs text-casino-muted font-mono uppercase tracking-widest block mb-2">
                    Destination Address
                  </label>
                  <input
                    type="text"
                    value={withdrawAddress}
                    onChange={e => setWithdrawAddress(e.target.value)}
                    className="w-full bg-casino-surface border border-casino-border rounded-lg px-4 py-3 text-white font-mono text-sm focus:outline-none focus:border-gold transition-colors"
                    placeholder="0x..."
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={withdrawLoading}
                  className="btn-gold w-full py-3 text-sm font-mono uppercase tracking-widest"
                >
                  {withdrawLoading ? "Processing..." : "Request Withdrawal"}
                </button>
              </form>
            )}

            {/* History Tab */}
            {tab === "history" && (
              <div className="space-y-6">
                <div>
                  <h3 className="font-semibold text-sm font-mono uppercase tracking-widest text-casino-muted mb-3">
                    Deposits
                  </h3>
                  {deposits.length === 0 ? (
                    <p className="text-casino-muted text-sm">No deposits yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {deposits.map(d => (
                        <div key={d.id} className="bg-casino-surface border border-casino-border rounded-xl px-4 py-3 flex justify-between items-center">
                          <div>
                            <div className="text-white font-mono text-sm">{d.amount} {d.currency.split("_")[0]}</div>
                            <div className="text-casino-muted text-xs font-mono mt-0.5 truncate max-w-[200px]">{d.tx_hash}</div>
                          </div>
                          <StatusBadge status={d.status} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <h3 className="font-semibold text-sm font-mono uppercase tracking-widest text-casino-muted mb-3">
                    Withdrawals
                  </h3>
                  {withdrawals.length === 0 ? (
                    <p className="text-casino-muted text-sm">No withdrawals yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {withdrawals.map(w => (
                        <div key={w.id} className="bg-casino-surface border border-casino-border rounded-xl px-4 py-3 flex justify-between items-center">
                          <div>
                            <div className="text-white font-mono text-sm">{w.amount} {w.currency.split("_")[0]}</div>
                            <div className="text-casino-muted text-xs font-mono mt-0.5 truncate max-w-[200px]">{w.to_address}</div>
                          </div>
                          <StatusBadge status={w.status} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    confirmed:  "bg-green-500/10 text-green-400 border-green-500/30",
    pending:    "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
    sent:       "bg-blue-500/10 text-blue-400 border-blue-500/30",
    failed:     "bg-red-500/10 text-red-400 border-red-500/30",
    processing: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  };
  return (
    <span className={`text-xs font-mono border rounded-full px-3 py-1 ${map[status] || "bg-casino-muted/10 text-casino-muted border-casino-border"}`}>
      {status}
    </span>
  );
}

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
