"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import Navbar from "@/components/Navbar";
import BetHistory from "@/components/BetHistory";
import { placePlinkoBet, getBalances, getPlinkoBetHistory } from "@/lib/api";
import * as BC from "@/lib/betConfig";

const CURRENCIES = ["USDT_POLYGON", "ETH_POLYGON", "USDT_TRON", "BTC"];

const MULTIPLIERS = {
  8: {
    low:    [5.6, 2.1, 1.1, 1.0, 0.5, 1.0, 1.1, 2.1, 5.6],
    medium: [13,  3.0, 1.3, 0.7, 0.4, 0.7, 1.3, 3.0, 13],
    high:   [29,  4.0, 1.5, 0.3, 0.2, 0.3, 1.5, 4.0, 29],
  },
  12: {
    low:    [10,  3.0, 1.6, 1.4, 1.1, 1.0, 0.5, 1.0, 1.1, 1.4, 1.6, 3.0, 10],
    medium: [33,  11,  4.0, 2.0, 1.1, 0.6, 0.3, 0.6, 1.1, 2.0, 4.0, 11,  33],
    high:   [170, 24,  8.1, 2.0, 0.7, 0.2, 0.2, 0.2, 0.7, 2.0, 8.1, 24,  170],
  },
  16: {
    low:    [16,  9.0, 2.0, 1.4, 1.4, 1.2, 1.1, 1.0, 0.5, 1.0, 1.1, 1.2, 1.4, 1.4, 2.0, 9.0, 16],
    medium: [110, 41,  10,  5.0, 3.0, 1.5, 1.0, 0.5, 0.3, 0.5, 1.0, 1.5, 3.0, 5.0, 10,  41,  110],
    high:   [1000,130, 26,  9.0, 4.0, 2.0, 0.2, 0.2, 0.2, 0.2, 0.2, 2.0, 4.0, 9.0, 26,  130, 1000],
  },
};

function PlinkoBoard({ rows, path, bucket, risk, animating }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const trailRef = useRef([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;
    const pegRadius = 3;
    const pegSpacingY = (H - 55) / rows;
    const multipliers = MULTIPLIERS[rows]?.[risk] || [];

    function getPegX(row, col) {
      const cols = row + 1;
      const totalWidth = cols * 22;
      const startX = (W - totalWidth) / 2 + 11;
      return startX + col * 22;
    }

    function drawBoard(ballRow, ballCol, hitPeg) {
      ctx.clearRect(0, 0, W, H);

      // Background gradient
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "rgba(15, 23, 42, 0.3)");
      bg.addColorStop(1, "rgba(15, 23, 42, 0.6)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Draw trail
      for (let t = 0; t < trailRef.current.length; t++) {
        const trail = trailRef.current[t];
        const alpha = (t / trailRef.current.length) * 0.4;
        ctx.beginPath();
        ctx.arc(trail.x, trail.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(234, 179, 8, ${alpha})`;
        ctx.fill();
      }

      // Draw pegs with glow
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c <= r; c++) {
          const x = getPegX(r, c);
          const y = 30 + r * pegSpacingY;
          const isHit = hitPeg && hitPeg.row === r && hitPeg.col === c;

          if (isHit) {
            // Glow effect on hit peg
            ctx.beginPath();
            ctx.arc(x, y, 8, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(234, 179, 8, 0.3)";
            ctx.fill();
          }

          ctx.beginPath();
          ctx.arc(x, y, pegRadius, 0, Math.PI * 2);
          const gradient = ctx.createRadialGradient(x - 1, y - 1, 0, x, y, pegRadius);
          gradient.addColorStop(0, isHit ? "#fbbf24" : "#94a3b8");
          gradient.addColorStop(1, isHit ? "#d97706" : "#475569");
          ctx.fillStyle = gradient;
          ctx.fill();
        }
      }

      // Draw buckets with gradients
      const bucketCount = rows + 1;
      const bucketW = W / bucketCount;
      for (let i = 0; i < bucketCount; i++) {
        const x = i * bucketW;
        const y = H - 26;
        const m = multipliers[i] || 0;
        const isHit = bucket === i && !animating;

        // Bucket gradient
        const bucketGrad = ctx.createLinearGradient(x, y, x, y + 24);
        if (isHit) {
          bucketGrad.addColorStop(0, "rgba(234, 179, 8, 0.8)");
          bucketGrad.addColorStop(1, "rgba(234, 179, 8, 0.4)");
        } else if (m >= 5) {
          bucketGrad.addColorStop(0, "rgba(34, 197, 94, 0.4)");
          bucketGrad.addColorStop(1, "rgba(34, 197, 94, 0.15)");
        } else if (m >= 1) {
          bucketGrad.addColorStop(0, "rgba(59, 130, 246, 0.3)");
          bucketGrad.addColorStop(1, "rgba(59, 130, 246, 0.1)");
        } else {
          bucketGrad.addColorStop(0, "rgba(239, 68, 68, 0.3)");
          bucketGrad.addColorStop(1, "rgba(239, 68, 68, 0.1)");
        }

        // Rounded bucket
        const bx = x + 1.5, by = y, bw = bucketW - 3, bh = 24, br = 4;
        ctx.beginPath();
        ctx.moveTo(bx + br, by);
        ctx.lineTo(bx + bw - br, by);
        ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + br);
        ctx.lineTo(bx + bw, by + bh - br);
        ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - br, by + bh);
        ctx.lineTo(bx + br, by + bh);
        ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - br);
        ctx.lineTo(bx, by + br);
        ctx.quadraticCurveTo(bx, by, bx + br, by);
        ctx.closePath();
        ctx.fillStyle = bucketGrad;
        ctx.fill();

        ctx.fillStyle = isHit ? "#000" : m >= 5 ? "#4ade80" : m >= 1 ? "#93c5fd" : "#f87171";
        ctx.font = `bold ${bucketW > 25 ? 10 : 8}px monospace`;
        ctx.textAlign = "center";
        ctx.fillText(`${m}x`, x + bucketW / 2, y + 16);
      }

      // Draw ball with glow
      if (ballRow !== null && ballRow !== undefined) {
        let bx, by;
        if (ballRow < rows) {
          bx = getPegX(ballRow, ballCol);
          by = 30 + ballRow * pegSpacingY;
        } else {
          const bucketW2 = W / (rows + 1);
          bx = ballCol * bucketW2 + bucketW2 / 2;
          by = H - 38;
        }

        // Glow
        ctx.beginPath();
        ctx.arc(bx, by, 12, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(234, 179, 8, 0.15)";
        ctx.fill();

        // Ball
        const ballGrad = ctx.createRadialGradient(bx - 2, by - 2, 0, bx, by, 7);
        ballGrad.addColorStop(0, "#fef08a");
        ballGrad.addColorStop(0.5, "#eab308");
        ballGrad.addColorStop(1, "#a16207");
        ctx.beginPath();
        ctx.arc(bx, by, 7, 0, Math.PI * 2);
        ctx.fillStyle = ballGrad;
        ctx.fill();

        // Add to trail
        trailRef.current.push({ x: bx, y: by });
        if (trailRef.current.length > 12) trailRef.current.shift();
      }
    }

    trailRef.current = [];

    if (animating && path && path.length > 0) {
      let step = 0;
      let col = 0;
      let hitPeg = null;
      function animate() {
        if (step <= rows) {
          hitPeg = step < rows ? { row: step, col } : null;
          drawBoard(step, col, hitPeg);
          if (step < rows) col += path[step];
          step++;
          animRef.current = requestAnimationFrame(() => setTimeout(animate, 90));
        } else {
          drawBoard(rows, bucket, null);
        }
      }
      animate();
    } else {
      drawBoard(path ? rows : null, bucket, null);
    }

    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [rows, path, bucket, risk, animating]);

  return (
    <canvas
      ref={canvasRef}
      width={Math.max(220, (rows + 2) * 24)}
      height={Math.min(rows * 22 + 60, 300)}
      className="mx-auto rounded-lg"
    />
  );
}

export default function PlinkoPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [currency, setCurrency]   = useState("USDT_POLYGON");
  const [betAmount, setBetAmount] = useState("1");
  const [rows, setRows]           = useState(12);
  const [risk, setRisk]           = useState("medium");
  const [dropping, setDropping]   = useState(false);
  const [result, setResult]       = useState(null);
  const [path, setPath]           = useState(null);
  const [bucket, setBucket]       = useState(null);
  const [animating, setAnimating] = useState(false);
  const [error, setError]         = useState("");
  const [balances, setBalances]   = useState({});
  const [history, setHistory]     = useState([]);
  const [historyPage, setHistoryPage] = useState(0);
  const [lastMultiplier, setLastMultiplier] = useState(null);

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
      const data = await getPlinkoBetHistory(20, historyPage * 20);
      setHistory(prev => historyPage === 0 ? data.bets : [...prev, ...data.bets]);
    } catch {}
  }

  async function handleDrop() {
    setError("");
    setDropping(true);
    setResult(null);
    setPath(null);
    setBucket(null);
    setAnimating(false);
    setLastMultiplier(null);
    try {
      const data = await placePlinkoBet({
        currency,
        betAmount: parseFloat(betAmount),
        rows,
        risk,
      });
      const bet = data.bet;
      setResult(bet);
      setPath(bet.path);
      setBucket(bet.bucket);
      setAnimating(true);
      setBalances(prev => ({ ...prev, [currency]: data.balance }));
      setHistory(prev => [{
        id: bet.betId,
        game: "plinko",
        currency,
        bet_amount: bet.betAmount,
        payout: bet.payout,
        profit: bet.profit,
        won: bet.won,
        multiplier: bet.multiplier,
        created_at: new Date().toISOString(),
      }, ...prev]);

      setTimeout(() => {
        setAnimating(false);
        setDropping(false);
        setLastMultiplier(bet.multiplier);
      }, (rows + 2) * 110);
    } catch (err) {
      setError(err.message);
      setDropping(false);
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
        <div className="lg:col-span-2 space-y-3">

          <div className="bg-casino-card border border-casino-border rounded-2xl p-3 space-y-2 relative overflow-hidden">
            <div className="absolute inset-0 opacity-5"
              style={{backgroundImage:"radial-gradient(circle at 50% 50%, var(--gold) 0%, transparent 70%)"}} />

            <div className="relative z-10 w-full flex flex-col items-center">
              <PlinkoBoard rows={rows} path={path} bucket={bucket} risk={risk} animating={animating} />

              {result && !animating && (
                <div className={`text-center mt-2 transition-all duration-500 ${lastMultiplier ? "scale-110" : ""}`}>
                  <span className={`text-xl font-black ${result.multiplier >= 2 ? "text-gold" : result.multiplier >= 1 ? "text-blue-400" : "text-red-400"}`}>
                    {result.multiplier}x
                  </span>
                  <span className={`ml-2 text-sm font-mono ${result.profit >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {result.profit >= 0 ? "+" : ""}{result.profit.toFixed(5)}
                  </span>
                </div>
              )}
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-3 py-1.5 relative z-10">{error}</div>
            )}

            <div className="grid grid-cols-2 gap-2 relative z-10">
              <div className="space-y-1">
                <span className="text-xs text-casino-muted font-mono uppercase tracking-widest">Rows</span>
                <div className="flex gap-1">
                  {[8, 12, 16].map(r => (
                    <button key={r} onClick={() => setRows(r)} disabled={dropping}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                        rows === r ? "bg-gold/20 border-gold/50 text-gold" : "bg-casino-surface border-casino-border text-casino-muted hover:text-white"
                      } disabled:opacity-50`}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-casino-muted font-mono uppercase tracking-widest">Risk</span>
                <div className="flex gap-1">
                  {["low", "medium", "high"].map(r => (
                    <button key={r} onClick={() => setRisk(r)} disabled={dropping}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all border capitalize ${
                        risk === r ? "bg-gold/20 border-gold/50 text-gold" : "bg-casino-surface border-casino-border text-casino-muted hover:text-white"
                      } disabled:opacity-50`}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 relative z-10">
              <div className="space-y-1">
                <span className="text-xs text-casino-muted font-mono uppercase tracking-widest">Bet</span>
                <input type="number" min={BC.minBet(currency)} step={BC.stepSize(currency)} value={betAmount} onChange={e => setBetAmount(e.target.value)}
                  className="w-full bg-casino-surface border border-casino-border rounded-lg px-2 py-1.5 text-white font-mono text-sm focus:outline-none focus:border-gold/50" />
                <div className="flex gap-1">
                  <button onClick={halfBet} className="flex-1 bg-casino-surface border border-casino-border rounded px-1 py-0.5 text-xs text-casino-muted hover:text-white transition-colors">1/2</button>
                  <button onClick={doubleBet} className="flex-1 bg-casino-surface border border-casino-border rounded px-1 py-0.5 text-xs text-casino-muted hover:text-white transition-colors">2x</button>
                  <button onClick={maxBet} className="flex-1 bg-casino-surface border border-casino-border rounded px-1 py-0.5 text-xs text-casino-muted hover:text-white transition-colors">Max</button>
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-casino-muted font-mono uppercase tracking-widest">Currency</span>
                <select value={currency} onChange={e => setCurrency(e.target.value)}
                  className="w-full bg-casino-surface border border-casino-border rounded-lg px-2 py-1.5 text-white font-mono text-sm focus:outline-none focus:border-gold/50">
                  {CURRENCIES.map(c => <option key={c} value={c}>{c.replace("_", " ")}</option>)}
                </select>
              </div>
            </div>

            <button onClick={handleDrop} disabled={dropping}
              className="w-full py-2.5 rounded-xl font-bold text-sm transition-all bg-gradient-to-r from-gold to-yellow-500 text-black hover:shadow-lg hover:shadow-gold/20 disabled:opacity-50 disabled:cursor-not-allowed relative z-10">
              {dropping ? "Dropping..." : "Drop Ball"}
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <BetHistory title="Plinko History" bets={history} onLoadMore={() => setHistoryPage(p => p + 1)} />
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
