"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import Navbar from "@/components/Navbar";
import BetHistory from "@/components/BetHistory";
import { minesStart, minesReveal, minesCashout, getBalances, getMinesBetHistory } from "@/lib/api";
import * as BC from "@/lib/betConfig";

const CURRENCIES = ["USDT_POLYGON", "ETH_POLYGON", "USDT_TRON", "BTC"];

export default function MinesPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [currency, setCurrency]     = useState("USDT_POLYGON");
  const [betAmount, setBetAmount]   = useState("1");
  const [mineCount, setMineCount]   = useState(5);
  const [error, setError]           = useState("");
  const [balances, setBalances]     = useState({});
  const [history, setHistory]       = useState([]);
  const [historyPage, setHistoryPage] = useState(0);

  // Game state
  const [phase, setPhase]           = useState("betting"); // betting | playing | result
  const [gameId, setGameId]         = useState(null);
  const [grid, setGrid]             = useState(Array(25).fill("hidden")); // hidden | safe | mine
  const [minePositions, setMinePositions] = useState([]);
  const [currentMultiplier, setCurrentMultiplier] = useState(1);
  const [nextMultiplier, setNextMultiplier] = useState(null);
  const [currentPayout, setCurrentPayout] = useState(0);
  const [profit, setProfit]         = useState(null);
  const [busy, setBusy]             = useState(false);

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
      const data = await getMinesBetHistory(20, historyPage * 20);
      setHistory(prev => historyPage === 0 ? data.bets : [...prev, ...data.bets]);
    } catch {}
  }

  async function handleStart() {
    setError("");
    setBusy(true);
    setGrid(Array(25).fill("hidden"));
    setMinePositions([]);
    setCurrentMultiplier(1);
    setProfit(null);
    try {
      const data = await minesStart({
        currency,
        betAmount: parseFloat(betAmount),
        mineCount,
      });
      setGameId(data.gameId);
      setNextMultiplier(data.nextMultiplier);
      setBalances(prev => ({ ...prev, [currency]: data.balance }));
      setPhase("playing");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleReveal(tileIndex) {
    if (grid[tileIndex] !== "hidden" || busy) return;
    setError("");
    setBusy(true);
    try {
      const data = await minesReveal({ gameId, tileIndex });
      const newGrid = [...grid];

      if (data.isMine) {
        // Hit a mine — reveal all mines
        newGrid[tileIndex] = "mine";
        for (const pos of data.minePositions) {
          if (pos !== tileIndex) newGrid[pos] = "mine";
        }
        setGrid(newGrid);
        setMinePositions(data.minePositions);
        setProfit(data.profit);
        setPhase("result");
        setBalances(prev => ({ ...prev, [currency]: data.balance }));
        addToHistory({ won: false, payout: 0, profit: data.profit, multiplier: 0 });
      } else {
        newGrid[tileIndex] = "safe";
        setGrid(newGrid);
        setCurrentMultiplier(data.currentMultiplier);
        setCurrentPayout(data.currentPayout);
        setNextMultiplier(data.nextMultiplier);

        if (data.gameOver && data.autoWin) {
          setMinePositions(data.minePositions);
          for (const pos of data.minePositions) newGrid[pos] = "mine";
          setGrid(newGrid);
          setProfit(data.profit);
          setPhase("result");
          setBalances(prev => ({ ...prev, [currency]: data.balance }));
          addToHistory({ won: true, payout: data.payout, profit: data.profit, multiplier: data.currentMultiplier });
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCashout() {
    setError("");
    setBusy(true);
    try {
      const data = await minesCashout({ gameId });
      const newGrid = [...grid];
      for (const pos of data.minePositions) newGrid[pos] = "mine";
      setGrid(newGrid);
      setMinePositions(data.minePositions);
      setCurrentMultiplier(data.multiplier);
      setProfit(data.profit);
      setPhase("result");
      setBalances(prev => ({ ...prev, [currency]: data.balance }));
      addToHistory({ won: true, payout: data.payout, profit: data.profit, multiplier: data.multiplier });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function addToHistory(data) {
    setHistory(prev => [{
      id: Date.now(),
      game: "mines",
      currency,
      bet_amount: parseFloat(betAmount),
      payout: data.payout,
      profit: data.profit,
      won: data.won,
      multiplier: data.multiplier,
      created_at: new Date().toISOString(),
    }, ...prev]);
  }

  function newGame() {
    setPhase("betting");
    setGameId(null);
    setGrid(Array(25).fill("hidden"));
    setMinePositions([]);
    setCurrentMultiplier(1);
    setNextMultiplier(null);
    setCurrentPayout(0);
    setProfit(null);
  }

  useEffect(() => { BC.fetchPrices(); }, []);
  useEffect(() => { setBetAmount(BC.defaultBet(currency)); }, [currency]);
  function halfBet()   { setBetAmount(v => BC.halfBet(v, currency)); }
  function doubleBet() { setBetAmount(v => BC.doubleBet(v, currency)); }
  function maxBet()    { setBetAmount(BC.maxBetAmount(currency, balances[currency])); }

  if (authLoading) return <LoadingScreen />;

  const revealedCount = grid.filter(t => t === "safe").length;

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar balances={balances} activeCurrency={currency} onCurrencyChange={setCurrency} />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-3">

          {/* Mine Grid */}
          <div className="bg-casino-card border border-casino-border rounded-2xl p-4">
            {phase === "playing" && revealedCount > 0 && (
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm">
                  <span className="text-casino-muted">Multiplier: </span>
                  <span className="text-gold font-bold">{currentMultiplier}x</span>
                  <span className="text-casino-muted ml-3">Payout: </span>
                  <span className="text-green-400 font-mono">{currentPayout}</span>
                </div>
                {nextMultiplier && (
                  <span className="text-xs text-casino-muted">Next: {nextMultiplier}x</span>
                )}
              </div>
            )}

            <div className="grid grid-cols-5 gap-2 max-w-[320px] mx-auto">
              {grid.map((tile, i) => (
                <button
                  key={i}
                  onClick={() => phase === "playing" && handleReveal(i)}
                  disabled={phase !== "playing" || tile !== "hidden" || busy}
                  className={`aspect-square rounded-xl text-xl font-bold transition-all border-2 flex items-center justify-center ${
                    tile === "hidden"
                      ? phase === "playing"
                        ? "bg-casino-surface border-casino-border hover:bg-gold/10 hover:border-gold/30 cursor-pointer hover:scale-105"
                        : "bg-casino-surface border-casino-border opacity-60"
                      : tile === "safe"
                        ? "bg-green-600/20 border-green-500/40 scale-95"
                        : "bg-red-600/20 border-red-500/40 scale-95"
                  }`}
                >
                  {tile === "safe" && <span className="text-green-400">&#x2B50;</span>}
                  {tile === "mine" && <span className="text-red-400">&#x1F4A3;</span>}
                </button>
              ))}
            </div>

            {phase === "result" && profit !== null && (
              <div className="text-center mt-3">
                <p className={`text-lg font-bold ${profit >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {profit >= 0 ? `+${profit.toFixed(5)}` : profit.toFixed(5)}
                </p>
                {profit >= 0 && <p className="text-gold text-sm">{currentMultiplier}x</p>}
              </div>
            )}
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-3 py-2">
              {error}
            </div>
          )}

          {/* Controls */}
          <div className="bg-casino-card border border-casino-border rounded-2xl p-4 space-y-3">
            {phase === "betting" && (
              <>
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
                    <span className="text-xs text-casino-muted font-mono uppercase tracking-widest">Mines ({mineCount})</span>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setMineCount(m => Math.max(1, m - 1))}
                        className="w-8 h-8 bg-casino-surface border border-casino-border rounded-lg text-casino-muted hover:text-white text-lg flex items-center justify-center">-</button>
                      <input type="number" min={1} max={24} value={mineCount} onChange={e => {
                        const v = parseInt(e.target.value);
                        if (v >= 1 && v <= 24) setMineCount(v);
                      }}
                        className="flex-1 bg-casino-surface border border-casino-border rounded-lg px-3 py-1.5 text-white font-mono text-sm text-center focus:outline-none focus:border-gold/50" />
                      <button onClick={() => setMineCount(m => Math.min(24, m + 1))}
                        className="w-8 h-8 bg-casino-surface border border-casino-border rounded-lg text-casino-muted hover:text-white text-lg flex items-center justify-center">+</button>
                    </div>
                    <div className="flex gap-1">
                      {[1, 3, 5, 10, 24].map(n => (
                        <button key={n} onClick={() => setMineCount(n)}
                          className={`flex-1 py-0.5 rounded text-xs font-bold transition-all border ${
                            mineCount === n ? "bg-gold/20 border-gold/50 text-gold" : "bg-casino-surface border-casino-border text-casino-muted hover:text-white"
                          }`}>
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-casino-muted font-mono uppercase tracking-widest">Currency</span>
                  <select value={currency} onChange={e => setCurrency(e.target.value)}
                    className="w-full bg-casino-surface border border-casino-border rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-gold/50">
                    {CURRENCIES.map(c => <option key={c} value={c}>{c.replace("_", " ")}</option>)}
                  </select>
                </div>
                <button onClick={handleStart} disabled={busy}
                  className="w-full py-3 rounded-xl font-bold text-sm transition-all bg-gradient-to-r from-gold to-yellow-500 text-black hover:shadow-lg hover:shadow-gold/20 disabled:opacity-50 disabled:cursor-not-allowed">
                  {busy ? "Starting..." : "Start Game"}
                </button>
              </>
            )}

            {phase === "playing" && (
              <div className="flex gap-2">
                <button onClick={handleCashout} disabled={busy || revealedCount === 0}
                  className="flex-1 py-3 rounded-xl font-bold text-sm bg-green-600 hover:bg-green-500 text-white transition-all disabled:opacity-50">
                  {revealedCount > 0 ? `Cashout ${currentPayout}` : "Reveal a tile first"}
                </button>
              </div>
            )}

            {phase === "result" && (
              <button onClick={newGame}
                className="w-full py-3 rounded-xl font-bold text-sm transition-all bg-gradient-to-r from-gold to-yellow-500 text-black hover:shadow-lg hover:shadow-gold/20">
                New Game
              </button>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <BetHistory title="Mines History" bets={history} onLoadMore={() => setHistoryPage(p => p + 1)} />
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
