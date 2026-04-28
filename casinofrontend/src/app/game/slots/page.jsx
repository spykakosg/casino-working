"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import Navbar from "@/components/Navbar";
import BetHistory from "@/components/BetHistory";
import { placeSlotsBet, getBalances, getSlotsBetHistory } from "@/lib/api";
import * as BC from "@/lib/betConfig";

const CURRENCIES = ["USDT_POLYGON", "ETH_POLYGON", "USDT_TRON", "BTC"];
const SHORT = { USDT_POLYGON: "USDT", ETH_POLYGON: "ETH", USDT_TRON: "USDT₮", BTC: "BTC" };

const SYMBOL_MAP = {
  seven:  { emoji: "₿", label: "BTC" },
  bar:    { emoji: "Ξ", label: "ETH" },
  bell:   { emoji: "Ð", label: "DOGE" },
  cherry: { emoji: "◎", label: "SOL" },
  lemon:  { emoji: "◉", label: "ADA" },
};

const SYMBOL_LIST = Object.keys(SYMBOL_MAP);

function ReelCell({ symbol, spinning, won }) {
  const [display, setDisplay] = useState(symbol);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (spinning) {
      intervalRef.current = setInterval(() => {
        setDisplay(SYMBOL_LIST[Math.floor(Math.random() * SYMBOL_LIST.length)]);
      }, 65);
      return () => clearInterval(intervalRef.current);
    }
    if (intervalRef.current) clearInterval(intervalRef.current);
    setDisplay(symbol);
  }, [spinning, symbol]);

  const info = SYMBOL_MAP[display] || SYMBOL_MAP.lemon;
  return (
    <div className={`h-20 sm:h-24 rounded-2xl border flex flex-col items-center justify-center transition-all duration-300 ${
      won
        ? "border-yellow-300 bg-gradient-to-b from-yellow-500/25 to-orange-500/20 shadow-[0_0_24px_rgba(255,200,0,.35)] scale-[1.03]"
        : spinning
        ? "border-fuchsia-400/40 bg-[#101734] animate-pulse"
        : "border-blue-500/35 bg-[#0d1430]"
    }`}>
      <div className={`text-3xl sm:text-4xl ${spinning ? "animate-bounce" : ""}`}>{info.emoji}</div>
      <div className="text-[10px] sm:text-xs text-casino-muted font-mono mt-1">{info.label}</div>
    </div>
  );
}

export default function SlotsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [currency, setCurrency] = useState("USDT_POLYGON");
  const [betAmount, setBetAmount] = useState("1");
  const [spinning, setSpinning] = useState(false);
  const [grid, setGrid] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [balances, setBalances] = useState({});
  const [history, setHistory] = useState([]);
  const [historyPage, setHistoryPage] = useState(0);
  const [reelStates, setReelStates] = useState([false, false, false, false, false]);
  const [winAnim, setWinAnim] = useState(false);

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
      const data = await placeSlotsBet({ currency, betAmount: parseFloat(betAmount) });
      const bet = data.bet;

      const delays = [450, 750, 1050, 1350, 1650];
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

      setTimeout(() => {
        setResult(bet);
        setSpinning(false);
        setBalances(prev => ({ ...prev, [currency]: data.balance }));

        if (bet.won) {
          setWinAnim(true);
          setTimeout(() => setWinAnim(false), 2600);
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
      }, 1900);
    } catch (err) {
      setError(err.message);
      setSpinning(false);
      setReelStates([false, false, false, false, false]);
    }
  }

  useEffect(() => { BC.fetchPrices(); }, []);
  useEffect(() => { setBetAmount(BC.defaultBet(currency)); }, [currency]);

  function halfBet() { setBetAmount(v => BC.halfBet(v, currency)); }
  function doubleBet() { setBetAmount(v => BC.doubleBet(v, currency)); }
  function maxBet() { setBetAmount(BC.maxBetAmount(currency, balances[currency])); }

  if (authLoading) return <LoadingScreen />;

  const displayGrid = grid || [
    [{ name: "seven" }, { name: "bar" }, { name: "bell" }, { name: "cherry" }, { name: "lemon" }],
    [{ name: "lemon" }, { name: "cherry" }, { name: "bar" }, { name: "bell" }, { name: "seven" }],
    [{ name: "bar" }, { name: "seven" }, { name: "lemon" }, { name: "cherry" }, { name: "bell" }],
  ];

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
      const count = result.matchCount || 3;
      for (let i = 0; i < count; i++) winningCells.add(`${pattern[i][0]}-${pattern[i][1]}`);
    }
  }

  const dec = BC.displayDecimals(currency);
  const profitText = result ? Math.abs(parseFloat(result.profit || 0)).toFixed(dec) : "0";

  return (
    <div className="min-h-screen flex flex-col bg-[#050914]">
      <Navbar balances={balances} activeCurrency={currency} onCurrencyChange={setCurrency} />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-3">
          <div className={`rounded-3xl border p-4 sm:p-5 relative overflow-hidden ${
            winAnim ? "border-yellow-300 shadow-[0_0_45px_rgba(255,200,0,.25)]" : "border-blue-500/35"
          } bg-gradient-to-b from-[#0a1030] to-[#050914]`}>
            <div className="absolute inset-0 opacity-30 pointer-events-none" style={{ backgroundImage: "radial-gradient(circle at 50% 0%, #2b3f8f 0%, transparent 55%)" }} />

            <div className="relative z-10 grid grid-cols-3 gap-2 mb-3">
              <Panel title="Jackpot" value="$251,459.70" tone="gold" align="left" />
              <div className="rounded-xl border border-fuchsia-400/30 bg-gradient-to-r from-blue-500/15 to-fuchsia-500/15 px-3 py-2 text-center flex items-center justify-center">
                <h2 className="text-lg sm:text-2xl font-black tracking-widest text-blue-200">CRYPTO FORTUNE</h2>
              </div>
              <Panel title="Multiplier" value={result?.multiplier ? `x${result.multiplier}` : "x--"} tone="pink" align="right" />
            </div>

            <div className="grid grid-cols-[90px_1fr_90px] gap-2">
              <SideCard label="Free Spins" value="12" footer={`Total ${SHORT[currency]}`} />

              <div className="rounded-2xl border border-blue-500/35 bg-black/35 p-2 sm:p-3">
                {displayGrid.map((row, r) => (
                  <div key={r} className="grid grid-cols-5 gap-1.5 sm:gap-2 mb-1.5 last:mb-0">
                    {row.map((sym, c) => (
                      <ReelCell
                        key={`${r}-${c}`}
                        symbol={sym.name}
                        spinning={reelStates[c]}
                        won={winningCells.has(`${r}-${c}`)}
                      />
                    ))}
                  </div>
                ))}
              </div>

              <SideCard label="Win" value={result?.won ? `+${profitText}` : "--"} footer={SHORT[currency]} />
            </div>

            {result && (
              <div className="mt-3 text-center">
                {result.won ? (
                  <>
                    <div className="text-yellow-300 font-black text-2xl">WIN x{result.multiplier}</div>
                    <div className="text-green-400 font-mono text-sm">+{profitText} {SHORT[currency]}</div>
                  </>
                ) : (
                  <div className="text-casino-muted text-sm">No hit this spin — try again.</div>
                )}
              </div>
            )}
          </div>

          {error && <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-3 py-2">{error}</div>}

          <div className="bg-[#0b1230] border border-blue-500/30 rounded-2xl p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <span className="text-xs text-casino-muted font-mono uppercase tracking-widest">Bet Amount</span>
                <input
                  type="number"
                  min={BC.inputMin(currency)}
                  step={BC.stepSize(currency)}
                  value={betAmount}
                  onChange={e => setBetAmount(v => BC.normalizeBetInput(e.target.value, currency, v))}
                  className="w-full bg-casino-surface border border-casino-border rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-gold/50"
                />
                <div className="flex gap-1">
                  <button onClick={halfBet} className="flex-1 bg-casino-surface border border-casino-border rounded px-2 py-1 text-xs text-casino-muted hover:text-white">1/2</button>
                  <button onClick={doubleBet} className="flex-1 bg-casino-surface border border-casino-border rounded px-2 py-1 text-xs text-casino-muted hover:text-white">2x</button>
                  <button onClick={maxBet} className="flex-1 bg-casino-surface border border-casino-border rounded px-2 py-1 text-xs text-casino-muted hover:text-white">Max</button>
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-xs text-casino-muted font-mono uppercase tracking-widest">Currency</span>
                <select
                  value={currency}
                  onChange={e => setCurrency(e.target.value)}
                  className="w-full bg-casino-surface border border-casino-border rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-gold/50"
                >
                  {CURRENCIES.map(c => <option key={c} value={c}>{SHORT[c]}</option>)}
                </select>
              </div>
            </div>

            <button
              onClick={handleSpin}
              disabled={spinning}
              className="w-full py-3 rounded-xl font-black text-sm transition-all disabled:opacity-50 bg-gradient-to-r from-blue-500 via-fuchsia-500 to-yellow-400 text-black hover:shadow-lg hover:shadow-fuchsia-500/20"
            >
              {spinning ? "SPINNING..." : "SPIN"}
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

function Panel({ title, value, tone, align = "left" }) {
  const toneClass = tone === "gold"
    ? "border-yellow-400/30 from-yellow-500/15 to-orange-500/15 text-yellow-300"
    : "border-fuchsia-400/30 from-fuchsia-500/15 to-violet-500/15 text-fuchsia-300";

  return (
    <div className={`rounded-xl border bg-gradient-to-r ${toneClass} px-3 py-2 ${align === "right" ? "text-right" : "text-left"}`}>
      <p className="text-[10px] uppercase tracking-widest font-mono opacity-80">{title}</p>
      <p className="font-black text-lg">{value}</p>
    </div>
  );
}

function SideCard({ label, value, footer }) {
  return (
    <div className="rounded-xl border border-blue-500/35 bg-[#09112c] px-2 py-3 text-center flex flex-col justify-between">
      <div>
        <p className="text-[10px] uppercase tracking-widest text-blue-300/80 font-mono">{label}</p>
        <p className="text-2xl sm:text-3xl font-black text-fuchsia-300 mt-2">{value}</p>
      </div>
      <p className="text-[10px] text-casino-muted font-mono mt-3">{footer}</p>
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
