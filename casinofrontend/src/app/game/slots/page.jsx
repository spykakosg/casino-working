"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import Navbar from "@/components/Navbar";
import BetHistory from "@/components/BetHistory";
import { placeSlotsBet, getBalances, getSlotsBetHistory } from "@/lib/api";
import * as BC from "@/lib/betConfig";

const CURRENCIES = ["USDT_POLYGON", "ETH_POLYGON", "USDT_TRON", "BTC"];

const SYMBOL_MAP = {
  seven:  { emoji: "7\ufe0f\u20e3", label: "7" },
  bar:    { emoji: "\ud83c\udfa8", label: "BAR" },
  bell:   { emoji: "\ud83d\udd14", label: "BELL" },
  cherry: { emoji: "\ud83c\udf52", label: "CHRY" },
  lemon:  { emoji: "\ud83c\udf4b", label: "LMON" },
};

const SYMBOL_LIST = ["seven", "bar", "bell", "cherry", "lemon"];
const REEL_SPIN_EMOJIS = ["7\ufe0f\u20e3", "\ud83c\udfa8", "\ud83d\udd14", "\ud83c\udf52", "\ud83c\udf4b"];

function SlotCell({ symbol, spinning, won }) {
  const [display, setDisplay] = useState(symbol);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (spinning) {
      intervalRef.current = setInterval(() => {
        setDisplay(SYMBOL_LIST[Math.floor(Math.random() * SYMBOL_LIST.length)]);
      }, 60);
      return () => clearInterval(intervalRef.current);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setDisplay(symbol);
    }
  }, [spinning, symbol]);

  const info = SYMBOL_MAP[display] || SYMBOL_MAP.lemon;

  return (
    <div className={`w-14 h-14 sm:w-16 sm:h-16 rounded-lg flex items-center justify-center text-2xl sm:text-3xl transition-all duration-300 ${
      won ? "bg-gold/20 border-2 border-gold shadow-lg shadow-gold/30 scale-110" :
      spinning ? "bg-casino-surface/80 border border-casino-border animate-pulse" :
      "bg-casino-surface border border-casino-border"
    }`}>
      <span className={`${spinning ? "animate-bounce" : ""}`}>{info.emoji}</span>
    </div>
  );
}

export default function SlotsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [currency, setCurrency]   = useState("USDT_POLYGON");
  const [betAmount, setBetAmount] = useState("1");
  const [spinning, setSpinning]   = useState(false);
  const [grid, setGrid]           = useState(null);
  const [result, setResult]       = useState(null);
  const [error, setError]         = useState("");
  const [balances, setBalances]   = useState({});
  const [history, setHistory]     = useState([]);
  const [historyPage, setHistoryPage] = useState(0);
  const [showPaytable, setShowPaytable] = useState(false);
  const [reelStates, setReelStates] = useState([false, false, false, false, false]);
  const [winAnim, setWinAnim]     = useState(false);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  useEffect(() => { if (user) fetchBalances(); }, [user]);
  useEffect(() => { if (user) fetchHistory(); }, [user, historyPage]);

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
      const data = await getSlotsBetHistory(20, historyPage * 20);
      setHistory(prev => historyPage === 0 ? data.bets : [...prev, ...data.bets]);
    } catch {}
  }

  async function handleSpin() {
    setError("");
    setSpinning(true);
    setResult(null);
    setWinAnim(false);
    setReelStates([true, true, true, true, true]);

    try {
      const data = await placeSlotsBet({
        currency,
        betAmount: parseFloat(betAmount),
      });
      const bet = data.bet;

      // Stop reels sequentially with delays
      const delays = [500, 800, 1100, 1400, 1700];
      delays.forEach((delay, col) => {
        setTimeout(() => {
          setGrid(bet.grid);
          setReelStates(prev => {
            const next = [...prev];
            next[col] = false;
            return next;
          });
        }, delay);
      });

      // Final result after all reels stop
      setTimeout(() => {
        setResult(bet);
        setSpinning(false);
        setBalances(prev => ({ ...prev, [currency]: data.balance }));
        if (bet.won) {
          setWinAnim(true);
          setTimeout(() => setWinAnim(false), 3000);
        }
        setHistory(prev => [{
          id: bet.betId,
          game: "slots",
          currency,
          bet_amount: bet.betAmount,
          payout: bet.payout,
          profit: bet.profit,
          won: bet.won,
          multiplier: bet.multiplier,
          created_at: new Date().toISOString(),
        }, ...prev]);
      }, 2000);
    } catch (err) {
      setError(err.message);
      setSpinning(false);
      setReelStates([false, false, false, false, false]);
    }
  }

  useEffect(() => { BC.fetchPrices(); }, []);
  useEffect(() => { setBetAmount(BC.defaultBet(currency)); }, [currency]);
  function halfBet()   { setBetAmount(v => BC.halfBet(v, currency)); }
  function doubleBet() { setBetAmount(v => BC.doubleBet(v, currency)); }
  function maxBet()    { setBetAmount(BC.maxBetAmount(currency, balances[currency])); }

  if (authLoading) return <LoadingScreen />;

  const displayGrid = grid || [
    [{ name: "cherry" }, { name: "bell" }, { name: "seven" }, { name: "lemon" }, { name: "bar" }],
    [{ name: "lemon" }, { name: "cherry" }, { name: "bar" }, { name: "bell" }, { name: "cherry" }],
    [{ name: "bell" }, { name: "seven" }, { name: "lemon" }, { name: "cherry" }, { name: "lemon" }],
  ];

  // Determine which cells are on the winning line
  const winningCells = new Set();
  if (result?.won && result.winningLine >= 0) {
    const linePatterns = [
      [[0,0],[0,1],[0,2],[0,3],[0,4]],
      [[1,0],[1,1],[1,2],[1,3],[1,4]],
      [[2,0],[2,1],[2,2],[2,3],[2,4]],
      [[0,0],[1,1],[2,2],[1,3],[0,4]],
      [[2,0],[1,1],[0,2],[1,3],[2,4]],
    ];
    const pattern = linePatterns[result.winningLine];
    if (pattern) {
      const matchCount = result.matchCount || 3;
      for (let i = 0; i < matchCount; i++) {
        winningCells.add(`${pattern[i][0]}-${pattern[i][1]}`);
      }
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar balances={balances} activeCurrency={currency} onCurrencyChange={setCurrency} />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-3">

          {/* Slot Machine */}
          <div className={`bg-casino-card border rounded-2xl p-4 relative overflow-hidden transition-all duration-500 ${
            winAnim ? "border-gold shadow-lg shadow-gold/20" : "border-casino-border"
          }`}>
            {/* Decorative lights */}
            {winAnim && (
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-500 via-yellow-500 to-green-500 animate-pulse" />
                <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-green-500 via-yellow-500 to-red-500 animate-pulse" />
              </div>
            )}

            <div className="relative z-10">
              <div className="text-center mb-3">
                <h2 className={`text-xl font-black tracking-wider transition-colors ${winAnim ? "text-gold animate-pulse" : "text-gold"}`}>
                  MEGA SLOTS
                </h2>
              </div>

              {/* Machine body */}
              <div className="bg-gradient-to-b from-gray-900 to-black rounded-xl p-3 border border-gold/20 relative">
                {/* Top light bar */}
                <div className="flex justify-center gap-1 mb-2">
                  {Array(9).fill(0).map((_, i) => (
                    <div key={i} className={`w-2 h-2 rounded-full transition-all ${
                      spinning || winAnim
                        ? i % 2 === 0 ? "bg-red-500 animate-pulse" : "bg-yellow-500 animate-pulse"
                        : "bg-gray-700"
                    }`} style={{ animationDelay: `${i * 100}ms` }} />
                  ))}
                </div>

                {/* Reels area */}
                <div className="bg-black/50 rounded-lg p-2 border border-gray-800">
                  {displayGrid.map((row, rowIdx) => (
                    <div key={rowIdx} className="flex items-center justify-center gap-1.5 sm:gap-2 py-0.5">
                      {row.map((sym, colIdx) => (
                        <SlotCell
                          key={`${rowIdx}-${colIdx}`}
                          symbol={sym.name}
                          spinning={reelStates[colIdx]}
                          won={winningCells.has(`${rowIdx}-${colIdx}`)}
                        />
                      ))}
                    </div>
                  ))}
                </div>

                {/* Bottom light bar */}
                <div className="flex justify-center gap-1 mt-2">
                  {Array(9).fill(0).map((_, i) => (
                    <div key={i} className={`w-2 h-2 rounded-full transition-all ${
                      spinning || winAnim
                        ? i % 2 === 1 ? "bg-green-500 animate-pulse" : "bg-blue-500 animate-pulse"
                        : "bg-gray-700"
                    }`} style={{ animationDelay: `${i * 150}ms` }} />
                  ))}
                </div>
              </div>

              {/* Result */}
              {result && (
                <div className={`text-center mt-3 transition-all duration-500 ${winAnim ? "scale-110" : ""}`}>
                  {result.won ? (
                    <>
                      <p className={`text-2xl font-black ${winAnim ? "text-gold animate-pulse" : "text-green-400"}`}>
                        WIN! {result.multiplier}x
                      </p>
                      <p className="text-green-400 font-mono text-sm">+{result.profit.toFixed(5)}</p>
                      {result.matchCount && (
                        <p className="text-xs text-casino-muted mt-1">{result.matchCount}-of-a-kind!</p>
                      )}
                    </>
                  ) : (
                    <p className="text-casino-muted text-sm">No match — try again!</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-3 py-2">
              {error}
            </div>
          )}

          {/* Controls */}
          <div className="bg-casino-card border border-casino-border rounded-2xl p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <span className="text-xs text-casino-muted font-mono uppercase tracking-widest">Bet Amount</span>
                <input type="number" min={BC.minBet(currency)} step={BC.stepSize(currency)} value={betAmount} onChange={e => setBetAmount(e.target.value)}
                  className="w-full bg-casino-surface border border-casino-border rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-gold/50" />
                <div className="flex gap-1">
                  <button onClick={halfBet} className="flex-1 bg-casino-surface border border-casino-border rounded px-2 py-1 text-xs text-casino-muted hover:text-white transition-colors">1/2</button>
                  <button onClick={doubleBet} className="flex-1 bg-casino-surface border border-casino-border rounded px-2 py-1 text-xs text-casino-muted hover:text-white transition-colors">2x</button>
                  <button onClick={maxBet} className="flex-1 bg-casino-surface border border-casino-border rounded px-2 py-1 text-xs text-casino-muted hover:text-white transition-colors">Max</button>
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-casino-muted font-mono uppercase tracking-widest">Currency</span>
                <select value={currency} onChange={e => setCurrency(e.target.value)}
                  className="w-full bg-casino-surface border border-casino-border rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-gold/50">
                  {CURRENCIES.map(c => <option key={c} value={c}>{c.replace("_", " ")}</option>)}
                </select>
                <button onClick={() => setShowPaytable(!showPaytable)}
                  className="text-xs text-gold hover:text-yellow-400 transition-colors">
                  {showPaytable ? "Hide" : "Show"} Paytable
                </button>
              </div>
            </div>

            {showPaytable && (
              <div className="bg-casino-surface rounded-lg p-3 space-y-1.5 border border-casino-border">
                <p className="text-xs text-gold font-mono uppercase tracking-widest mb-2">Paytable</p>
                <div className="grid grid-cols-4 gap-1 text-xs text-casino-muted">
                  <span>Symbol</span><span className="text-center">3x</span><span className="text-center">4x</span><span className="text-center">5x</span>
                </div>
                {[
                  { e: "7\ufe0f\u20e3", p3: "10x", p4: "25x", p5: "100x" },
                  { e: "\ud83c\udfa8", p3: "5x", p4: "15x", p5: "50x" },
                  { e: "\ud83d\udd14", p3: "3x", p4: "8x", p5: "25x" },
                  { e: "\ud83c\udf52", p3: "2x", p4: "4x", p5: "10x" },
                  { e: "\ud83c\udf4b", p3: "1.5x", p4: "2x", p5: "5x" },
                ].map((p, i) => (
                  <div key={i} className="grid grid-cols-4 gap-1 text-xs">
                    <span className="text-lg">{p.e}</span>
                    <span className="text-center text-gold">{p.p3}</span>
                    <span className="text-center text-gold">{p.p4}</span>
                    <span className="text-center text-gold">{p.p5}</span>
                  </div>
                ))}
              </div>
            )}

            <button onClick={handleSpin} disabled={spinning}
              className={`w-full py-3 rounded-xl font-bold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                spinning
                  ? "bg-gray-600 text-gray-300"
                  : "bg-gradient-to-r from-red-600 via-gold to-red-600 text-black hover:shadow-lg hover:shadow-gold/30 animate-[shimmer_3s_infinite]"
              }`}>
              {spinning ? "Spinning..." : "SPIN"}
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <BetHistory title="Slots History" bets={history} onLoadMore={() => setHistoryPage(p => p + 1)} />
        </div>
      </main>
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
