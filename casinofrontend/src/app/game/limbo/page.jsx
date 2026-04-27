"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import Navbar from "@/components/Navbar";
import BetHistory from "@/components/BetHistory";
import { placeLimboBet, getBalances, getLimboBetHistory } from "@/lib/api";
import * as BC from "@/lib/betConfig";

const CURRENCIES = ["USDT_POLYGON", "ETH_POLYGON", "USDT_TRON", "BTC"];

export default function LimboPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [currency, setCurrency]   = useState("USDT_POLYGON");
  const [betAmount, setBetAmount] = useState("1");
  const [target, setTarget]       = useState("2.00");
  const [rolling, setRolling]     = useState(false);
  const [result, setResult]       = useState(null);
  const [error, setError]         = useState("");
  const [balances, setBalances]   = useState({});
  const [history, setHistory]     = useState([]);
  const [historyPage, setHistoryPage] = useState(0);
  const [recentResults, setRecentResults] = useState([]);
  const animRef = useRef(null);
  const [displayNum, setDisplayNum] = useState(null);

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
      const data = await getLimboBetHistory(20, historyPage * 20);
      setHistory(prev => historyPage === 0 ? data.bets : [...prev, ...data.bets]);
    } catch {}
  }

  async function handleBet() {
    setError("");
    setRolling(true);
    setResult(null);
    setDisplayNum(null);

    try {
      const data = await placeLimboBet({
        currency,
        betAmount: parseFloat(betAmount),
        target: parseFloat(target),
      });
      const bet = data.bet;

      // Animate the number counting up
      const finalNum = bet.result;
      const steps = 20;
      let step = 0;
      const interval = setInterval(() => {
        step++;
        if (step < steps) {
          setDisplayNum((Math.random() * finalNum * 2).toFixed(2));
        } else {
          clearInterval(interval);
          setDisplayNum(finalNum.toFixed(2));
          setResult(bet);
          setRolling(false);
          setBalances(prev => ({ ...prev, [currency]: data.balance }));
          setRecentResults(prev => [{ result: finalNum, won: bet.won }, ...prev].slice(0, 20));
          setHistory(prev => [{
            id: bet.betId,
            game: "limbo",
            currency,
            roll: bet.result,
            bet_amount: bet.betAmount,
            payout: bet.payout,
            profit: bet.profit,
            won: bet.won,
            multiplier: bet.multiplier,
            created_at: new Date().toISOString(),
          }, ...prev]);
        }
      }, 30);
      animRef.current = interval;
    } catch (err) {
      setError(err.message);
      setRolling(false);
    }
  }

  useEffect(() => {
    return () => { if (animRef.current) clearInterval(animRef.current); };
  }, []);

  useEffect(() => { BC.fetchPrices(); }, []);
  useEffect(() => { setBetAmount(BC.defaultBet(currency)); }, [currency]);
  function halfBet()   { setBetAmount(v => BC.halfBet(v, currency)); }
  function doubleBet() { setBetAmount(v => BC.doubleBet(v, currency)); }
  function maxBet()    { setBetAmount(BC.maxBetAmount(currency, balances[currency])); }

  if (authLoading) return <LoadingScreen />;

  const winChance = (0.96 / parseFloat(target || 1) * 100).toFixed(2);

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar balances={balances} activeCurrency={currency} onCurrencyChange={setCurrency} />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-3">

          {/* Result Display */}
          <div className="bg-casino-card border border-casino-border rounded-2xl p-6 min-h-[140px] flex flex-col items-center justify-center relative overflow-hidden">
            <div className="absolute inset-0 opacity-5"
              style={{backgroundImage:"radial-gradient(circle at 50% 50%, var(--gold) 0%, transparent 70%)"}} />

            <div className="relative z-10 text-center">
              {displayNum !== null ? (
                <>
                  <p className={`text-5xl font-black font-mono transition-colors ${
                    result ? (result.won ? "text-green-400" : "text-red-400") : "text-white"
                  }`}>
                    {displayNum}x
                  </p>
                  {result && (
                    <p className={`text-sm font-mono mt-2 ${result.profit >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {result.profit >= 0 ? "+" : ""}{result.profit.toFixed(5)}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="text-5xl font-black text-casino-muted/40 font-mono">LIMBO</p>
                  <p className="text-casino-muted text-sm mt-1">Set target and roll</p>
                </>
              )}
            </div>
          </div>

          {/* Recent results strip */}
          {recentResults.length > 0 && (
            <div className="flex gap-1 overflow-x-auto pb-1">
              {recentResults.map((r, i) => (
                <div key={i} className={`px-2 py-1 rounded-lg text-xs font-bold font-mono shrink-0 ${
                  r.won ? "bg-green-600/20 text-green-400" : "bg-red-600/20 text-red-400"
                }`}>
                  {r.result.toFixed(2)}x
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-3 py-2">
              {error}
            </div>
          )}

          {/* Controls */}
          <div className="bg-casino-card border border-casino-border rounded-2xl p-4 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <span className="text-xs text-casino-muted font-mono uppercase tracking-widest">Target Multiplier</span>
                <input type="number" step="0.01" min="1.01" value={target} onChange={e => setTarget(e.target.value)}
                  className="w-full bg-casino-surface border border-casino-border rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-gold/50" />
                <div className="flex gap-1">
                  {[1.5, 2, 3, 5, 10, 100].map(t => (
                    <button key={t} onClick={() => setTarget(t.toFixed(2))}
                      className={`flex-1 text-xs px-1 py-0.5 rounded transition-all ${
                        parseFloat(target) === t ? "text-gold bg-gold/10" : "text-casino-muted hover:text-white bg-casino-surface border border-casino-border"
                      }`}>
                      {t}x
                    </button>
                  ))}
                </div>
              </div>
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
                <p className="text-xs text-casino-muted">Win: {winChance}%</p>
              </div>
            </div>

            <button onClick={handleBet} disabled={rolling}
              className="w-full py-3 rounded-xl font-bold text-sm transition-all bg-gradient-to-r from-gold to-yellow-500 text-black hover:shadow-lg hover:shadow-gold/20 disabled:opacity-50 disabled:cursor-not-allowed">
              {rolling ? "Rolling..." : "Roll"}
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <BetHistory title="Limbo History" bets={history} onLoadMore={() => setHistoryPage(p => p + 1)} />
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
