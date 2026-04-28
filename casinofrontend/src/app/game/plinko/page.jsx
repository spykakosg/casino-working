"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import Navbar from "@/components/Navbar";
import { placePlinkoBet, getBalances, getPlinkoBetHistory } from "@/lib/api";
import * as BC from "@/lib/betConfig";

const CURRENCIES = ["USDT_POLYGON", "ETH_POLYGON", "USDT_TRON", "BTC"];
const CURRENCY_LABEL = {
  USDT_POLYGON: "USDT POLYGON",
  ETH_POLYGON: "ETH POLYGON",
  USDT_TRON: "USDT TRON",
  BTC: "BTC",
};

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
    <div className="min-h-screen flex flex-col plk-page">
      <Navbar balances={balances} activeCurrency={currency} onCurrencyChange={setCurrency} />
      <main className="plk-shell">
        <aside className="plk-panel plk-left">
          <div className="plk-brand">
            <div className="plk-logo-gem">♦</div>
            <div><h2>CRYPTO</h2><p>CASINO</p></div>
          </div>

          <div className="plk-group">
            <label>BET AMOUNT</label>
            <input type="number" min={BC.minBet(currency)} step={BC.stepSize(currency)} value={betAmount} onChange={e => setBetAmount(e.target.value)} />
            <div className="plk-actions">
              <button onClick={halfBet}>1/2</button>
              <button onClick={doubleBet}>2X</button>
              <button onClick={maxBet}>MAX</button>
            </div>
          </div>

          <div className="plk-group">
            <label>RISK LEVEL</label>
            <div className="plk-actions">
              {["low", "medium", "high"].map(r => (
                <button key={r} onClick={() => setRisk(r)} className={risk === r ? "active" : ""}>{r.toUpperCase()}</button>
              ))}
            </div>
          </div>

          <div className="plk-group">
            <label>ROWS</label>
            <div className="plk-actions">
              {[8, 12, 16].map(r => (
                <button key={r} onClick={() => setRows(r)} className={rows === r ? "active" : ""}>{r}</button>
              ))}
            </div>
          </div>

          <div className="plk-group">
            <label>CURRENCY</label>
            <select value={currency} onChange={e => setCurrency(e.target.value)}>
              {CURRENCIES.map(c => <option key={c} value={c}>{CURRENCY_LABEL[c]}</option>)}
            </select>
          </div>

          <button onClick={handleDrop} disabled={dropping} className="plk-drop">{dropping ? "DROPPING..." : "DROP"}</button>
          {error && <div className="plk-error">{error}</div>}
          <div className="plk-balance">BALANCE: {Number(balances[currency] || 0).toFixed(6)}</div>
        </aside>

        <section className="plk-center">
          <div className="plk-title">PLINKO</div>
          <div className="plk-sub">DROP. BOUNCE. WIN BIG.</div>
          <div className="plk-boardWrap">
            <PlinkoBoard rows={rows} path={path} bucket={bucket} risk={risk} animating={animating} />
            {result && !animating && (
              <div className="plk-result">
                <span>{result.multiplier}x</span>
                <small>{result.profit >= 0 ? "+" : ""}{result.profit.toFixed(5)}</small>
              </div>
            )}
          </div>
          <div className="plk-buckets">
            {(MULTIPLIERS[rows]?.[risk] || []).map((m, i) => (
              <div key={`${m}-${i}`} className={bucket === i && !animating ? "hit" : ""}>{m}x</div>
            ))}
          </div>
        </section>

        <aside className="plk-panel plk-right">
          <h3>RECENT WINS</h3>
          <div className="plk-wins">
            {history.slice(0, 8).map((h) => (
              <div key={h.id || `${h.created_at}-${h.multiplier}`} className="plk-winRow">
                <span>{Number(h.bet_amount || 0).toFixed(6)}</span>
                <b>{h.multiplier}x</b>
              </div>
            ))}
          </div>
          <div className="plk-promo">BOUNCE TO THE MOON</div>
          <button className="plk-load" onClick={() => setHistoryPage(p => p + 1)}>LOAD MORE</button>
        </aside>
      </main>

      <style jsx>{`
        .plk-page{background:
          radial-gradient(circle at 50% 0%, rgba(73,29,255,.35), transparent 35%),
          linear-gradient(180deg,#06091f,#0a0423 50%,#090f2d)}
        .plk-shell{width:min(1800px,100%);margin:0 auto;display:grid;grid-template-columns:320px 1fr 320px;gap:14px;padding:14px}
        .plk-panel{background:linear-gradient(180deg,rgba(8,16,56,.82),rgba(5,8,29,.9));border:2px solid rgba(87,122,255,.6);border-radius:20px;padding:16px;box-shadow:0 0 35px rgba(76,35,255,.28)}
        .plk-brand{display:flex;align-items:center;gap:12px;padding-bottom:12px;border-bottom:1px solid rgba(130,150,255,.25);margin-bottom:12px}
        .plk-logo-gem{width:40px;height:40px;display:grid;place-items:center;border-radius:50%;background:radial-gradient(circle,#cb9bff,#6f28ff);font-size:22px}
        .plk-brand h2{font-size:30px;font-weight:900;background:linear-gradient(#9cd2ff,#5d7aff);-webkit-background-clip:text;color:transparent;line-height:1}
        .plk-brand p{color:#d26dff;font-weight:800}
        .plk-group{margin-bottom:12px}.plk-group label{display:block;color:#c8d1ff;font-weight:800;font-size:12px;margin-bottom:6px}
        .plk-group input,.plk-group select{width:100%;background:rgba(8,13,40,.8);border:1px solid rgba(114,132,255,.45);color:#fff;border-radius:10px;padding:10px;font-weight:700}
        .plk-actions{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px}
        .plk-actions button{border:1px solid rgba(140,98,255,.6);background:linear-gradient(#1d1145,#0d1234);color:#d5beff;padding:8px;border-radius:10px;font-weight:900}
        .plk-actions button.active{color:#ffd83b;border-color:#ffbb3b;box-shadow:0 0 16px rgba(255,181,47,.4)}
        .plk-drop{width:100%;margin-top:8px;padding:14px;border:none;border-radius:14px;font-size:38px;font-weight:900;letter-spacing:.05em;color:white;background:linear-gradient(180deg,#8a3bff,#4b19ce);box-shadow:0 0 26px rgba(158,81,255,.65)}
        .plk-error{margin-top:8px;color:#ff9ea8;font-size:12px}.plk-balance{margin-top:12px;color:#7deef8;font-weight:700}
        .plk-center{position:relative;padding:10px 10px 20px;border:2px solid rgba(100,136,255,.54);border-radius:24px;background:linear-gradient(180deg,rgba(8,12,40,.5),rgba(10,8,35,.4)),url('/assets/plinko/bg.jpg');background-size:cover}
        .plk-title{text-align:center;font-size:clamp(48px,7vw,120px);font-weight:900;line-height:.9;letter-spacing:.05em;background:linear-gradient(#95f6ff,#6ea3ff 45%,#da64ff);-webkit-background-clip:text;color:transparent;text-shadow:0 0 24px rgba(120,217,255,.45)}
        .plk-sub{text-align:center;margin-top:4px;color:#d4dcff;font-weight:800;letter-spacing:.08em}
        .plk-boardWrap{position:relative;margin-top:10px;padding:18px;border-radius:20px;border:2px solid rgba(136,101,255,.55);background:radial-gradient(circle at 50% 20%,rgba(87,36,157,.28),rgba(5,7,24,.82))}
        .plk-boardWrap :global(canvas){width:min(860px,100%);height:auto;display:block;margin:0 auto;filter:drop-shadow(0 0 24px rgba(159,94,255,.4))}
        .plk-result{position:absolute;left:50%;top:12px;transform:translateX(-50%);text-align:center;color:#ffd64a;text-shadow:0 0 16px rgba(255,197,64,.8)}
        .plk-result span{font-size:40px;font-weight:900;display:block}.plk-result small{font-size:16px;color:#73ffd1;font-weight:700}
        .plk-buckets{margin-top:10px;display:grid;grid-template-columns:repeat(auto-fit,minmax(58px,1fr));gap:6px}
        .plk-buckets div{padding:10px 0;border-radius:10px;text-align:center;font-weight:900;color:#7deeff;background:linear-gradient(180deg,rgba(22,55,145,.85),rgba(7,22,61,.8));border:1px solid rgba(91,179,255,.5)}
        .plk-buckets div.hit{color:#201100;background:linear-gradient(180deg,#ffe26e,#ff991c);box-shadow:0 0 20px rgba(255,191,55,.8)}
        .plk-right h3{color:#e2ebff;font-size:38px;font-weight:900;letter-spacing:.04em}
        .plk-wins{margin-top:10px;display:grid;gap:8px}
        .plk-winRow{display:flex;justify-content:space-between;padding:10px 12px;border-radius:10px;background:rgba(8,13,44,.7);border:1px solid rgba(99,141,255,.35);font-family:monospace;color:#d5e0ff}
        .plk-winRow b{color:#ffd146}
        .plk-promo{margin-top:12px;min-height:140px;display:grid;place-items:center;border-radius:16px;border:1px solid rgba(128,84,255,.45);background:linear-gradient(180deg,rgba(23,34,102,.5),rgba(11,7,43,.6)),url('/assets/plinko/promo.png');background-size:cover;color:#93d7ff;font-size:30px;font-weight:900;text-align:center}
        .plk-load{margin-top:10px;width:100%;padding:10px;border-radius:10px;border:1px solid rgba(121,156,255,.55);background:rgba(13,20,61,.72);color:#dbe4ff;font-weight:700}
        @media (max-width:1200px){.plk-shell{grid-template-columns:1fr}.plk-right h3{font-size:26px}}
      `}</style>
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
