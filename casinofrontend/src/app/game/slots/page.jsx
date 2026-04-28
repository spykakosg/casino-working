"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import Navbar from "@/components/Navbar";
import BetHistory from "@/components/BetHistory";
import { placeSlotsBet, getBalances, getSlotsBetHistory } from "@/lib/api";
import * as BC from "@/lib/betConfig";

const CURRENCIES = ["USDT_POLYGON", "ETH_POLYGON", "USDT_TRON", "BTC"];
const SHORT = { USDT_POLYGON: "USDT", ETH_POLYGON: "ETH", USDT_TRON: "USDT₮", BTC: "BTC" };
const MULTS = [128, 64, 32, 16, 8, 4, 2, 1];

function symbolCell(sym) {
  const map = {
    seven: { cls: "coinSym", inner: "₿" },
    bar: { cls: "ethSym", inner: "Ξ" },
    bell: { cls: "dogeSym", inner: "Ð" },
    cherry: { cls: "solSym", inner: "◎" },
    lemon: { cls: "xrpSym", inner: "✕" },
  };
  return map[sym] || map.lemon;
}

export default function SlotsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [currency, setCurrency] = useState("USDT_POLYGON");
  const [betAmount, setBetAmount] = useState("1");
  const [balances, setBalances] = useState({});
  const [history, setHistory] = useState([]);
  const [historyPage, setHistoryPage] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState(null);
  const [grid, setGrid] = useState(null);
  const [error, setError] = useState("");
  const [winToast, setWinToast] = useState("");

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  useEffect(() => { if (user) fetchBalances(); }, [user]);
  useEffect(() => { if (user) fetchHistory(); }, [user, historyPage]);
  useEffect(() => { BC.fetchPrices(); }, []);
  useEffect(() => { setBetAmount(BC.defaultBet(currency)); }, [currency]);

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

  async function spin() {
    if (spinning) return;
    setError("");
    setResult(null);
    setSpinning(true);

    try {
      const data = await placeSlotsBet({ currency, betAmount: parseFloat(betAmount) });
      const bet = data.bet;

      setGrid(bet.grid);
      setResult(bet);
      setBalances(prev => ({ ...prev, [currency]: data.balance }));
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

      if (bet.won) {
        setWinToast(bet.multiplier >= 50 ? "MEGA WIN!" : bet.multiplier >= 10 ? "BIG WIN!" : "WIN!");
        setTimeout(() => setWinToast(""), 1200);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSpinning(false);
    }
  }

  function halfBet() { setBetAmount(v => BC.halfBet(v, currency)); }
  function doubleBet() { setBetAmount(v => BC.doubleBet(v, currency)); }
  function maxBet() { setBetAmount(BC.maxBetAmount(currency, balances[currency])); }

  const displayGrid = grid || [
    [{ name: "bar" }, { name: "bell" }, { name: "seven" }, { name: "cherry" }, { name: "bell" }],
    [{ name: "lemon" }, { name: "seven" }, { name: "bar" }, { name: "cherry" }, { name: "lemon" }],
    [{ name: "cherry" }, { name: "bell" }, { name: "seven" }, { name: "bar" }, { name: "lemon" }],
  ];

  const activeMult = result?.multiplier || 1;
  const balance = balances[currency] || 0;
  const dec = BC.displayDecimals(currency);

  if (authLoading) return <LoadingScreen />;

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar balances={balances} activeCurrency={currency} onCurrencyChange={setCurrency} />

      <main className="fitSlots flex-1 p-2">
        <div className="gameSlots">
          {winToast && <div className="toastSlots show">{winToast}</div>}

          <section className="topSlots">
            <div className="panelSlots jackpot cutLeft">
              <div className="labelSlots">Jackpot</div>
              <div className="amountSlots">$251,459.70</div>
            </div>
            <div className="panelSlots logoSlots">
              <div className="coinSlots">₿</div>
              <div>
                <h1>CRYPTO</h1>
                <p>FORTUNE</p>
              </div>
            </div>
            <div className="panelSlots topMulti cutRight">
              <div className="labelSlots">Multiplier</div>
              <div className="amountSlots">x{activeMult}</div>
            </div>
          </section>

          <section className="midSlots">
            <aside className="panelSlots leftInfo">
              <div className="infoBlock">
                <div className="infoTitle purple">Free Spins</div>
                <div className="infoNum purple">0</div>
              </div>
              <div className="infoBlock">
                <div className="infoTitle green">Total Win</div>
                <div className="infoNum green">{result?.won ? parseFloat(result.profit).toFixed(dec) : "0.00"}</div>
                <div className="infoTitle green">{SHORT[currency]}</div>
              </div>
            </aside>

            <div className={`panelSlots reelsSlots ${spinning ? "spinning" : ""}`}>
              {displayGrid.flat().map((cell, i) => {
                const s = symbolCell(cell.name);
                return (
                  <div key={i} className="cellSlots">
                    <div className={`symbolSlots ${s.cls}`}>{s.inner}</div>
                  </div>
                );
              })}
            </div>

            <aside className="panelSlots multPanel">
              {MULTS.map(m => (
                <div key={m} className={`multChip ${m === activeMult ? "active" : ""}`}>x{m}</div>
              ))}
            </aside>
          </section>

          <section className="bottomSlots">
            <div className="panelSlots bottomPanel">
              <div className="bottomLabel">Balance</div>
              <div className="bottomVal">{parseFloat(balance).toFixed(dec)} {SHORT[currency]}</div>
            </div>

            <div className="panelSlots bottomPanel betPanel">
              <button className="betBtn" onClick={halfBet}>−</button>
              <div>
                <div className="bottomLabel">Bet</div>
                <input
                  type="number"
                  min={BC.inputMin(currency)}
                  step={BC.stepSize(currency)}
                  value={betAmount}
                  onChange={e => setBetAmount(v => BC.normalizeBetInput(e.target.value, currency, v))}
                  className="betInput"
                />
              </div>
              <button className="betBtn" onClick={doubleBet}>+</button>
            </div>

            <div className="centerSpin"><button className="spinBtn" disabled={spinning} onClick={spin}>↻</button></div>

            <div className="panelSlots bottomPanel autoPanel" onClick={maxBet}>
              <div className="bottomLabel">Max Bet</div>
              <div className="bottomVal">Set</div>
            </div>

            <div className="panelSlots bottomPanel winPanel">
              <div className="bottomLabel">Win</div>
              <div className="bottomVal">{result?.won ? parseFloat(result.profit).toFixed(dec) : `0.${"0".repeat(dec)}`}</div>
              <div className="bottomLabel">{SHORT[currency]}</div>
            </div>
          </section>
        </div>

        {error && <div className="mt-2 text-red-400 font-mono text-sm">{error}</div>}
      </main>

      <div className="max-w-7xl mx-auto w-full px-4 pb-4">
        <BetHistory title="Slots History" bets={history} onLoadMore={() => setHistoryPage(p => p + 1)} />
      </div>

      <style jsx>{`
        .fitSlots{display:flex;align-items:center;justify-content:center}
        .gameSlots{width:min(1540px,100%);aspect-ratio:16/9;max-height:calc(100vh - 120px);position:relative;overflow:hidden;padding:12px;border-radius:18px;border:2px solid rgba(58,151,255,.8);background:linear-gradient(180deg,rgba(8,16,42,.97),rgba(5,7,22,.99));box-shadow:0 0 60px rgba(0,120,255,.36),inset 0 0 38px rgba(122,39,255,.24);display:grid;grid-template-rows:17% 63% 20%;gap:10px}
        .topSlots,.midSlots,.bottomSlots{display:grid;gap:10px;min-height:0}
        .topSlots{grid-template-columns:1fr 1.35fr 1fr}.midSlots{grid-template-columns:13% minmax(0,1fr) 10%}.bottomSlots{grid-template-columns:1.1fr 1.05fr .62fr .62fr 1.52fr}
        .panelSlots{border:2px solid rgba(62,145,255,.72);background:linear-gradient(180deg,rgba(13,25,65,.94),rgba(6,8,25,.96));box-shadow:inset 0 0 25px rgba(0,183,255,.12),0 0 18px rgba(43,132,255,.18);border-radius:12px}
        .cutLeft{clip-path:polygon(0 0,88% 0,100% 50%,88% 100%,0 100%,5% 50%);border-color:rgba(255,166,34,.78)}
        .cutRight{clip-path:polygon(12% 0,100% 0,95% 50%,100% 100%,12% 100%,0 50%);border-color:rgba(183,65,255,.85)}
        .jackpot,.topMulti{display:flex;flex-direction:column;justify-content:center;padding:0 20px}
        .topMulti{text-align:right;align-items:flex-end}
        .labelSlots{font-size:14px;font-weight:900;letter-spacing:.08em;color:#ffd15d;text-transform:uppercase}
        .amountSlots{font-size:36px;font-weight:900;color:#ffcf4b;text-shadow:0 0 17px rgba(255,176,0,.85)}
        .logoSlots{position:relative;border-color:rgba(0,198,255,.9);background:linear-gradient(180deg,#17366b,#090e2c);display:flex;align-items:center;justify-content:center;text-align:center;clip-path:polygon(10% 0,90% 0,100% 50%,90% 100%,10% 100%,0 50%)}
        .coinSlots{position:absolute;top:-18%;width:56px;aspect-ratio:1;border-radius:50%;display:grid;place-items:center;background:linear-gradient(135deg,#fff3a3,#f59b00 62%,#6f3300);border:4px solid #3b2200;color:#351900;font-size:34px;font-weight:900}
        .logoSlots h1{font-size:62px;line-height:.82;letter-spacing:.055em;background:linear-gradient(#fff,#d4defe 34%,#ffbe42 70%,#5b2600);-webkit-background-clip:text;color:transparent}
        .logoSlots p{margin-top:.18em;font-size:20px;font-weight:900;letter-spacing:.24em;color:#ffd45e}
        .leftInfo{display:grid;grid-template-rows:1fr 1fr;overflow:hidden}
        .infoBlock{display:flex;align-items:center;justify-content:center;text-align:center;flex-direction:column;border-bottom:1px solid rgba(104,94,255,.35)}
        .infoBlock:last-child{border:0}.purple{color:#e36aff}.green{color:#39ffad}.infoTitle{font-size:14px;font-weight:900;text-transform:uppercase}.infoNum{font-size:40px;font-weight:900}
        .reelsSlots{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));grid-template-rows:repeat(3,minmax(0,1fr));gap:3px;padding:5px}
        .cellSlots{display:grid;place-items:center;background:radial-gradient(circle,rgba(36,54,115,.7),rgba(3,7,25,.98));border:1px solid rgba(66,140,255,.46)}
        .symbolSlots{width:82%;aspect-ratio:1;display:grid;place-items:center;font-size:54px;font-weight:900}
        .coinSym{border-radius:50%;border:4px solid #ffd16a;background:radial-gradient(circle at 35% 24%,#fff1a2,#ffae10 48%,#8b4200);color:#3a1b00}
        .ethSym{border-radius:50%;border:4px solid #b95cff;background:radial-gradient(circle,rgba(139,84,255,.72),#101133 72%);color:#d9c8ff}
        .dogeSym{border-radius:50%;border:4px solid #ffbf63;background:radial-gradient(circle,#ffd269,#b95d00 68%);color:#4a1e00}
        .solSym{border-radius:50%;border:4px solid #25eaff;background:radial-gradient(circle,rgba(0,236,255,.28),#091031 72%);color:#7ff}
        .xrpSym{border-radius:50%;border:4px solid #ff63f3;background:radial-gradient(circle,rgba(255,69,236,.42),#140d31 72%);color:#ff8cf7}
        .multPanel{display:grid;grid-template-rows:repeat(8,minmax(0,1fr));gap:5px;padding:6px}
        .multChip{display:grid;place-items:center;border:2px solid #873bff;background:linear-gradient(180deg,#28134f,#080a24);border-radius:10px;clip-path:polygon(12% 0,88% 0,100% 50%,88% 100%,12% 100%,0 50%);font-size:23px;font-weight:900;color:#bd76ff}
        .multChip.active{color:#fff05d;border-color:#ffad3b;box-shadow:0 0 24px rgba(255,143,0,.8)}
        .bottomPanel{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:6px}
        .bottomLabel{font-size:12px;font-weight:900;text-transform:uppercase;color:#aebfff}.bottomVal{font-size:26px;font-weight:900;color:#eef4ff}
        .betPanel{display:flex;flex-direction:row;gap:9px}.betBtn{width:44px;height:44px;border:1px solid rgba(141,169,255,.6);border-radius:10px;background:linear-gradient(#374d9a,#111731);color:white;font-size:26px;font-weight:900}
        .betInput{width:150px;background:transparent;border:none;color:#fff;font-weight:900;font-size:28px;text-align:center}
        .centerSpin{display:grid;place-items:center}.spinBtn{width:92px;aspect-ratio:1;border-radius:50%;border:5px solid #67c7ff;background:radial-gradient(circle,#2469e8,#071026 72%);color:white;font-size:50px;cursor:pointer}
        .winPanel{border-color:#ffad3b;background:linear-gradient(180deg,#311a07,#13081c)}
        .autoPanel{cursor:pointer}
        .toastSlots{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:90px;font-weight:900;color:#fff25d;text-shadow:0 0 24px #ff8000,0 8px 0 #571500;opacity:0}
        .toastSlots.show{opacity:1;transition:opacity .2s}
        .spinning .symbolSlots{animation:spinBlur .1s linear infinite}
        @keyframes spinBlur{from{transform:translateY(-45%) scale(.9);filter:blur(3px);opacity:.45}to{transform:translateY(45%) scale(1.08);filter:blur(1px);opacity:1}}
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
