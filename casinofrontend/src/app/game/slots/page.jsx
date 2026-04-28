"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import { useAuth } from "@/context/AuthContext";
import { getBalances, placeSlotsBet } from "@/lib/api";
import * as BC from "@/lib/betConfig";

const CURRENCIES = ["USDT_POLYGON", "ETH_POLYGON", "USDT_TRON", "BTC"];
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

function iconHTML(key) {
  if (key === "btc") return '<div class="cf-symbol cf-coinSym">₿</div>';
  if (key === "doge") return '<div class="cf-symbol cf-coinSym"><span class="cf-dogeFace">D</span></div>';
  if (key === "eth") return '<div class="cf-symbol cf-ethSym"><div class="cf-ethIcon"></div></div>';
  if (key === "sol") return '<div class="cf-symbol cf-solSym"><div class="cf-solBars"><span></span><span></span><span></span></div></div>';
  if (key === "xrp") return '<div class="cf-symbol cf-xrpSym">X</div>';
  if (key === "usdt") return '<div class="cf-symbol cf-usdtSym">₮</div>';
  if (key === "wild") return '<div class="cf-symbol cf-special cf-wild">🚀<br>WILD</div>';
  return '<div class="cf-symbol cf-special cf-scatter">💎<br>SCATTER</div>';
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

  const [currency, setCurrency] = useState("USDT_POLYGON");
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
                <div className="cf-coin">₿</div>
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
                    <div dangerouslySetInnerHTML={{ __html: iconHTML(s.key) }} />
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
        .cf-fit{width:100%;min-height:calc(100vh - 90px);padding:8px;display:flex;align-items:flex-start;justify-content:center}
        .cf-game{width:min(1540px,100%);aspect-ratio:16/9;position:relative;overflow:hidden;padding:clamp(8px,1vw,16px);border-radius:18px;border:2px solid rgba(58,151,255,.8);background:linear-gradient(180deg,rgba(8,16,42,.97),rgba(5,7,22,.99));box-shadow:0 0 60px rgba(0,120,255,.36),inset 0 0 38px rgba(122,39,255,.24);display:grid;grid-template-rows:17% 63% 20%;gap:clamp(6px,.85vw,13px)}
        .cf-game:before{content:"";position:absolute;inset:0;pointer-events:none;opacity:.5;background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);background-size:44px 44px}
        .cf-top,.cf-mid,.cf-bottom{position:relative;z-index:2;min-height:0;display:grid;gap:clamp(6px,.85vw,13px)}
        .cf-top{grid-template-columns:1fr 1.35fr 1fr}.cf-mid{grid-template-columns:13% minmax(0,1fr) 10%}.cf-bottom{grid-template-columns:1.1fr 1.05fr .62fr 1fr 1.52fr}
        .cf-panel{min-width:0;min-height:0;border:2px solid rgba(62,145,255,.72);background:linear-gradient(180deg,rgba(13,25,65,.94),rgba(6,8,25,.96));box-shadow:inset 0 0 25px rgba(0,183,255,.12),0 0 18px rgba(43,132,255,.18)}
        .cf-cut-left{clip-path:polygon(0 0,88% 0,100% 50%,88% 100%,0 100%,5% 50%);border-color:rgba(255,166,34,.78)}
        .cf-cut-right{clip-path:polygon(12% 0,100% 0,95% 50%,100% 100%,12% 100%,0 50%);border-color:rgba(183,65,255,.85)}
        .cf-jackpot,.cf-topmulti{display:flex;flex-direction:column;justify-content:center;padding:0 clamp(12px,1.5vw,26px)}
        .cf-topmulti{text-align:right;align-items:flex-end}.cf-label{font-size:clamp(11px,1.35vw,23px);font-weight:900;letter-spacing:.08em;color:#ffd15d;text-transform:uppercase}.cf-amount{font-size:clamp(19px,2.55vw,44px);font-weight:900;color:#ffcf4b;text-shadow:0 0 17px rgba(255,176,0,.85);line-height:1.02;white-space:nowrap}
        .cf-logo{position:relative;border-radius:12px;border-color:rgba(0,198,255,.9);background:linear-gradient(180deg,#17366b,#090e2c);display:flex;align-items:center;justify-content:center;text-align:center;clip-path:polygon(10% 0,90% 0,100% 50%,90% 100%,10% 100%,0 50%)}
        .cf-logo .cf-coin{position:absolute;top:-18%;width:clamp(34px,3.8vw,62px);aspect-ratio:1;border-radius:50%;display:grid;place-items:center;background:linear-gradient(135deg,#fff3a3,#f59b00 62%,#6f3300);border:4px solid #3b2200;color:#351900;font-size:clamp(21px,2.6vw,40px);font-weight:900;box-shadow:0 0 20px rgba(255,176,0,.9)}
        .cf-logo h1{font-size:clamp(32px,4.9vw,80px);line-height:.82;letter-spacing:.055em;background:linear-gradient(#fff,#d4defe 34%,#ffbe42 70%,#5b2600);-webkit-background-clip:text;color:transparent;filter:drop-shadow(0 5px 0 rgba(0,0,0,.7))}
        .cf-logo p{margin-top:.28em;font-size:clamp(12px,1.65vw,28px);font-weight:900;letter-spacing:.24em;color:#ffd45e;text-shadow:0 0 12px rgba(255,188,0,.5)}
        .cf-left{display:grid;grid-template-rows:1fr 1fr;border-radius:12px;overflow:hidden}.cf-info{display:flex;align-items:center;justify-content:center;text-align:center;flex-direction:column;border-bottom:1px solid rgba(104,94,255,.35);padding:4px}.cf-info:last-child{border:0}.cf-purple{color:#e36aff;text-shadow:0 0 15px rgba(227,106,255,.85)}.cf-green{color:#39ffad;text-shadow:0 0 13px rgba(57,255,173,.75)}.cf-info-title{font-size:clamp(10px,1.25vw,21px);line-height:1.05;text-transform:uppercase;font-weight:900}.cf-info-num{font-size:clamp(26px,4.6vw,72px);line-height:.95;font-weight:900;margin-top:.12em}
        .cf-reels{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));grid-template-rows:repeat(3,minmax(0,1fr));gap:3px;padding:5px;border-radius:13px;overflow:hidden}.cf-cell{display:grid;place-items:center;min-width:0;min-height:0;position:relative;overflow:hidden;background:radial-gradient(circle,rgba(36,54,115,.7),rgba(3,7,25,.98));border:1px solid rgba(66,140,255,.46)}.cf-cell:before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 50% 45%,rgba(255,255,255,.08),transparent 52%)}
        .cf-symbol{position:relative;width:min(82%,118px);aspect-ratio:1;display:grid;place-items:center;animation:cf-float 2.7s ease-in-out infinite}.cf-cell:nth-child(2n) .cf-symbol{animation-delay:-.8s}.cf-cell:nth-child(3n) .cf-symbol{animation-delay:-1.4s}@keyframes cf-float{50%{transform:translateY(-5%) scale(1.03)}}
        .cf-coinSym{border-radius:50%;border:clamp(3px,.38vw,6px) solid #ffd16a;box-shadow:0 0 24px rgba(255,167,0,.82),inset 0 0 20px rgba(255,255,255,.25);background:radial-gradient(circle at 35% 24%,#fff1a2,#ffae10 48%,#8b4200);color:#3a1b00;font-size:clamp(27px,4.4vw,76px);font-weight:900;text-shadow:0 2px rgba(255,255,255,.22)}
        .cf-ethSym{border-radius:50%;border:clamp(3px,.38vw,6px) solid #b95cff;background:radial-gradient(circle,rgba(139,84,255,.72),#101133 72%);box-shadow:0 0 24px rgba(184,87,255,.85)}.cf-ethIcon{width:48%;height:66%;background:linear-gradient(#f6f3ff,#735bff);clip-path:polygon(50% 0,100% 50%,50% 70%,0 50%);filter:drop-shadow(0 0 10px #b69cff)}
        .cf-solSym{border-radius:50%;border:clamp(3px,.38vw,6px) solid #25eaff;background:radial-gradient(circle,rgba(0,236,255,.28),#091031 72%);box-shadow:0 0 24px rgba(37,234,255,.78)}.cf-solBars{width:58%;height:42%;position:relative}.cf-solBars span{position:absolute;left:0;width:100%;height:24%;border-radius:8px;background:linear-gradient(90deg,#27fff1,#a43cff)}.cf-solBars span:nth-child(1){top:0}.cf-solBars span:nth-child(2){top:38%;transform:translateX(12%)}.cf-solBars span:nth-child(3){bottom:0}
        .cf-xrpSym{border-radius:50%;border:clamp(3px,.38vw,6px) solid #ff63f3;background:radial-gradient(circle,rgba(255,69,236,.42),#140d31 72%);box-shadow:0 0 24px rgba(255,99,243,.78);color:#ff8cf7;font-size:clamp(30px,4.4vw,76px);font-weight:900}.cf-usdtSym{border-radius:50%;border:clamp(3px,.38vw,6px) solid #39ffad;background:radial-gradient(circle,rgba(51,255,177,.52),#08291f 72%);box-shadow:0 0 24px rgba(57,255,173,.76);color:white;font-size:clamp(30px,4.4vw,76px);font-weight:900}.cf-dogeFace{font-size:clamp(27px,4vw,70px)}
        .cf-special{width:86%;border-radius:16px;color:white;font-size:clamp(14px,2.2vw,38px);font-weight:900;text-shadow:0 4px 0 rgba(0,0,0,.75),0 0 14px #fff000}.cf-wild{background:radial-gradient(circle at 35% 25%,#fff2a4,#ff6200 50%,#581500);border:4px solid #ffd16a;box-shadow:0 0 28px rgba(255,94,0,.9);transform:rotate(-8deg)}.cf-scatter{background:radial-gradient(circle,#28eaff,#7d28ff 58%,#170326);border:4px solid #ff6bf4;box-shadow:0 0 28px rgba(255,88,241,.85);color:#fff35c}
        .cf-winCell{outline:4px solid #fff15d;box-shadow:0 0 34px rgba(255,228,61,.95),inset 0 0 23px rgba(255,228,61,.24);z-index:3}.cf-multipliers{display:grid;grid-template-rows:repeat(7,minmax(0,1fr));gap:6px;padding:7px;border-radius:12px}.cf-mult{display:grid;place-items:center;border:2px solid #873bff;background:linear-gradient(180deg,#28134f,#080a24);border-radius:10px;clip-path:polygon(12% 0,88% 0,100% 50%,88% 100%,12% 100%,0 50%);font-size:clamp(13px,2vw,33px);font-weight:900;color:#bd76ff;text-shadow:0 0 12px rgba(189,118,255,.85)}.cf-mult.active{color:#fff05d;border-color:#ffad3b;box-shadow:0 0 24px rgba(255,143,0,.8);background:linear-gradient(180deg,#672c00,#261044)}
        .cf-bottom .cf-panel,.cf-bottom button.cf-panel{border-radius:12px}.cf-bottomPanel{display:flex;align-items:center;justify-content:center;gap:9px;text-align:center;padding:5px;min-height:0}.cf-bottomLabel{font-size:clamp(9px,1.08vw,18px);font-weight:900;text-transform:uppercase;color:#aebfff}.cf-bottomVal{font-size:clamp(14px,1.85vw,30px);line-height:1.05;font-weight:900;color:#eef4ff}.cf-token{width:clamp(30px,3.6vw,56px);aspect-ratio:1;border-radius:50%;display:grid;place-items:center;background:linear-gradient(135deg,#2dffad,#00694b);box-shadow:0 0 18px rgba(45,255,173,.55);font-size:clamp(19px,2.35vw,34px);font-weight:900;flex:0 0 auto}.cf-betBtn{width:clamp(30px,3.2vw,50px);height:58%;border:1px solid rgba(141,169,255,.6);border-radius:10px;background:linear-gradient(#374d9a,#111731);color:white;font-size:clamp(19px,2.25vw,32px);font-weight:900;cursor:pointer}.cf-spin{width:min(82%,108px);aspect-ratio:1;border-radius:50%;border:5px solid #67c7ff;background:radial-gradient(circle,#2469e8,#071026 72%);color:white;font-size:clamp(32px,4.7vw,60px);cursor:pointer;box-shadow:0 0 30px rgba(87,190,255,.82),inset 0 0 22px rgba(255,255,255,.22)}.cf-spin:hover{filter:brightness(1.15);transform:scale(1.04)}.cf-spin:disabled{opacity:.55;cursor:not-allowed}.cf-auto{color:white;cursor:pointer}.cf-auto.on{border-color:#ffad3b;box-shadow:0 0 24px rgba(255,143,0,.7)}.cf-winPanel{border-color:#ffad3b;background:linear-gradient(180deg,#311a07,#13081c);clip-path:polygon(9% 0,100% 0,94% 50%,100% 100%,9% 100%,0 50%)}.cf-winPanel .cf-bottomVal{font-size:clamp(22px,3.7vw,60px);color:#ffd15b;text-shadow:0 0 18px rgba(255,187,0,.9)}
        .cf-toast{position:absolute;z-index:20;left:50%;top:50%;transform:translate(-50%,-50%) scale(.7);font-size:clamp(40px,7.5vw,112px);font-weight:900;color:#fff25d;text-shadow:0 0 24px #ff8000,0 8px 0 #571500;opacity:0;pointer-events:none}.cf-toast.cf-show{animation:cf-pop 1.2s ease forwards}@keyframes cf-pop{20%{opacity:1;transform:translate(-50%,-50%) scale(1.1)}80%{opacity:1;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-50%) scale(1.25)}}.cf-spinning .cf-symbol{animation:cf-spinBlur .1s linear infinite}@keyframes cf-spinBlur{from{transform:translateY(-45%) scale(.9);filter:blur(3px);opacity:.45}to{transform:translateY(45%) scale(1.08);filter:blur(1px);opacity:1}}
        .cf-error{position:absolute;left:16px;right:16px;bottom:14px;z-index:31;padding:8px 10px;border-radius:8px;background:rgba(220,38,38,.15);border:1px solid rgba(248,113,113,.45);color:#fda4af;font-size:12px}
        @media(max-width:1100px){.cf-fit{min-height:auto}.cf-game{aspect-ratio:auto;max-height:none;min-height:980px;grid-template-rows:auto auto auto}}
        @media(max-width:850px){.cf-top,.cf-mid,.cf-bottom{grid-template-columns:1fr}.cf-logo{min-height:120px;order:-1}.cf-jackpot,.cf-topmulti{min-height:82px;align-items:center;text-align:center;clip-path:none}.cf-left{grid-template-columns:1fr 1fr;grid-template-rows:none;min-height:105px}.cf-reels{aspect-ratio:5/3}.cf-multipliers{grid-template-columns:repeat(4,1fr);grid-template-rows:auto}.cf-bottomPanel{min-height:82px}.cf-winPanel{clip-path:none}}
      `}</style>
    </div>
  );
}
