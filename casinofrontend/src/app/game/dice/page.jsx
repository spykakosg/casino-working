"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import Navbar from "@/components/Navbar";
import BetHistory from "@/components/BetHistory";
import { placeDiceBet, getBalances, getBetHistory } from "@/lib/api";
import * as BC from "@/lib/betConfig";

const CURRENCIES = ["USDT_POLYGON", "ETH_POLYGON", "USDT_TRON", "BTC"];

export default function DicePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  // Game state
  const [currency, setCurrency]       = useState("USDT_POLYGON");
  const [betAmount, setBetAmount]     = useState("1");
  const [target, setTarget]           = useState(50);
  const [direction, setDirection]     = useState("under");
  const [rolling, setRolling]         = useState(false);
  const [result, setResult]           = useState(null);  // last bet result
  const [error, setError]             = useState("");

  // Balance & history
  const [balances, setBalances]       = useState({});
  const [history, setHistory]         = useState([]);
  const [historyPage, setHistoryPage] = useState(0);

  // Derived
  const winProbability = direction === "under" ? target : 100 - target;
  const multiplier     = winProbability > 0 ? ((99 / winProbability)).toFixed(4) : "0";
  const profitVal      = (parseFloat(betAmount) || 0) * (parseFloat(multiplier) - 1);
  const profit         = profitVal.toFixed(5);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  useEffect(() => {
    if (user) fetchBalances();
  }, [user]);

  useEffect(() => {
    if (user) fetchHistory();
  }, [user, historyPage]);

  async function fetchBalances() {
    try {
      const data = await getBalances();
      const map = {};
      for (const [k, v] of Object.entries(data.balances)) map[k] = v.balance;
      setBalances(map);
    } catch {}
  }

  async function fetchHistory() {
    try {
      const data = await getBetHistory(20, historyPage * 20);
      setHistory(prev => historyPage === 0 ? data.bets : [...prev, ...data.bets]);
    } catch {}
  }

  async function handleBet() {
    setError("");
    setRolling(true);
    setResult(null);
    try {
      const data = await placeDiceBet({
        currency,
        betAmount: parseFloat(betAmount),
        target,
        direction,
      });
      setResult(data);
      setBalances(prev => ({ ...prev, [currency]: data.balance }));
      setHistory(prev => [data.bet, ...prev]);
    } catch (err) {
      setError(err.message);
    } finally {
      setRolling(false);
    }
  }

  useEffect(() => { BC.fetchPrices(); }, []);
  useEffect(() => { setBetAmount(BC.defaultBet(currency)); }, [currency]);
  function halfBet()   { setBetAmount(v => BC.halfBet(v, currency)); }
  function doubleBet() { setBetAmount(v => BC.doubleBet(v, currency)); }
  function maxBet()    { setBetAmount(BC.maxBetAmount(currency, balances[currency])); }

  if (authLoading) return <LoadingScreen />;

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar balances={balances} activeCurrency={currency} onCurrencyChange={setCurrency} />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-4 grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Left: Game Controls */}
        <div className="lg:col-span-2 space-y-3">

          {/* Roll Result Display */}
          <div className="bg-casino-card border border-casino-border rounded-2xl p-4 min-h-[120px] flex flex-col items-center justify-center relative overflow-hidden">
            <div className="absolute inset-0 opacity-5"
              style={{backgroundImage:"radial-gradient(circle at 50% 50%, var(--gold) 0%, transparent 70%)"}} />

            {rolling ? (
              <RollingAnimation />
            ) : result ? (
              <ResultDisplay result={result} />
            ) : (
              <IdleDisplay />
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-3 py-2">
              {error}
            </div>
          )}

          {/* Controls card */}
          <div className="bg-casino-card border border-casino-border rounded-2xl p-4 space-y-3">
            {/* Direction Toggle */}
            <div className="flex gap-2">
              <DirectionButton
                active={direction === "under"}
                onClick={() => setDirection("under")}
                label="Roll Under"
                icon="↓"
              />
              <DirectionButton
                active={direction === "over"}
                onClick={() => setDirection("over")}
                label="Roll Over"
                icon="↑"
              />
            </div>

            {/* Target Slider */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-casino-muted font-mono uppercase tracking-widest">Target</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="2" max="98" step="1"
                    value={target}
                    onChange={e => setTarget(Math.min(98, Math.max(2, parseInt(e.target.value) || 50)))}
                    className="bg-casino-surface border border-casino-border rounded w-16 text-center py-1 font-mono text-white text-sm focus:outline-none focus:border-gold"
                  />
                  <span className="text-casino-muted font-mono text-xs">/ 100</span>
                </div>
              </div>

              <div className="relative">
                <div className="absolute top-2.5 left-0 h-1 rounded-full bg-gold/30 pointer-events-none"
                  style={{ width: `${target}%` }} />
                <input
                  type="range" min="2" max="98" step="1"
                  value={target}
                  onChange={e => setTarget(parseInt(e.target.value))}
                  className="w-full relative"
                />
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-3 gap-2">
                <StatBox label="Win Chance" value={`${winProbability}%`} />
                <StatBox label="Multiplier" value={`${parseFloat(multiplier).toFixed(2)}×`} highlight />
                <StatBox label="Profit" value={`+${profit}`} />
              </div>
            </div>

            {/* Bet Amount + Currency row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-casino-muted font-mono uppercase tracking-widest block mb-1">
                  Bet Amount
                </label>
                <div className="flex gap-1">
                  <input
                    type="number"
                    min={BC.minBet(currency)}
                    step={BC.stepSize(currency)}
                    value={betAmount}
                    onChange={e => setBetAmount(e.target.value)}
                    className="flex-1 bg-casino-surface border border-casino-border rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-gold transition-colors min-w-0"
                  />
                  <span className="bg-casino-surface border border-casino-border rounded-lg px-2 flex items-center text-casino-muted font-mono text-xs shrink-0">
                    {currency.split("_")[0]}
                  </span>
                </div>
                <div className="flex gap-1 mt-1">
                  {[["½", halfBet], ["2×", doubleBet], ["Max", maxBet]].map(([label, fn]) => (
                    <button key={label} onClick={fn}
                      className="flex-1 bg-casino-surface hover:bg-casino-muted/20 border border-casino-border rounded py-1 text-xs font-mono text-casino-muted hover:text-white transition-colors">
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs text-casino-muted font-mono uppercase tracking-widest block mb-1">
                  Currency
                </label>
                <div className="grid grid-cols-2 gap-1">
                  {CURRENCIES.map(c => {
                    const short = { USDT_POLYGON: "USDT", ETH_POLYGON: "ETH", USDT_TRON: "USDT₮", BTC: "BTC" };
                    return (
                      <button key={c} onClick={() => setCurrency(c)}
                        className={`py-1.5 rounded text-xs font-mono transition-colors ${
                          currency === c
                            ? "bg-gold/10 text-gold border border-gold/30"
                            : "bg-casino-surface border border-casino-border text-casino-muted hover:text-white"
                        }`}>
                        {short[c]}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Bet Button */}
            <button
              onClick={handleBet}
              disabled={rolling || !betAmount || parseFloat(betAmount) <= 0}
              className="btn-gold w-full py-3 text-lg font-display tracking-widest"
            >
              {rolling ? "ROLLING..." : "ROLL DICE"}
            </button>
          </div>
        </div>

        {/* Right: Bet History */}
        <div className="lg:col-span-1">
          <BetHistory history={history} currency={currency} onLoadMore={() => setHistoryPage(p => p + 1)} />
        </div>
      </main>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function IdleDisplay() {
  return (
    <div className="text-center">
      <div className="font-display text-5xl text-casino-border mb-1">?</div>
      <p className="text-casino-muted text-xs font-mono">Place a bet to roll</p>
    </div>
  );
}

function RollingAnimation() {
  return (
    <div className="text-center">
      <div className="font-display text-5xl text-gold animate-pulse-gold mb-1">...</div>
      <p className="text-casino-muted text-xs font-mono animate-pulse">Rolling the dice</p>
    </div>
  );
}

function ResultDisplay({ result }) {
  const { bet } = result;
  const won = bet.won;
  return (
    <div className="text-center animate-roll-in w-full">
      {/* Roll number */}
      <div className={`font-display text-6xl mb-1 ${won ? "text-green-400" : "text-red-400"}`}>
        {bet.roll.toFixed(2)}
      </div>

      {/* Win/Loss badge */}
      <div className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-mono font-medium mb-3 ${
        won ? "bg-green-500/10 text-green-400 border border-green-500/30"
             : "bg-red-500/10 text-red-400 border border-red-500/30"
      }`}>
        {won ? "✓ WIN" : "✗ LOSS"}
        <span className="opacity-70">
          {won ? `+${bet.payout.toFixed(5)}` : `-${bet.betAmount.toFixed(5)}`}
        </span>
      </div>

      {/* Detail row */}
      <div className="flex justify-center gap-6 text-xs font-mono text-casino-muted">
        <span>{bet.direction === "under" ? "< " : "> "}{bet.target}</span>
        <span>{bet.multiplier}×</span>
        <span>nonce #{bet.nonce}</span>
      </div>
    </div>
  );
}

function DirectionButton({ active, onClick, label, icon }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-mono font-medium transition-all ${
        active
          ? "bg-gold text-casino-bg shadow-lg shadow-gold/20"
          : "bg-casino-surface border border-casino-border text-casino-muted hover:text-white"
      }`}
    >
      <span className="text-lg">{icon}</span> {label}
    </button>
  );
}

function StatBox({ label, value, highlight }) {
  return (
    <div className="bg-casino-surface border border-casino-border rounded-lg p-2 text-center">
      <div className={`font-mono font-semibold text-sm ${highlight ? "text-gold" : "text-white"}`}>
        {value}
      </div>
      <div className="text-casino-muted text-[10px] mt-0.5">{label}</div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
