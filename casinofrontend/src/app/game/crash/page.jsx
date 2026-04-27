"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import Navbar from "@/components/Navbar";
import CrashGraph from "@/components/CrashGraph";
import { useCrash } from "@/hooks/useCrash";
import { getBalances, getCrashBetHistory } from "@/lib/api";
import * as BC from "@/lib/betConfig";

const CURRENCIES = ["USDT_POLYGON", "ETH_POLYGON", "USDT_TRON", "BTC"];
const CCY_SHORT  = { USDT_POLYGON: "USDT", ETH_POLYGON: "ETH", USDT_TRON: "USDT₮", BTC: "BTC" };

export default function CrashPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const token  = typeof window !== "undefined" ? localStorage.getItem("casino_token") : null;

  const {
    gameState, multiplier, crashPoint, history,
    activeBets, myBet, myQueuedBet,
    countdown, waitingDuration,
    error, connected, placeBet, cashOut,
  } = useCrash(token);

  const [currency, setCurrency]           = useState("USDT_POLYGON");
  const [betAmount, setBetAmount]         = useState("1");
  const [autoCashout, setAutoCashout]     = useState("2.00");
  const [autoCashoutOn, setAutoCashoutOn] = useState(false);
  const [balances, setBalances]           = useState({});
  const [betHistory, setBetHistory]       = useState([]);
  const [histTab, setHistTab]             = useState("players"); // players | mine

  // Autoplay state
  const [autoplayActive, setAutoplayActive] = useState(false);
  const [autoplayMode, setAutoplayMode]     = useState(null);   // number | "infinite"
  const [autoplayLeft, setAutoplayLeft]     = useState(0);
  const [customRounds, setCustomRounds]     = useState("");
  const autoplayRef = useRef({ active: false, mode: null, left: 0 });

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  useEffect(() => {
    if (user) { fetchBalances(); fetchMyHistory(); }
  }, [user]);

  // Refresh balance and history after each round ends
  useEffect(() => {
    if (gameState === "waiting") { fetchBalances(); fetchMyHistory(); }
  }, [gameState]);

  async function fetchBalances() {
    try {
      const data = await getBalances();
      const map = {};
      for (const [k, v] of Object.entries(data.balances)) map[k] = v.balance;
      setBalances(map);
    } catch {}
  }

  async function fetchMyHistory() {
    try {
      const data = await getCrashBetHistory(30);
      setBetHistory(data.bets);
    } catch {}
  }

  // Keep ref in sync with state for use inside effects
  useEffect(() => { BC.fetchPrices(); }, []);
  useEffect(() => { setBetAmount(BC.defaultBet(currency)); }, [currency]);

  useEffect(() => {
    autoplayRef.current = { active: autoplayActive, mode: autoplayMode, left: autoplayLeft };
  }, [autoplayActive, autoplayMode, autoplayLeft]);

  // Autoplay: auto-place bet when waiting phase starts
  useEffect(() => {
    if (gameState !== "waiting") return;
    const ap = autoplayRef.current;
    if (!ap.active) return;

    // Decrement counter for finite modes
    if (ap.mode !== "infinite") {
      if (ap.left <= 0) {
        stopAutoplay();
        return;
      }
      setAutoplayLeft(prev => prev - 1);
    }

    // Small delay to let the waiting phase settle
    const timer = setTimeout(() => {
      const amount = parseFloat(betAmount);
      if (!amount || amount <= 0) return;
      placeBet(amount, currency, autoCashoutOn && autoCashout ? parseFloat(autoCashout) : null);
    }, 500);
    return () => clearTimeout(timer);
  }, [gameState]);

  function startAutoplay(mode) {
    const rounds = mode === "infinite" ? 0 : mode;
    setAutoplayMode(mode);
    setAutoplayLeft(rounds);
    setAutoplayActive(true);
    autoplayRef.current = { active: true, mode, left: rounds };
  }

  function stopAutoplay() {
    setAutoplayActive(false);
    setAutoplayMode(null);
    setAutoplayLeft(0);
    autoplayRef.current = { active: false, mode: null, left: 0 };
  }

  function handleBet() {
    const amount = parseFloat(betAmount);
    if (!amount || amount <= 0) return;
    placeBet(amount, currency, autoCashoutOn && autoCashout ? parseFloat(autoCashout) : null);
  }

  // Can bet any time except "crashed" transition and if already have bet/queue
  const alreadyIn   = !!myBet || !!myQueuedBet;
  const canBet      = !alreadyIn && connected && gameState !== "crashed";
  const canCashout  = gameState === "running" && myBet && !myBet.cashedOut;
  const isQueued    = !!myQueuedBet;

  // Countdown bar progress 0→100
  const countdownPct = waitingDuration > 0
    ? Math.max(0, Math.min(100, (countdown / waitingDuration) * 100))
    : 0;

  if (authLoading) return <LoadingScreen />;

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar balances={balances} activeCurrency={currency} onCurrencyChange={setCurrency} />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── Left col ── */}
        <div className="lg:col-span-2 space-y-4">

          {/* Graph card */}
          <div className="bg-casino-card border border-casino-border rounded-2xl overflow-hidden">
            {/* Top bar */}
            <div className="px-5 py-3 border-b border-casino-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${connected ? "bg-green-400" : "bg-red-400"}`} />
                <span className="text-xs font-mono text-casino-muted uppercase tracking-widest">
                  {connected ? "Live" : "Disconnected"}
                </span>
              </div>
              <div className="flex gap-1.5 overflow-hidden">
                {history.slice(0, 9).map((h, i) => (
                  <span key={i} className={`text-xs font-mono px-2 py-0.5 rounded-full ${
                    h < 2   ? "bg-red-500/20 text-red-400" :
                    h < 5   ? "bg-yellow-500/20 text-yellow-400" :
                              "bg-green-500/20 text-green-400"
                  }`}>{h.toFixed(2)}×</span>
                ))}
              </div>
            </div>

            {/* Canvas */}
            <div className="relative" style={{ height: "300px" }}>
              <CrashGraph gameState={gameState} multiplier={multiplier} crashPoint={crashPoint} />

              {/* Overlay */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                {gameState === "waiting" ? (
                  <div className="text-center">
                    <div className="font-display text-4xl text-casino-muted mb-1">STARTING IN</div>
                    <div className="font-display text-7xl text-yellow-400">
                      {(countdown / 1000).toFixed(1)}s
                    </div>
                    {myBet && (
                      <div className="mt-2 text-green-400 font-mono text-sm">
                        ✓ Bet placed: {myBet.betAmount} {CCY_SHORT[myBet.currency]}
                      </div>
                    )}
                    {isQueued && (
                      <div className="mt-2 text-yellow-400 font-mono text-sm animate-pulse">
                        ⏳ Queued: {myQueuedBet.betAmount} {CCY_SHORT[myQueuedBet.currency]}
                      </div>
                    )}
                  </div>
                ) : gameState === "running" ? (
                  <div className="text-center">
                    <div className="font-display text-8xl text-gold drop-shadow-lg">
                      {multiplier.toFixed(2)}×
                    </div>
                    {myBet && !myBet.cashedOut && (
                      <div className="mt-2 text-gold font-mono text-sm animate-pulse">
                        🎯 {myBet.betAmount} {CCY_SHORT[myBet.currency]} riding
                      </div>
                    )}
                    {myBet && myBet.cashedOut && (
                      <div className="mt-2 text-green-400 font-mono text-sm">
                        ✓ Cashed out {myBet.cashoutAt?.toFixed(2)}× → +{parseFloat(myBet.payout).toFixed(5)}
                      </div>
                    )}
                    {isQueued && (
                      <div className="mt-2 text-yellow-400 font-mono text-sm">
                        ⏳ Next round: {myQueuedBet.betAmount} {CCY_SHORT[myQueuedBet.currency]}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center">
                    <div className="font-display text-8xl text-red-400 drop-shadow-lg">
                      {crashPoint?.toFixed(2)}×
                    </div>
                    <div className="text-red-400 font-mono text-sm font-semibold mt-1">CRASHED</div>
                    {myBet && !myBet.cashedOut && (
                      <div className="mt-2 text-red-400 font-mono text-sm">
                        ✗ Lost {myBet.betAmount} {CCY_SHORT[myBet.currency]}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Countdown bar — only during waiting */}
            {gameState === "waiting" && (
              <div className="h-1 bg-casino-surface">
                <div
                  className="h-full bg-yellow-400 transition-all duration-75"
                  style={{ width: `${countdownPct}%` }}
                />
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-4 py-3">
              {error}
            </div>
          )}

          {/* Controls */}
          <div className="bg-casino-card border border-casino-border rounded-2xl p-4 space-y-3">

            {/* Row 1: Bet amount + Auto cashout */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-casino-muted font-mono uppercase tracking-widest block mb-1">
                  Bet Amount
                </label>
                <input
                  type="number" min={BC.minBet(currency)} step={BC.stepSize(currency)}
                  value={betAmount}
                  onChange={e => setBetAmount(e.target.value)}
                  disabled={alreadyIn || autoplayActive}
                  className="w-full bg-casino-surface border border-casino-border rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-gold transition-colors disabled:opacity-40"
                />
                <div className="flex gap-1 mt-1">
                  {[["½", () => setBetAmount(v => BC.halfBet(v, currency))],
                    ["2×", () => setBetAmount(v => BC.doubleBet(v, currency))],
                    ["Max", () => setBetAmount(BC.maxBetAmount(currency, balances[currency]))]
                  ].map(([l, fn]) => (
                    <button key={l} onClick={fn} disabled={alreadyIn || autoplayActive}
                      className="flex-1 bg-casino-surface border border-casino-border rounded py-1 text-xs font-mono text-casino-muted hover:text-white transition-colors disabled:opacity-40">
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-casino-muted font-mono uppercase tracking-widest">
                    Auto Cashout
                  </label>
                  <div
                    role="switch"
                    aria-checked={autoCashoutOn}
                    onClick={() => setAutoCashoutOn(v => !v)}
                    className={`relative w-9 h-[18px] rounded-full cursor-pointer transition-colors duration-200 ${autoCashoutOn ? "bg-gold" : "bg-casino-muted"}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 bg-white rounded-full shadow transition-transform duration-200 ${
                      autoCashoutOn ? "translate-x-[18px]" : "translate-x-0"
                    }`} />
                  </div>
                </div>
                <input
                  type="number" min="1.01" step="0.1"
                  value={autoCashout}
                  onChange={e => setAutoCashout(e.target.value)}
                  disabled={!autoCashoutOn}
                  className="w-full bg-casino-surface border border-casino-border rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-gold transition-colors disabled:opacity-40"
                />
                <p className="text-casino-muted text-[10px] mt-1 font-mono">
                  {autoCashoutOn ? `Auto exit at ${autoCashout}×` : "Manual cashout"}
                </p>
              </div>
            </div>

            {/* Row 2: Currency + Autoplay inline */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-casino-muted font-mono uppercase tracking-widest block mb-1">
                  Currency
                </label>
                <div className="grid grid-cols-2 gap-1">
                  {CURRENCIES.map(c => (
                    <button key={c} onClick={() => setCurrency(c)} disabled={alreadyIn || autoplayActive}
                      className={`py-1.5 rounded text-xs font-mono transition-colors disabled:opacity-40 ${
                        currency === c
                          ? "bg-gold/10 text-gold border border-gold/30"
                          : "bg-casino-surface border border-casino-border text-casino-muted hover:text-white"
                      }`}>
                      {CCY_SHORT[c]}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs text-casino-muted font-mono uppercase tracking-widest block mb-1">
                  Autoplay
                </label>
                {autoplayActive ? (
                  <div className="flex items-center gap-2">
                    <button onClick={stopAutoplay}
                      className="flex-1 py-1.5 rounded text-xs font-mono bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-colors">
                      STOP
                    </button>
                    <span className="text-xs font-mono text-casino-muted shrink-0">
                      {autoplayMode === "infinite" ? "∞" : `${autoplayLeft} left`}
                    </span>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-4 gap-1">
                      {[10, 20, 50].map(n => (
                        <button key={n} onClick={() => startAutoplay(n)}
                          disabled={alreadyIn}
                          className="py-1.5 rounded text-xs font-mono bg-casino-surface border border-casino-border text-casino-muted hover:text-white hover:border-gold/30 transition-colors disabled:opacity-40">
                          {n}
                        </button>
                      ))}
                      <button onClick={() => startAutoplay("infinite")}
                        disabled={alreadyIn}
                        className="py-1.5 rounded text-xs font-mono bg-casino-surface border border-casino-border text-casino-muted hover:text-white hover:border-gold/30 transition-colors disabled:opacity-40">
                        ∞
                      </button>
                    </div>
                    <div className="flex gap-1 mt-1">
                      <input
                        type="number" min="1" step="1"
                        value={customRounds}
                        onChange={e => setCustomRounds(e.target.value)}
                        placeholder="Custom"
                        disabled={alreadyIn}
                        className="flex-1 bg-casino-surface border border-casino-border rounded px-2 py-1 text-white font-mono text-xs focus:outline-none focus:border-gold transition-colors disabled:opacity-40 min-w-0"
                      />
                      <button
                        onClick={() => { const n = parseInt(customRounds); if (n > 0) startAutoplay(n); }}
                        disabled={alreadyIn || !customRounds || parseInt(customRounds) <= 0}
                        className="px-2 py-1 rounded text-xs font-mono bg-casino-surface border border-casino-border text-casino-muted hover:text-white hover:border-gold/30 transition-colors disabled:opacity-40">
                        Go
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Action button */}
            {canCashout ? (
              <button onClick={cashOut}
                className="w-full py-3 rounded-xl text-lg font-display tracking-widest bg-green-500 hover:bg-green-400 text-white transition-all hover:-translate-y-0.5 shadow-lg shadow-green-500/20 animate-pulse-gold">
                CASH OUT {multiplier.toFixed(2)}×
              </button>
            ) : isQueued ? (
              <div className="w-full py-3 rounded-xl text-center font-display tracking-widest text-yellow-400 border border-yellow-400/30 bg-yellow-400/5 text-sm">
                ⏳ QUEUED FOR NEXT ROUND
              </div>
            ) : myBet ? (
              <div className={`w-full py-3 rounded-xl text-center font-display tracking-widest border text-sm ${
                myBet.cashedOut
                  ? "text-green-400 border-green-500/30 bg-green-500/5"
                  : gameState === "crashed"
                  ? "text-red-400 border-red-500/30 bg-red-500/5"
                  : "text-gold border-gold/30 bg-gold/5"
              }`}>
                {myBet.cashedOut
                  ? `✓ CASHED OUT ${myBet.cashoutAt?.toFixed(2)}×`
                  : gameState === "crashed"
                  ? "✗ LOST"
                  : "RIDING..."}
              </div>
            ) : (
              <button onClick={handleBet} disabled={!canBet}
                className="btn-gold w-full py-3 text-lg font-display tracking-widest disabled:opacity-50">
                {gameState === "crashed" ? "NEXT ROUND SOON..." : "PLACE BET"}
                {gameState === "running" && " (next round)"}
              </button>
            )}

            {gameState === "running" && !alreadyIn && (
              <p className="text-center text-casino-muted text-[10px] font-mono -mt-1">
                Round in progress — bet queued for next round
              </p>
            )}
          </div>
        </div>

        {/* ── Right col ── */}
        <div className="lg:col-span-1 flex flex-col gap-4">

          {/* Tab switcher */}
          <div className="bg-casino-card border border-casino-border rounded-2xl overflow-hidden flex flex-col" style={{ maxHeight: "520px" }}>
            <div className="flex border-b border-casino-border shrink-0">
              {[["players", "Players"], ["mine", "My Bets"]].map(([t, l]) => (
                <button key={t} onClick={() => setHistTab(t)}
                  className={`flex-1 py-3 text-xs font-mono uppercase tracking-widest transition-colors ${
                    histTab === t ? "text-gold border-b-2 border-gold bg-gold/5" : "text-casino-muted hover:text-white"
                  }`}>
                  {l}
                </button>
              ))}
            </div>

            <div className="overflow-y-auto flex-1 divide-y divide-casino-border">
              {histTab === "players" ? (
                activeBets.length === 0
                  ? <Empty text="No bets this round" />
                  : activeBets.map((bet, i) => (
                    <div key={i} className="px-4 py-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-mono text-white truncate">{bet.username}</div>
                        <div className="text-xs text-casino-muted font-mono">
                          {bet.betAmount} {CCY_SHORT[bet.currency] || ""}
                        </div>
                      </div>
                      {bet.cashedOut ? (
                        <div className="text-right shrink-0">
                          <div className="text-green-400 text-xs font-mono">{bet.cashoutAt?.toFixed(2)}×</div>
                          <div className="text-green-400 text-xs font-mono">+{parseFloat(bet.payout||0).toFixed(5)}</div>
                        </div>
                      ) : (
                        <div className={`text-xs font-mono font-semibold shrink-0 ${
                          gameState === "running" ? "text-gold animate-pulse" : "text-casino-muted"
                        }`}>
                          {gameState === "running" ? `${multiplier.toFixed(2)}×` : "waiting"}
                        </div>
                      )}
                    </div>
                  ))
              ) : (
                betHistory.length === 0
                  ? <Empty text="No crash bets yet" />
                  : betHistory.map((bet, i) => (
                    <div key={i} className={`px-4 py-3 flex items-center gap-3 border-l-2 ${
                      bet.won ? "border-green-500/40" : "border-red-500/20"
                    }`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-mono font-bold ${bet.won ? "text-green-400" : "text-red-400"}`}>
                            {bet.won ? `${parseFloat(bet.cashout_at).toFixed(2)}×` : `${parseFloat(bet.crash_point).toFixed(2)}×`}
                          </span>
                          <span className="text-casino-muted text-xs font-mono">#{bet.round_id}</span>
                        </div>
                        <div className="text-xs text-casino-muted font-mono">
                          {parseFloat(bet.bet_amount).toFixed(5)} {CCY_SHORT[bet.currency]}
                        </div>
                      </div>
                      <div className={`text-xs font-mono font-semibold shrink-0 ${bet.won ? "text-green-400" : "text-red-400"}`}>
                        {bet.won
                          ? `+${(parseFloat(bet.payout) - parseFloat(bet.bet_amount)).toFixed(5)}`
                          : `-${parseFloat(bet.bet_amount).toFixed(5)}`}
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function Empty({ text }) {
  return (
    <div className="flex items-center justify-center h-20 text-casino-muted text-sm font-mono">
      {text}
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
