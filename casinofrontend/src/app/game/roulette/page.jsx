"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import Navbar from "@/components/Navbar";
import BetHistory from "@/components/BetHistory";
import { placeRouletteBet, getBalances, getRouletteBetHistory } from "@/lib/api";
import * as BC from "@/lib/betConfig";

const CURRENCIES = ["USDT_POLYGON", "ETH_POLYGON", "USDT_TRON", "BTC"];
const RED_NUMBERS = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
const WHEEL_ORDER = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];

function getColor(n) {
  if (n === 0) return "green";
  return RED_NUMBERS.includes(n) ? "red" : "black";
}

function RouletteWheel({ spinning, resultNumber, spinKey }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const rotRef = useRef(0);
  const ballAngleRef = useRef(0);
  const phaseRef = useRef("idle"); // idle | spinning | landing

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const size = canvas.width;
    const cx = size / 2;
    const cy = size / 2;
    const outerR = size / 2 - 4;
    const innerR = outerR * 0.65;
    const ballR = outerR * 0.85;
    const sliceAngle = (2 * Math.PI) / WHEEL_ORDER.length;

    function draw(wheelRot, ballAng, showBall) {
      ctx.clearRect(0, 0, size, size);

      // Outer ring
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
      const outerGrad = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
      outerGrad.addColorStop(0, "#1a1a2e");
      outerGrad.addColorStop(1, "#0d0d1a");
      ctx.fillStyle = outerGrad;
      ctx.fill();

      // Gold border
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(234, 179, 8, 0.6)";
      ctx.lineWidth = 3;
      ctx.stroke();

      // Number slices
      for (let i = 0; i < WHEEL_ORDER.length; i++) {
        const n = WHEEL_ORDER[i];
        const startA = wheelRot + i * sliceAngle - Math.PI / 2;
        const endA = startA + sliceAngle;

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, outerR - 3, startA, endA);
        ctx.closePath();

        const c = getColor(n);
        ctx.fillStyle = c === "green" ? "#16a34a" : c === "red" ? "#dc2626" : "#1f2937";
        ctx.fill();

        ctx.strokeStyle = "rgba(255,255,255,0.1)";
        ctx.lineWidth = 0.5;
        ctx.stroke();

        // Number text
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(startA + sliceAngle / 2);
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.font = "bold 8px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(String(n), outerR * 0.82, 3);
        ctx.restore();
      }

      // Inner circle (hub)
      ctx.beginPath();
      ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
      const hubGrad = ctx.createRadialGradient(cx - 5, cy - 5, 0, cx, cy, innerR);
      hubGrad.addColorStop(0, "#2a2a4a");
      hubGrad.addColorStop(1, "#111128");
      ctx.fillStyle = hubGrad;
      ctx.fill();
      ctx.strokeStyle = "rgba(234, 179, 8, 0.3)";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Ball
      if (showBall) {
        const bx = cx + Math.cos(ballAng) * ballR;
        const by = cy + Math.sin(ballAng) * ballR;

        // Ball glow
        ctx.beginPath();
        ctx.arc(bx, by, 6, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
        ctx.fill();

        // Ball
        const ballGrad = ctx.createRadialGradient(bx - 1, by - 1, 0, bx, by, 4);
        ballGrad.addColorStop(0, "#ffffff");
        ballGrad.addColorStop(0.5, "#e0e0e0");
        ballGrad.addColorStop(1, "#a0a0a0");
        ctx.beginPath();
        ctx.arc(bx, by, 4, 0, Math.PI * 2);
        ctx.fillStyle = ballGrad;
        ctx.fill();
      }


    }

    // Initial draw
    draw(rotRef.current, 0, false);

    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, []);

  // Handle spin animation
  useEffect(() => {
    if (!spinning && phaseRef.current === "idle" && !resultNumber) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const size = canvas.width;
    const cx = size / 2;
    const cy = size / 2;
    const outerR = size / 2 - 4;
    const innerR = outerR * 0.65;
    const ballR = outerR * 0.85;
    const sliceAngle = (2 * Math.PI) / WHEEL_ORDER.length;

    if (animRef.current) cancelAnimationFrame(animRef.current);

    if (spinning) {
      phaseRef.current = "spinning";
      let wheelSpeed = 0.08;
      let ballSpeed = -0.12;
      const startTime = Date.now();

      function spinLoop() {
        rotRef.current += wheelSpeed;
        ballAngleRef.current += ballSpeed;

        drawFull(ctx, size, cx, cy, outerR, innerR, ballR, sliceAngle, rotRef.current, ballAngleRef.current, true);
        animRef.current = requestAnimationFrame(spinLoop);
      }
      spinLoop();
    } else if (resultNumber !== null && phaseRef.current === "spinning") {
      phaseRef.current = "landing";
      const resultIdx = WHEEL_ORDER.indexOf(resultNumber);
      // Target: winning number at top (12 o'clock = -π/2 in canvas coords)
      // Slice i center is at: wheelRot + i*sliceAngle - π/2 + sliceAngle/2
      // For that to equal -π/2: wheelRot = -(i*sliceAngle + sliceAngle/2)
      const targetWheelAngle = -(resultIdx * sliceAngle + sliceAngle / 2);

      const currentNorm = ((rotRef.current % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const targetNorm = ((targetWheelAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      let delta = targetNorm - currentNorm;
      if (delta < 0) delta += Math.PI * 2;
      const totalSpin = Math.PI * 2 * 5 + delta;
      const startRot = rotRef.current;
      const startBall = ballAngleRef.current;
      // Ball lands at top where the winning number will be
      const targetBall = -Math.PI / 2;

      const duration = 3000;
      const startTime = Date.now();

      function landLoop() {
        const elapsed = Date.now() - startTime;
        const t = Math.min(elapsed / duration, 1);
        // Ease-out cubic
        const ease = 1 - Math.pow(1 - t, 3);

        rotRef.current = startRot + totalSpin * ease;
        // Ball decelerates and lands in the pocket
        ballAngleRef.current = startBall + (targetBall - startBall + Math.PI * 2 * 3) * ease;

        drawFull(ctx, size, cx, cy, outerR, innerR, ballR, sliceAngle, rotRef.current, ballAngleRef.current, true);

        if (t < 1) {
          animRef.current = requestAnimationFrame(landLoop);
        } else {
          phaseRef.current = "idle";
        }
      }
      landLoop();
    }

    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [spinning, resultNumber, spinKey]);

  return (
    <canvas ref={canvasRef} width={200} height={200} className="mx-auto" />
  );
}

function drawFull(ctx, size, cx, cy, outerR, innerR, ballR, sliceAngle, wheelRot, ballAng, showBall) {
  ctx.clearRect(0, 0, size, size);

  // Outer ring
  ctx.beginPath();
  ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
  const outerGrad = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
  outerGrad.addColorStop(0, "#1a1a2e");
  outerGrad.addColorStop(1, "#0d0d1a");
  ctx.fillStyle = outerGrad;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(234, 179, 8, 0.6)";
  ctx.lineWidth = 3;
  ctx.stroke();

  for (let i = 0; i < WHEEL_ORDER.length; i++) {
    const n = WHEEL_ORDER[i];
    const startA = wheelRot + i * sliceAngle - Math.PI / 2;
    const endA = startA + sliceAngle;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, outerR - 3, startA, endA);
    ctx.closePath();

    const c = getColor(n);
    ctx.fillStyle = c === "green" ? "#16a34a" : c === "red" ? "#dc2626" : "#1f2937";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 0.5;
    ctx.stroke();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(startA + sliceAngle / 2);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "bold 8px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(String(n), outerR * 0.82, 3);
    ctx.restore();
  }

  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
  const hubGrad = ctx.createRadialGradient(cx - 5, cy - 5, 0, cx, cy, innerR);
  hubGrad.addColorStop(0, "#2a2a4a");
  hubGrad.addColorStop(1, "#111128");
  ctx.fillStyle = hubGrad;
  ctx.fill();
  ctx.strokeStyle = "rgba(234, 179, 8, 0.3)";
  ctx.lineWidth = 2;
  ctx.stroke();

  if (showBall) {
    const bx = cx + Math.cos(ballAng) * ballR;
    const by = cy + Math.sin(ballAng) * ballR;
    ctx.beginPath();
    ctx.arc(bx, by, 6, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
    ctx.fill();
    const ballGrad = ctx.createRadialGradient(bx - 1, by - 1, 0, bx, by, 4);
    ballGrad.addColorStop(0, "#ffffff");
    ballGrad.addColorStop(0.5, "#e0e0e0");
    ballGrad.addColorStop(1, "#a0a0a0");
    ctx.beginPath();
    ctx.arc(bx, by, 4, 0, Math.PI * 2);
    ctx.fillStyle = ballGrad;
    ctx.fill();
  }

}

// Table layout: numbers arranged 3 rows x 12 columns (standard roulette table)
const TABLE_ROWS = [
  [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36],
  [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35],
  [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34],
];

function getCornerNumbers(row, col) {
  const tl = TABLE_ROWS[row]?.[col];
  const tr = TABLE_ROWS[row]?.[col + 1];
  const bl = TABLE_ROWS[row + 1]?.[col];
  const br = TABLE_ROWS[row + 1]?.[col + 1];
  if (tl && tr && bl && br) return [tl, tr, bl, br];
  return null;
}

export default function RoulettePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [currency, setCurrency]   = useState("USDT_POLYGON");
  const [betAmount, setBetAmount] = useState("1");
  const [betType, setBetType]     = useState(null);
  const [betValue, setBetValue]   = useState(null);
  const [spinning, setSpinning]   = useState(false);
  const [result, setResult]       = useState(null);
  const [resultNumber, setResultNumber] = useState(null);
  const [error, setError]         = useState("");
  const [balances, setBalances]   = useState({});
  const [history, setHistory]     = useState([]);
  const [historyPage, setHistoryPage] = useState(0);
  const [spinKey, setSpinKey]     = useState(0);
  const [roundActive, setRoundActive] = useState(false);

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
      const data = await getRouletteBetHistory(20, historyPage * 20);
      setHistory(prev => historyPage === 0 ? data.bets : [...prev, ...data.bets]);
    } catch {}
  }

  async function handleSpin() {
    if (!betType) { setError("Select a bet first"); return; }
    setError("");
    setSpinning(true);
    setRoundActive(true);
    setResult(null);
    setResultNumber(null);
    setSpinKey(k => k + 1);
    try {
      const data = await placeRouletteBet({
        currency,
        betAmount: parseFloat(betAmount),
        betType,
        betValue: betValue !== null ? betValue : undefined,
      });

      // Let wheel spin for 3s then land
      setTimeout(() => {
        setResultNumber(data.bet.result);
        setSpinning(false);
      }, 2500);

      setTimeout(() => {
        setResult(data.bet);
        setRoundActive(false);
        setBalances(prev => ({ ...prev, [currency]: data.balance }));
        setHistory(prev => [{
          id: data.bet.betId,
          game: "roulette",
          currency,
          roll: data.bet.result,
          bet_amount: data.bet.betAmount,
          payout: data.bet.payout,
          profit: data.bet.profit,
          won: data.bet.won,
          multiplier: data.bet.multiplier,
          created_at: new Date().toISOString(),
        }, ...prev]);
      }, 5800);
    } catch (err) {
      setError(err.message);
      setSpinning(false);
      setRoundActive(false);
    }
  }

  function selectStraight(num) {
    if (betType === "straight" && parseInt(betValue) === num) {
      setBetType(null); setBetValue(null);
    } else {
      setBetType("straight"); setBetValue(num);
    }
  }

  function selectCorner(nums) {
    const val = nums.join(",");
    if (betType === "corner" && betValue === val) {
      setBetType(null); setBetValue(null);
    } else {
      setBetType("corner"); setBetValue(val);
    }
  }

  function selectOutsideBet(type) {
    if (betType === type) {
      setBetType(null); setBetValue(null);
    } else {
      setBetType(type); setBetValue(null);
    }
  }

  useEffect(() => { BC.fetchPrices(); }, []);
  useEffect(() => { setBetAmount(BC.defaultBet(currency)); }, [currency]);
  function halfBet()   { setBetAmount(v => BC.halfBet(v, currency)); }
  function doubleBet() { setBetAmount(v => BC.doubleBet(v, currency)); }
  function maxBet()    { setBetAmount(BC.maxBetAmount(currency, balances[currency])); }

  if (authLoading) return <LoadingScreen />;

  const payoutMap = {
    straight: 36, split: 18, corner: 9, red: 2, black: 2, odd: 2, even: 2,
    low: 2, high: 2, dozen1: 3, dozen2: 3, dozen3: 3, column1: 3, column2: 3, column3: 3,
  };
  const currentPayout = betType ? (payoutMap[betType] || 2) : 0;
  const potentialWin = ((parseFloat(betAmount) || 0) * currentPayout).toFixed(5);

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar balances={balances} activeCurrency={currency} onCurrencyChange={setCurrency} />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-2 grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2 space-y-2">

          {/* Wheel + Result — compact */}
          <div className="bg-casino-card border border-casino-border rounded-2xl p-3 flex items-center gap-4">
            <RouletteWheel spinning={spinning} resultNumber={resultNumber} spinKey={spinKey} />
            <div className="flex-1 space-y-2">
              {result && !spinning && (
                <div className="text-center">
                  <div className={`inline-block w-10 h-10 rounded-full flex items-center justify-center text-sm font-black ${
                    getColor(result.result) === "green" ? "bg-green-600" : getColor(result.result) === "red" ? "bg-red-600" : "bg-gray-700"
                  }`}>{result.result}</div>
                  <p className={`text-sm font-bold mt-1 ${result.won ? "text-green-400" : "text-red-400"}`}>
                    {result.won ? `+${result.profit.toFixed(5)}` : result.profit.toFixed(5)}
                  </p>
                </div>
              )}
              {!result && !spinning && (
                <p className="text-casino-muted text-xs text-center">Select a bet and spin</p>
              )}
              {spinning && <p className="text-gold text-xs text-center animate-pulse">Spinning...</p>}

              {/* Recent results */}
              {history.length > 0 && (
                <div className="flex gap-0.5 overflow-x-auto">
                  {history.slice(0, 12).map((bet, i) => {
                    const raw = bet.roll !== undefined && bet.roll !== null ? bet.roll : bet.result;
                    const num = raw !== undefined && raw !== null ? parseInt(raw) : null;
                    const c = num !== null && !isNaN(num) ? getColor(num) : "gray";
                    return (
                      <div key={bet.id || i} className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold shrink-0 ${
                        c === "green" ? "bg-green-600" : c === "red" ? "bg-red-600" : "bg-gray-700"
                      }`}>{num !== null && !isNaN(num) ? num : "?"}</div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-3 py-1.5">{error}</div>
          )}

          {/* Roulette Table — compact */}
          <div className="bg-casino-card border border-casino-border rounded-2xl p-2 space-y-1">
            <div className="overflow-x-auto">
              <div className="min-w-[460px]">
                {/* Zero */}
                <div className="mb-0.5">
                  <button onClick={() => selectStraight(0)}
                    className={`w-full py-1 rounded-t text-xs font-bold transition-all border ${
                      betType === "straight" && betValue === 0
                        ? "bg-green-600 border-green-400 ring-2 ring-gold"
                        : "bg-green-700/60 border-green-600/40 hover:bg-green-600"
                    }`}>0</button>
                </div>

                {/* Number grid */}
                {TABLE_ROWS.map((row, rowIdx) => (
                  <div key={rowIdx} className="flex gap-px mb-px">
                    {row.map((num, colIdx) => {
                      const c = getColor(num);
                      const isSelected = betType === "straight" && parseInt(betValue) === num;
                      const isCornerSelected = betType === "corner" && betValue && String(betValue).split(",").map(Number).includes(num);
                      return (
                        <div key={num} className="relative flex-1">
                          <button onClick={() => selectStraight(num)}
                            className={`w-full py-1 text-[10px] font-bold transition-all border rounded-sm ${
                              isSelected ? "ring-2 ring-gold scale-105 z-10" :
                              isCornerSelected ? "ring-1 ring-gold/60" : ""
                            } ${c === "red" ? "bg-red-700/70 border-red-600/40 hover:bg-red-600" : "bg-gray-700/70 border-gray-600/40 hover:bg-gray-600"}`}>
                            {num}
                          </button>
                          {rowIdx < 2 && colIdx < 11 && (
                            <button onClick={() => { const corners = getCornerNumbers(rowIdx, colIdx); if (corners) selectCorner(corners); }}
                              className="absolute -bottom-[3px] -right-[3px] w-2.5 h-2.5 rounded-full bg-gold/20 hover:bg-gold/60 z-20 transition-all hover:scale-150"
                              title={(() => { const cn = getCornerNumbers(rowIdx, colIdx); return cn ? `Corner: ${cn.join(",")}` : ""; })()} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}

                {/* Column + Dozen + Outside — all compact */}
                <div className="flex gap-px mt-0.5">
                  {["column1","column2","column3"].map((col, i) => (
                    <button key={col} onClick={() => selectOutsideBet(col)}
                      className={`flex-1 py-0.5 rounded-sm text-[10px] font-bold transition-all border ${
                        betType === col ? "bg-gold/20 border-gold text-gold" : "bg-casino-surface border-casino-border text-casino-muted hover:text-white"
                      }`}>Col {i+1}</button>
                  ))}
                </div>
                <div className="flex gap-px mt-0.5">
                  {[{t:"dozen1",l:"1st 12"},{t:"dozen2",l:"2nd 12"},{t:"dozen3",l:"3rd 12"}].map(d => (
                    <button key={d.t} onClick={() => selectOutsideBet(d.t)}
                      className={`flex-1 py-0.5 rounded-sm text-[10px] font-bold transition-all border ${
                        betType === d.t ? "bg-gold/20 border-gold text-gold" : "bg-casino-surface border-casino-border text-casino-muted hover:text-white"
                      }`}>{d.l}</button>
                  ))}
                </div>
                <div className="grid grid-cols-6 gap-px mt-0.5">
                  {[
                    {t:"low",l:"1-18"},{t:"even",l:"Even"},{t:"red",l:"Red",c:"bg-red-700/50"},
                    {t:"black",l:"Black",c:"bg-gray-700/50"},{t:"odd",l:"Odd"},{t:"high",l:"19-36"},
                  ].map(b => (
                    <button key={b.t} onClick={() => selectOutsideBet(b.t)}
                      className={`py-0.5 rounded-sm text-[10px] font-bold transition-all border ${
                        betType === b.t ? "bg-gold/20 border-gold text-gold" :
                        `${b.c || "bg-casino-surface"} border-casino-border text-casino-muted hover:text-white`
                      }`}>{b.l}</button>
                  ))}
                </div>
              </div>
            </div>

            {/* Bet info + controls inline */}
            <div className="flex items-center gap-2 pt-1 border-t border-casino-border">
              <div className="flex-1 text-[10px] text-casino-muted">
                {betType ? <>Bet: <span className="text-gold capitalize">{betType}</span>
                  {betValue !== null && <span className="text-white ml-1">({betValue})</span>}
                  <span className="ml-2">{currentPayout}x → {potentialWin}</span></> : "No bet selected"}
              </div>
              {betType && (
                <button onClick={() => { setBetType(null); setBetValue(null); }}
                  className="text-[10px] text-red-400 hover:text-red-300 font-bold">Clear</button>
              )}
            </div>
          </div>

          {/* Bet amount + spin — single row */}
          <div className="bg-casino-card border border-casino-border rounded-2xl p-2">
            <div className="flex gap-2 items-end">
              <div className="flex-1 space-y-0.5">
                <span className="text-[10px] text-casino-muted font-mono uppercase">Bet</span>
                <input type="number" min={BC.minBet(currency)} step={BC.stepSize(currency)} value={betAmount} onChange={e => setBetAmount(e.target.value)}
                  className="w-full bg-casino-surface border border-casino-border rounded px-2 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-gold/50" />
                <div className="flex gap-0.5">
                  <button onClick={halfBet} className="flex-1 bg-casino-surface border border-casino-border rounded px-1 py-0.5 text-[10px] text-casino-muted hover:text-white">½</button>
                  <button onClick={doubleBet} className="flex-1 bg-casino-surface border border-casino-border rounded px-1 py-0.5 text-[10px] text-casino-muted hover:text-white">2x</button>
                  <button onClick={maxBet} className="flex-1 bg-casino-surface border border-casino-border rounded px-1 py-0.5 text-[10px] text-casino-muted hover:text-white">Max</button>
                </div>
              </div>
              <div className="w-28 space-y-0.5">
                <span className="text-[10px] text-casino-muted font-mono uppercase">Currency</span>
                <select value={currency} onChange={e => setCurrency(e.target.value)}
                  className="w-full bg-casino-surface border border-casino-border rounded px-2 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-gold/50">
                  {CURRENCIES.map(c => <option key={c} value={c}>{c.replace("_"," ")}</option>)}
                </select>
              </div>
              <button onClick={handleSpin}
                disabled={roundActive || !betType}
                className="px-6 py-3 rounded-xl font-bold text-xs transition-all bg-gradient-to-r from-green-600 to-green-500 text-white hover:shadow-lg hover:shadow-green-500/20 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap">
                {roundActive ? "..." : "SPIN"}
              </button>
            </div>
          </div>
        </div>

        <div>
          <BetHistory title="Roulette History" bets={history} onLoadMore={() => setHistoryPage(p => p + 1)} />
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
