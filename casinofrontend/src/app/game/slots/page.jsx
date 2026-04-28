"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import { useAuth } from "@/context/AuthContext";
import { getBalances, placeSlotsBet } from "@/lib/api";
import * as BC from "@/lib/betConfig";

const CURRENCIES = ["USDT", "ETH_POLYGON", "BTC"];
const CURRENCY_LABEL = {
  USDT: "USDT POLYGON",
  ETH_POLYGON: "ETH POLYGON",
    BTC: "BTC",
};
const reelCount = 5;
const rowCount = 3;
const totalCells = reelCount * rowCount;
const paylines = [
  [0, 1, 2, 3, 4],
  [5, 6, 7, 8, 9],
  [10, 11, 12, 13, 14],
  [0, 6, 12, 8, 4],
  [10, 6, 2, 8, 14],
];

const symbols = [
  { key: "btc", weight: 7 },
  { key: "eth", weight: 8 },
  { key: "doge", weight: 10 },
  { key: "sol", weight: 10 },
  { key: "xrp", weight: 12 },
  { key: "usdt", weight: 16 },
  { key: "wild", weight: 3 },
  { key: "scatter", weight: 2 },
];

const backendToCrypto = {
  seven: "btc",
  bar: "eth",
  bell: "sol",
  cherry: "xrp",
  lemon: "usdt",
  wild: "wild",
  scatter: "scatter",
  btc: "btc",
  eth: "eth",
  doge: "doge",
  sol: "sol",
  xrp: "xrp",
  usdt: "usdt",
};

const multipliers = [1, 1, 1, 1, 1, 1, 2, 2, 2, 4, 4, 8, 16, 32, 64, 128];

function money(v) {
  const n = Number(v) || 0;
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function weightedSymbol() {
  const total = symbols.reduce((s, x) => s + x.weight, 0);
  let r = Math.random() * total;
  for (const s of symbols) {
    r -= s.weight;
    if (r <= 0) return { key: s.key };
  }
  return { key: symbols[0].key };
}

function makeGrid() {
  return Array.from({ length: totalCells }, weightedSymbol);
}

function normalizeGrid(rawGrid) {
  if (!rawGrid) return null;

  if (Array.isArray(rawGrid) && rawGrid.length === totalCells && rawGrid[0]?.key) {
    return rawGrid.map((s) => ({ key: backendToCrypto[s.key] || "usdt" }));
  }

  if (Array.isArray(rawGrid) && rawGrid.length === rowCount && Array.isArray(rawGrid[0])) {
    const out = [];
    for (let r = 0; r < rowCount; r++) {
      for (let c = 0; c < reelCount; c++) {
        const name = rawGrid[r]?.[c]?.name || rawGrid[r]?.[c]?.key;
        out.push({ key: backendToCrypto[name] || "usdt" });
      }
    }
    return out;
  }

  return null;
}

function renderSymbol(key) {
  if (key === "btc") return <div className="cf-symbol cf-symbol-coin">₿</div>;
  if (key === "doge") return <div className="cf-symbol cf-symbol-coin">D</div>;
  if (key === "eth") return <div className="cf-symbol cf-eth"><div className="cf-eth-icon" /></div>;
  if (key === "sol") return <div className="cf-symbol cf-sol"><div className="cf-sol-bars"><span /><span /><span /></div></div>;
  if (key === "xrp") return <div className="cf-symbol cf-xrp">X</div>;
  if (key === "usdt") return <div className="cf-symbol cf-usdt">₮</div>;
  if (key === "wild") return <div className="cf-symbol cf-special cf-wild">🚀<br />WILD</div>;
  return <div className="cf-symbol cf-special cf-scatter">💎<br />SCATTER</div>;
}

function SlotSymbol({ symbolKey }) {
  const [imgError, setImgError] = useState(false);
  const src = `/assets/${symbolKey}.png`;

  if (!imgError) {
    return (
      <img
        src={src}
        alt={symbolKey}
        className="cf-symbol cf-image-symbol"
        draggable={false}
        onError={() => setImgError(true)}
      />
    );
  }

  return renderSymbol(symbolKey);
}

function buildWinningCells(result) {
  const winners = new Set();
  if (!result?.won) return winners;

  if (typeof result.winningLine === "number" && result.winningLine >= 0) {
    const line = paylines[result.winningLine];
    const count = Math.max(3, Math.min(5, Number(result.matchCount) || 3));
    line?.slice(0, count).forEach((idx) => winners.add(idx));
  }

  return winners;
}

export default function SlotsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [currency, setCurrency] = useState("USDT");
  const [bet, setBet] = useState(100);
  const [balanceMap, setBalanceMap] = useState({});

  const [grid, setGrid] = useState(() => [
    { key: "eth" }, { key: "doge" }, { key: "btc" }, { key: "sol" }, { key: "doge" },
    { key: "wild" }, { key: "usdt" }, { key: "xrp" }, { key: "scatter" }, { key: "wild" },
    { key: "sol" }, { key: "doge" }, { key: "btc" }, { key: "eth" }, { key: "usdt" },
  ]);
  const [winners, setWinners] = useState(new Set());
  const [spinning, setSpinning] = useState(false);
  const [auto, setAuto] = useState(false);
  const [lastWin, setLastWin] = useState(0);
  const [totalWin, setTotalWin] = useState(0);
  const [freeSpins, setFreeSpins] = useState(0);
  const [mult, setMult] = useState(1);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");

  const autoTimer = useRef(null);
  const autoRef = useRef(false);

  const balance = Number(balanceMap[currency] || 0);
  const jackpot = useMemo(() => 251459.7 + totalWin * 0.02, [totalWin]);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  useEffect(() => {
    BC.fetchPrices();
  }, []);

  useEffect(() => {
    setBet(Number(BC.defaultBet(currency)) || 10);
  }, [currency]);

  useEffect(() => {
    if (!user) return;
    fetchBalances();
  }, [user]);

  useEffect(() => () => clearTimeout(autoTimer.current), []);
  useEffect(() => {
    autoRef.current = auto;
  }, [auto]);

  async function fetchBalances() {
    try {
      const data = await getBalances();
      const map = {};
      for (const [k, v] of Object.entries(data.balances || {})) map[k] = v.balance;
      setBalanceMap(map);
    } catch {
      // ignore
    }
  }

  function showToast(text) {
    setToast(text);
    setTimeout(() => setToast(""), 1200);
  }

  async function spin() {
    if (spinning) return;
    if (balance < bet && freeSpins <= 0) {
      showToast("NO BALANCE");
      setAuto(false);
      return;
    }

    setError("");
    setSpinning(true);
    setWinners(new Set());
    setLastWin(0);

    const spinTicker = setInterval(() => {
      setGrid(makeGrid());
    }, 65);

    try {
      const data = await placeSlotsBet({ currency, betAmount: Number(bet) });
      const backendBet = data.bet;
      const finalGrid = normalizeGrid(backendBet?.grid) || makeGrid();

      setTimeout(() => {
        clearInterval(spinTicker);

        const payout = Number(backendBet?.payout) || 0;
        const winSet = buildWinningCells(backendBet);
        const m = payout > 0 ? Number(backendBet?.multiplier) || multipliers[Math.floor(Math.random() * multipliers.length)] : 1;

        setGrid(finalGrid);
        setWinners(winSet);
        setMult(m);
        setLastWin(payout);
        setTotalWin((v) => v + payout);
        setBalanceMap((prev) => ({ ...prev, [currency]: data.balance }));

        if (payout >= bet * 50) showToast("MEGA WIN!");
        else if (payout >= bet * 10) showToast("BIG WIN!");
        else if (payout > 0) showToast("WIN!");

        setSpinning(false);
        if (autoRef.current) {
          clearTimeout(autoTimer.current);
          autoTimer.current = setTimeout(spin, 750);
        }
      }, 1200);
    } catch (err) {
      clearInterval(spinTicker);
      setSpinning(false);
      setError(err.message || "Spin failed");
    }
  }

  function decBet() {
    const min = Number(BC.minBet(currency)) || 10;
    const step = Number(BC.stepSize(currency)) || 10;
    setBet((v) => Math.max(min, Number((v - step).toFixed(8))));
  }

  function incBet() {
    const max = Number(BC.maxBetAmount(currency, balance)) || 1000;
    const step = Number(BC.stepSize(currency)) || 10;
    setBet((v) => Math.min(max, Number((v + step).toFixed(8))));
  }

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#02040d]">
      <Navbar balances={balanceMap} activeCurrency={currency} onCurrencyChange={setCurrency} />

      <main className="flex-1 p-2 sm:p-3">
        <div className="cf-fit">
          <section className="cf-game">
            {toast && <div className="cf-toast cf-show">{toast}</div>}

            <section className="cf-top">
              <div className="cf-panel cf-jackpot cf-cut-left">
                <div className="cf-label">Jackpot</div>
                <div className="cf-amount">${money(jackpot)}</div>
              </div>
              <div className="cf-panel cf-logo">
                <div className="cf-logo-coin">₿</div>
                <div><h1>CRYPTO</h1><p>FORTUNE</p></div>
              </div>
              <div className="cf-panel cf-topmulti cf-cut-right">
                <div className="cf-label">Multiplier</div>
                <div className="cf-amount">x{mult}</div>
              </div>
            </section>

            <section className="cf-mid">
              <aside className="cf-panel cf-left">
                <div className="cf-info">
                  <div className="cf-info-title cf-purple">Free<br />Spins</div>
                  <div className="cf-info-num cf-purple">{freeSpins}</div>
                </div>
                <div className="cf-info">
                  <div className="cf-info-title cf-green">Total Win</div>
                  <div className="cf-info-num cf-green">{money(totalWin)}</div>
                  <div className="cf-info-title cf-green">USDT</div>
                </div>
              </aside>

              <div className={`cf-panel cf-reels ${spinning ? "cf-spinning" : ""}`}>
                {grid.map((s, i) => (
                  <div key={i} className={`cf-cell ${winners.has(i) ? "cf-winCell" : ""}`}>
                    <SlotSymbol symbolKey={s.key} />
                  </div>
                ))}
              </div>

              <aside className="cf-panel cf-multipliers">
                {[128, 64, 32, 16, 8, 4, 1].map((v) => (
                  <div key={v} className={`cf-mult ${mult === v ? "active" : ""}`}>x{v}</div>
                ))}
              </aside>
            </section>

            <section className="cf-bottom">
              <div className="cf-panel cf-bottomPanel">
                <div className="cf-token">₮</div>
                <div>
                  <select
                    className="cf-currencySelect"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>{CURRENCY_LABEL[c]}</option>
                    ))}
                  </select>
                  <div className="cf-bottomLabel">Balance</div>
                  <div className="cf-bottomVal">{money(balance)} {currency.replace("_", " ")}</div>
                </div>
              </div>

              <div className="cf-panel cf-bottomPanel">
                <button className="cf-betBtn" onClick={decBet} type="button">−</button>
                <div>
                  <div className="cf-bottomLabel">Bet</div>
                  <div className="cf-bottomVal">{money(bet)}<br />{currency.replace("_", " ")}</div>
                </div>
                <button className="cf-betBtn" onClick={incBet} type="button">+</button>
              </div>

              <div className="cf-bottomPanel">
                <button className="cf-spin" onClick={spin} disabled={spinning} type="button">↻</button>
              </div>

              <button
                className={`cf-panel cf-bottomPanel cf-auto ${auto ? "on" : ""}`}
                onClick={() => {
                  const next = !auto;
                  setAuto(next);
                  if (!next) clearTimeout(autoTimer.current);
                  if (next && !spinning) spin();
                }}
                type="button"
              >
                <div>
                  <div className="cf-bottomLabel">Auto Play</div>
                  <div className="cf-bottomVal">{auto ? "ON" : "OFF"}</div>
                </div>
              </button>

              <div className="cf-panel cf-bottomPanel cf-winPanel">
                <div>
                  <div className="cf-bottomLabel">Win</div>
                  <div className="cf-bottomVal">{money(lastWin)}</div>
                  <div className="cf-bottomLabel">USDT</div>
                </div>
              </div>
            </section>

            {error && <div className="cf-error">{error}</div>}
          </section>
        </div>

      </main>

      <style jsx>{`
        .cf-fit{width:100%;min-height:calc(100vh - 90px);padding:12px;display:flex;align-items:center;justify-content:center}
        .cf-game{width:min(1560px,100%);aspect-ratio:16/9;max-height:calc(100vh - 120px);position:relative;overflow:hidden;padding:clamp(10px,1vw,18px);border-radius:24px;border:2px solid rgba(78,166,255,.82);background-image:linear-gradient(180deg,rgba(7,13,35,.58),rgba(3,5,18,.7)),url('/assets/bg.png');background-size:cover,cover;background-position:center,center;box-shadow:0 0 70px rgba(0,145,255,.38),inset 0 0 40px rgba(135,54,255,.22);display:grid;grid-template-rows:17% 63% 20%;gap:clamp(8px,.9vw,14px)}
        .cf-game::before{content:"";position:absolute;inset:0;pointer-events:none;opacity:.4;background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);background-size:44px 44px}
        .cf-game::after{content:"";position:absolute;inset:-20%;pointer-events:none;background:conic-gradient(from 180deg,transparent,rgba(0,225,255,.11),transparent,rgba(255,153,0,.1),transparent);animation:cf-rotateGlow 16s linear infinite}
        @keyframes cf-rotateGlow{to{transform:rotate(360deg)}}
        .cf-top,.cf-mid,.cf-bottom{position:relative;z-index:2;min-height:0;display:grid;gap:clamp(8px,.9vw,14px)}
        .cf-top{grid-template-columns:1fr 1.38fr 1fr}.cf-mid{grid-template-columns:13% minmax(0,1fr) 10.5%}.cf-bottom{grid-template-columns:1.12fr 1.08fr .62fr 1fr 1.55fr}
        .cf-panel{min-width:0;min-height:0;border:2px solid rgba(76,156,255,.72);background:linear-gradient(180deg,rgba(17,29,70,.35),rgba(5,8,27,.45));box-shadow:inset 0 0 28px rgba(0,202,255,.12),0 0 22px rgba(34,120,255,.16);backdrop-filter:blur(2px)}
        .cf-cut-left{clip-path:polygon(0 0,88% 0,100% 50%,88% 100%,0 100%,5% 50%);border-color:rgba(255,180,48,.82)}
        .cf-cut-right{clip-path:polygon(12% 0,100% 0,95% 50%,100% 100%,12% 100%,0 50%);border-color:rgba(190,80,255,.88)}
        .cf-jackpot,.cf-topmulti{display:flex;flex-direction:column;justify-content:center;padding:0 clamp(15px,1.6vw,30px)}
        .cf-topmulti{text-align:right;align-items:flex-end}.cf-label{font-size:clamp(12px,1.35vw,24px);font-weight:900;letter-spacing:.08em;color:#ffd45e;text-transform:uppercase}.cf-amount{font-size:clamp(20px,2.6vw,46px);font-weight:900;line-height:1.02;color:#ffd05a;text-shadow:0 0 18px rgba(255,180,0,.9);white-space:nowrap}
        .cf-logo{position:relative;clip-path:polygon(10% 0,90% 0,100% 50%,90% 100%,10% 100%,0 50%);border-color:rgba(0,220,255,.9);background:linear-gradient(180deg,rgba(32,72,135,.9),rgba(7,15,44,.95));display:flex;align-items:center;justify-content:center;text-align:center}
        .cf-logo .cf-logo-coin{position:absolute;top:-18%;width:clamp(36px,4vw,66px);aspect-ratio:1;border-radius:50%;display:grid;place-items:center;background:linear-gradient(135deg,#fff4a4,#f7a100 62%,#6d3200);border:4px solid #3b2200;color:#321700;font-size:clamp(22px,2.8vw,42px);font-weight:900;box-shadow:0 0 22px rgba(255,178,0,.9)}
        .cf-logo h1{font-size:clamp(30px,4.3vw,74px);line-height:.82;letter-spacing:.055em;background:linear-gradient(#fff,#d8e2ff 34%,#ffc247 70%,#683000);-webkit-background-clip:text;color:transparent;filter:drop-shadow(0 5px 0 rgba(0,0,0,.72))}
        .cf-logo p{margin-top:.22em;font-size:clamp(12px,1.45vw,25px);font-weight:900;letter-spacing:.22em;color:#ffd65e;text-shadow:0 0 12px rgba(255,188,0,.55)}
        .cf-left{display:grid;grid-template-rows:1fr 1fr;border-radius:15px;overflow:hidden}.cf-info{display:flex;align-items:center;justify-content:center;text-align:center;flex-direction:column;border-bottom:1px solid rgba(110,100,255,.35);padding:5px}.cf-info:last-child{border-bottom:0}.cf-purple{color:#e56cff;text-shadow:0 0 16px rgba(229,108,255,.9)}.cf-green{color:#39ffad;text-shadow:0 0 14px rgba(57,255,173,.8)}.cf-info-title{font-size:clamp(10px,1.28vw,22px);font-weight:900;line-height:1.05;text-transform:uppercase}.cf-info-num{font-size:clamp(27px,4.7vw,74px);font-weight:900;line-height:.95;margin-top:.12em}
        .cf-reels{position:relative;border-radius:17px;overflow:hidden;padding:7px;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));grid-template-rows:repeat(3,minmax(0,1fr));gap:5px;background:linear-gradient(180deg,rgba(15,34,80,.18),rgba(3,6,20,.25));border-color:rgba(78,164,255,.85)}
        .cf-reels::before{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.08),transparent);transform:translateX(-120%);animation:cf-shine 5s infinite;pointer-events:none;z-index:3}
        @keyframes cf-shine{55%{transform:translateX(-120%)}80%,100%{transform:translateX(120%)}}
        .cf-cell{position:relative;min-width:0;min-height:0;display:grid;place-items:center;overflow:hidden;border-radius:10px;border:1px solid rgba(104,173,255,.45);background:radial-gradient(circle at 50% 42%,rgba(43,75,146,.16),rgba(3,8,28,.15));box-shadow:inset 0 0 22px rgba(0,200,255,.08);perspective:700px}.cf-cell::before{content:"";position:absolute;inset:3px;border-radius:8px;border:1px solid rgba(255,210,95,.18);pointer-events:none}.cf-cell::after{content:"";position:absolute;inset:0;background:radial-gradient(circle at 50% 20%,rgba(255,255,255,.08),transparent 55%);pointer-events:none}
        .cf-symbol{width:min(88%,132px);aspect-ratio:1;display:grid;place-items:center;position:relative;transform-style:preserve-3d;animation:cf-idleFloat 2.8s ease-in-out infinite}.cf-cell:nth-child(2n) .cf-symbol{animation-delay:-.7s}.cf-cell:nth-child(3n) .cf-symbol{animation-delay:-1.3s}
        @keyframes cf-idleFloat{50%{transform:translateY(-4%) rotateX(5deg) scale(1.03)}}
        .cf-image-symbol{object-fit:contain;filter:drop-shadow(0 0 12px rgba(255,255,255,.2));animation:cf-coinAlive 1.6s ease-in-out infinite,cf-coinHue 3.2s linear infinite}
        .cf-cell:nth-child(2n) .cf-image-symbol{animation-delay:-.35s,-.8s}
        .cf-cell:nth-child(3n) .cf-image-symbol{animation-delay:-.72s,-1.4s}
        @keyframes cf-coinAlive{0%,100%{transform:translateY(0) scale(1) rotate(-2deg)}50%{transform:translateY(-7%) scale(1.08) rotate(2deg)}}
        @keyframes cf-coinHue{0%,100%{filter:drop-shadow(0 0 10px rgba(120,220,255,.45))}50%{filter:drop-shadow(0 0 20px rgba(255,112,246,.7))}}
        .cf-symbol-coin{border-radius:50%;border:clamp(3px,.38vw,6px) solid #ffd16a;box-shadow:0 0 24px rgba(255,167,0,.82),inset 0 0 20px rgba(255,255,255,.25),inset 0 -9px 14px rgba(0,0,0,.55);background:radial-gradient(circle at 35% 24%,#fff1a2,#ffae10 48%,#8b4200);color:#3a1b00;font-size:clamp(27px,4.4vw,76px);font-weight:900;text-shadow:0 2px rgba(255,255,255,.22)}
        .cf-eth{border-radius:50%;border:clamp(3px,.38vw,6px) solid #b95cff;background:radial-gradient(circle,rgba(139,84,255,.72),#101133 72%);box-shadow:0 0 24px rgba(184,87,255,.85),inset 0 0 20px rgba(255,255,255,.12)}.cf-eth-icon{width:48%;height:66%;background:linear-gradient(#f6f3ff,#735bff);clip-path:polygon(50% 0,100% 50%,50% 70%,0 50%);filter:drop-shadow(0 0 10px #b69cff)}
        .cf-sol{border-radius:50%;border:clamp(3px,.38vw,6px) solid #25eaff;background:radial-gradient(circle,rgba(0,236,255,.28),#091031 72%);box-shadow:0 0 24px rgba(37,234,255,.78),inset 0 0 20px rgba(255,255,255,.1)}.cf-sol-bars{width:58%;height:42%;position:relative}.cf-sol-bars span{position:absolute;left:0;width:100%;height:24%;border-radius:8px;background:linear-gradient(90deg,#27fff1,#a43cff)}.cf-sol-bars span:nth-child(1){top:0}.cf-sol-bars span:nth-child(2){top:38%;transform:translateX(12%)}.cf-sol-bars span:nth-child(3){bottom:0}
        .cf-xrp{border-radius:50%;border:clamp(3px,.38vw,6px) solid #ff63f3;background:radial-gradient(circle,rgba(255,69,236,.42),#140d31 72%);box-shadow:0 0 24px rgba(255,99,243,.78);color:#ff8cf7;font-size:clamp(30px,4.4vw,76px);font-weight:900}.cf-usdt{border-radius:50%;border:clamp(3px,.38vw,6px) solid #39ffad;background:radial-gradient(circle,rgba(51,255,177,.52),#08291f 72%);box-shadow:0 0 24px rgba(57,255,173,.76);color:white;font-size:clamp(30px,4.4vw,76px);font-weight:900}
        .cf-special{width:86%;border-radius:16px;color:white;font-size:clamp(14px,2.2vw,38px);font-weight:900;text-shadow:0 4px 0 rgba(0,0,0,.75),0 0 14px #fff000}.cf-wild{background:radial-gradient(circle at 35% 25%,#fff2a4,#ff6200 50%,#581500);border:4px solid #ffd16a;box-shadow:0 0 28px rgba(255,94,0,.9);transform:rotate(-8deg)}.cf-scatter{background:radial-gradient(circle,#28eaff,#7d28ff 58%,#170326);border:4px solid #ff6bf4;box-shadow:0 0 28px rgba(255,88,241,.85);color:#fff35c}
        .cf-winCell{outline:4px solid #fff15d;box-shadow:0 0 36px rgba(255,228,61,1),inset 0 0 26px rgba(255,228,61,.35);z-index:4;animation:cf-pulseWin .72s ease-in-out infinite alternate}.cf-winCell .cf-symbol{animation:cf-winSymbol .72s ease-in-out infinite alternate}
        @keyframes cf-pulseWin{to{filter:brightness(1.35)}}@keyframes cf-winSymbol{to{transform:scale(1.12) rotateZ(-3deg)}}
        .cf-multipliers{border-radius:15px;padding:7px;display:grid;grid-template-rows:repeat(7,minmax(0,1fr));gap:6px}.cf-mult{display:grid;place-items:center;border-radius:10px;clip-path:polygon(12% 0,88% 0,100% 50%,88% 100%,12% 100%,0 50%);border:2px solid #873bff;background:linear-gradient(180deg,#28134f,#080a24);font-size:clamp(13px,2vw,34px);font-weight:900;color:#bd76ff;text-shadow:0 0 12px rgba(189,118,255,.85)}.cf-mult.active{color:#fff05d;border-color:#ffad3b;box-shadow:0 0 24px rgba(255,143,0,.82);background:linear-gradient(180deg,#6b2e00,#261044)}
        .cf-bottomPanel{border-radius:15px;display:flex;align-items:center;justify-content:center;gap:10px;text-align:center;padding:6px}.cf-bottomLabel{font-size:clamp(9px,1.08vw,18px);font-weight:900;text-transform:uppercase;color:#b5c4ff}.cf-bottomVal{font-size:clamp(14px,1.85vw,31px);line-height:1.05;font-weight:900;color:#f0f5ff}.cf-token{width:clamp(31px,3.6vw,58px);aspect-ratio:1;border-radius:50%;display:grid;place-items:center;background:linear-gradient(135deg,#2dffad,#00694b);box-shadow:0 0 18px rgba(45,255,173,.55),inset 0 3px 8px rgba(255,255,255,.25);font-size:clamp(19px,2.35vw,36px);font-weight:900;flex:0 0 auto}.cf-currencySelect{width:100%;background:rgba(10,18,48,.55);border:1px solid rgba(106,162,255,.45);color:#dfe8ff;border-radius:8px;padding:4px 8px;font-size:12px;font-weight:700;outline:none;margin-bottom:6px}.cf-currencySelect option{color:#fff;background:#10193d}.cf-betBtn{width:clamp(30px,3.2vw,52px);height:58%;border:1px solid rgba(141,169,255,.6);border-radius:11px;background:linear-gradient(#3c55a7,#111731);box-shadow:0 0 13px rgba(76,132,255,.2);color:white;font-size:clamp(19px,2.25vw,32px);font-weight:900;cursor:pointer}.cf-spin{width:min(84%,110px);aspect-ratio:1;border-radius:50%;border:5px solid #67c7ff;background:radial-gradient(circle,#2670f4,#071026 72%);color:white;font-size:clamp(32px,4.7vw,62px);cursor:pointer;box-shadow:0 0 30px rgba(87,190,255,.82),inset 0 0 22px rgba(255,255,255,.22);transition:.15s}.cf-spin:hover{filter:brightness(1.15);transform:scale(1.04)}.cf-spin:disabled{opacity:.55;cursor:not-allowed}.cf-auto{color:white;cursor:pointer}.cf-auto.on{border-color:#ffad3b;box-shadow:0 0 24px rgba(255,143,0,.7)}.cf-winPanel{border-color:#ffad3b;background:linear-gradient(180deg,rgba(50,27,8,.6),rgba(19,8,28,.75));clip-path:polygon(9% 0,100% 0,94% 50%,100% 100%,9% 100%,0 50%)}.cf-winPanel .cf-bottomVal{font-size:clamp(22px,3.7vw,62px);color:#ffd15b;text-shadow:0 0 18px rgba(255,187,0,.9)}
        button{font:inherit}
        .cf-toast{position:absolute;z-index:30;left:50%;top:50%;transform:translate(-50%,-50%) scale(.7);font-size:clamp(40px,7.5vw,112px);font-weight:900;color:#fff25d;text-shadow:0 0 24px #ff8000,0 8px 0 #571500;opacity:0;pointer-events:none}.cf-toast.cf-show{animation:cf-pop 1.15s ease forwards}
        @keyframes cf-pop{20%{opacity:1;transform:translate(-50%,-50%) scale(1.1)}80%{opacity:1;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-50%) scale(1.25)}}
        .cf-spinning .cf-symbol{animation:cf-spinBlur .1s linear infinite}@keyframes cf-spinBlur{from{transform:translateY(-45%) scale(.9);filter:blur(3px);opacity:.45}to{transform:translateY(45%) scale(1.08);filter:blur(1px);opacity:1}}
        .cf-error{position:absolute;left:16px;right:16px;bottom:14px;z-index:31;padding:8px 10px;border-radius:8px;background:rgba(220,38,38,.15);border:1px solid rgba(248,113,113,.45);color:#fda4af;font-size:12px}
        @media(max-width:900px){.cf-fit{min-height:auto;align-items:flex-start}.cf-game{aspect-ratio:auto;max-height:none;min-height:980px;grid-template-rows:auto auto auto}.cf-top,.cf-mid,.cf-bottom{grid-template-columns:1fr}.cf-logo{order:-1;min-height:120px}.cf-jackpot,.cf-topmulti{min-height:84px;align-items:center;text-align:center;clip-path:none}.cf-left{grid-template-columns:1fr 1fr;grid-template-rows:none;min-height:105px}.cf-reels{aspect-ratio:5/3}.cf-multipliers{grid-template-columns:repeat(4,1fr);grid-template-rows:auto}.cf-bottomPanel{min-height:82px}.cf-winPanel{clip-path:none}}
      `}</style>
    </div>
  );
}
