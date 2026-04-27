"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import Navbar from "@/components/Navbar";
import BetHistory from "@/components/BetHistory";
import { blackjackDeal, blackjackAction, getBalances, getBlackjackBetHistory } from "@/lib/api";
import * as BC from "@/lib/betConfig";

const CURRENCIES = ["USDT_POLYGON", "ETH_POLYGON", "USDT_TRON", "BTC"];
const SUIT_SYMBOLS = { hearts: "\u2665", diamonds: "\u2666", clubs: "\u2663", spades: "\u2660" };

function Card({ card, hidden = false, delay = 0, flipping = false }) {
  const [visible, setVisible] = useState(delay === 0);
  const [flipped, setFlipped] = useState(hidden);

  useEffect(() => {
    if (delay > 0) {
      const t = setTimeout(() => setVisible(true), delay);
      return () => clearTimeout(t);
    }
  }, [delay]);

  useEffect(() => {
    if (flipping && hidden) {
      const t = setTimeout(() => setFlipped(false), 400);
      return () => clearTimeout(t);
    }
    setFlipped(hidden);
  }, [hidden, flipping]);

  if (!visible) return <div className="w-16 h-24" />;

  const isRed = ["hearts", "diamonds"].includes(card?.suit);
  const suitChar = SUIT_SYMBOLS[card?.suit] || "";

  return (
    <div className={`transition-all duration-500 ${visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-8"}`}
      style={{ perspective: "600px" }}>
      <div className={`w-16 h-24 relative transition-transform duration-500`}
        style={{ transformStyle: "preserve-3d", transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}>
        {/* Front */}
        <div className="absolute inset-0 bg-white border-2 border-gray-200 rounded-lg flex flex-col items-center justify-center shadow-xl"
          style={{ backfaceVisibility: "hidden" }}>
          <span className={`text-xs font-black absolute top-1 left-1.5 ${isRed ? "text-red-600" : "text-gray-900"}`}>{card?.rank}</span>
          <span className={`text-2xl ${isRed ? "text-red-500" : "text-gray-800"}`}>{suitChar}</span>
          <span className={`text-xs font-black absolute bottom-1 right-1.5 rotate-180 ${isRed ? "text-red-600" : "text-gray-900"}`}>{card?.rank}</span>
        </div>
        {/* Back */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-800 via-blue-700 to-blue-900 border-2 border-blue-400/30 rounded-lg flex items-center justify-center shadow-xl"
          style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}>
          <div className="w-10 h-16 border border-blue-400/20 rounded bg-blue-900/50 flex items-center justify-center">
            <span className="text-blue-400/40 text-lg font-serif">&#9830;</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function HandDisplay({ cards, value, label, staggerDelay = 0, hideLast = false, flipping = false }) {
  return (
    <div className="text-center">
      <p className="text-xs text-green-400/70 font-mono uppercase tracking-widest mb-2">
        {label} {value !== null && value !== undefined ? <span className="text-green-300 font-bold">({value})</span> : ""}
      </p>
      <div className="flex gap-2 justify-center flex-wrap">
        {cards.map((card, i) => (
          <Card
            key={i}
            card={card}
            hidden={hideLast && i === cards.length - 1}
            delay={staggerDelay > 0 ? i * staggerDelay : 0}
            flipping={flipping && i === cards.length - 1}
          />
        ))}
      </div>
    </div>
  );
}

export default function BlackjackPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [currency, setCurrency]   = useState("USDT_POLYGON");
  const [betAmount, setBetAmount] = useState("1");
  const [error, setError]         = useState("");
  const [balances, setBalances]   = useState({});
  const [history, setHistory]     = useState([]);
  const [historyPage, setHistoryPage] = useState(0);

  const [phase, setPhase]               = useState("betting");
  const [gameId, setGameId]             = useState(null);
  const [playerCards, setPlayerCards]    = useState([]);
  const [dealerCards, setDealerCards]    = useState([]);
  const [dealerUpCard, setDealerUpCard] = useState(null);
  const [playerValue, setPlayerValue]   = useState(null);
  const [dealerValue, setDealerValue]   = useState(null);
  const [outcome, setOutcome]           = useState(null);
  const [profit, setProfit]             = useState(null);
  const [busy, setBusy]                 = useState(false);
  const [dealing, setDealing]           = useState(false);
  const [revealingDealer, setRevealingDealer] = useState(false);

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
      const data = await getBlackjackBetHistory(20, historyPage * 20);
      setHistory(prev => historyPage === 0 ? data.bets : [...prev, ...data.bets]);
    } catch {}
  }

  async function handleDeal() {
    setError("");
    setBusy(true);
    setDealing(true);
    setOutcome(null);
    setProfit(null);
    setDealerCards([]);
    setDealerUpCard(null);
    setDealerValue(null);
    setPlayerCards([]);
    setPlayerValue(null);
    setRevealingDealer(false);

    try {
      const data = await blackjackDeal({
        currency,
        betAmount: parseFloat(betAmount),
      });
      setGameId(data.gameId);
      setBalances(prev => ({ ...prev, [currency]: data.balance }));

      // Stagger cards with suspense
      setTimeout(() => {
        setDealerUpCard(data.finished ? null : data.dealerUpCard);
        if (data.finished) {
          setDealerCards(data.dealerCards);
        }
      }, 200);

      setTimeout(() => {
        setPlayerCards(data.playerCards);
        setPlayerValue(data.playerValue);
      }, 600);

      setTimeout(() => {
        setDealing(false);
        if (data.finished) {
          setDealerValue(data.dealerValue);
          setOutcome(data.outcome);
          setProfit(data.profit);
          setPhase("result");
          addToHistory(data);
        } else {
          setPhase("playing");
        }
        setBusy(false);
      }, 1800);
    } catch (err) {
      setError(err.message);
      setDealing(false);
      setBusy(false);
    }
  }

  async function handleAction(action) {
    setError("");
    setBusy(true);
    try {
      const data = await blackjackAction({ gameId, action });

      // Animate new card appearing
      setTimeout(() => {
        setPlayerCards(data.playerCards);
        setPlayerValue(data.playerValue);
      }, 300);

      if (data.finished) {
        // Reveal dealer hand with suspense
        setTimeout(() => {
          setRevealingDealer(true);
          setDealerCards(data.dealerCards);
          setDealerValue(data.dealerValue);
          setDealerUpCard(null);
        }, 800);

        setTimeout(() => {
          setOutcome(data.outcome);
          setProfit(data.profit);
          setPhase("result");
          setBalances(prev => data.balance !== undefined ? { ...prev, [currency]: data.balance } : prev);
          addToHistory(data);
          setBusy(false);
        }, 2000);
      } else {
        setTimeout(() => setBusy(false), 500);
      }
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  function addToHistory(data) {
    setHistory(prev => [{
      id: Date.now(),
      game: "blackjack",
      currency,
      bet_amount: parseFloat(betAmount),
      payout: data.payout || 0,
      profit: data.profit || 0,
      won: (data.multiplier || 0) > 1,
      multiplier: data.multiplier || 0,
      created_at: new Date().toISOString(),
    }, ...prev]);
  }

  function newGame() {
    setPhase("betting");
    setGameId(null);
    setPlayerCards([]);
    setDealerCards([]);
    setDealerUpCard(null);
    setPlayerValue(null);
    setDealerValue(null);
    setOutcome(null);
    setProfit(null);
    setRevealingDealer(false);
  }

  useEffect(() => { BC.fetchPrices(); }, []);
  useEffect(() => { setBetAmount(BC.defaultBet(currency)); }, [currency]);
  function halfBet()   { setBetAmount(v => BC.halfBet(v, currency)); }
  function doubleBet() { setBetAmount(v => BC.doubleBet(v, currency)); }
  function maxBet()    { setBetAmount(BC.maxBetAmount(currency, balances[currency])); }

  if (authLoading) return <LoadingScreen />;

  const outcomeLabels = {
    blackjack: "BLACKJACK!", win: "YOU WIN!", dealer_bust: "DEALER BUST!",
    push: "PUSH", bust: "BUST!", lose: "DEALER WINS", dealer_blackjack: "DEALER BLACKJACK",
  };
  const outcomeColors = {
    blackjack: "text-yellow-400", win: "text-green-400", dealer_bust: "text-green-400",
    push: "text-yellow-400", bust: "text-red-400", lose: "text-red-400", dealer_blackjack: "text-red-400",
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar balances={balances} activeCurrency={currency} onCurrencyChange={setCurrency} />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-3">

          {/* Card Table */}
          <div className="border-2 border-green-900/60 rounded-2xl p-6 min-h-[300px] flex flex-col items-center justify-center relative overflow-hidden shadow-2xl"
               style={{background:"radial-gradient(ellipse at center, #1a4a1a 0%, #0d2e0d 50%, #071507 100%)"}}>
            {/* Felt texture overlay */}
            <div className="absolute inset-0 opacity-10" style={{
              backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='40' height='40' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 0h40v40H0z' fill='none'/%3E%3Cpath d='M20 0v40M0 20h40' stroke='%23fff' stroke-width='0.5' opacity='0.1'/%3E%3C/svg%3E\")",
            }} />

            {/* Gold trim */}
            <div className="absolute inset-2 border border-gold/10 rounded-xl pointer-events-none" />

            {phase === "betting" && !dealing && (
              <div className="text-center relative z-10">
                <p className="text-4xl font-black tracking-wider" style={{
                  background: "linear-gradient(180deg, #d4af37 0%, #aa8a2e 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}>BLACKJACK</p>
                <p className="text-green-600/60 text-sm mt-2">Pays 3 to 2</p>
              </div>
            )}

            {dealing && playerCards.length === 0 && (
              <div className="text-center relative z-10">
                <div className="flex gap-3 justify-center mb-4">
                  {[0,1,2,3].map(i => (
                    <div key={i} className="w-16 h-24 bg-gradient-to-br from-blue-800 to-blue-900 border border-blue-400/20 rounded-lg animate-pulse shadow-lg"
                      style={{ animationDelay: `${i * 150}ms` }} />
                  ))}
                </div>
                <p className="text-gold/60 text-sm animate-pulse">Shuffling...</p>
              </div>
            )}

            {(phase === "playing" || phase === "result" || (dealing && playerCards.length > 0)) && (
              <div className="w-full space-y-6 relative z-10">
                {/* Dealer */}
                {phase === "playing" && dealerUpCard ? (
                  <div className="text-center">
                    <p className="text-xs text-green-400/70 font-mono uppercase tracking-widest mb-2">Dealer</p>
                    <div className="flex gap-2 justify-center">
                      <Card card={dealerUpCard} delay={200} />
                      <Card card={{}} hidden={true} delay={400} />
                    </div>
                  </div>
                ) : (phase === "result" || revealingDealer) && dealerCards.length > 0 ? (
                  <HandDisplay cards={dealerCards} value={dealerValue} label="Dealer" staggerDelay={300} />
                ) : null}

                <div className="border-t border-green-700/30 mx-8" />

                {/* Player */}
                <HandDisplay cards={playerCards} value={playerValue} label="Your Hand" staggerDelay={dealing ? 400 : 0} />

                {/* Outcome with animation */}
                {phase === "result" && outcome && (
                  <div className="text-center animate-[fadeIn_0.5s_ease-in]">
                    <p className={`text-3xl font-black ${outcomeColors[outcome] || "text-white"} drop-shadow-lg`}>
                      {outcomeLabels[outcome] || outcome}
                    </p>
                    {profit !== null && (
                      <p className={`text-lg font-mono mt-1 ${profit >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {profit >= 0 ? "+" : ""}{profit.toFixed(5)}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-3 py-2">{error}</div>
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
                    <span className="text-xs text-casino-muted font-mono uppercase tracking-widest">Currency</span>
                    <select value={currency} onChange={e => setCurrency(e.target.value)}
                      className="w-full bg-casino-surface border border-casino-border rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-gold/50">
                      {CURRENCIES.map(c => <option key={c} value={c}>{c.replace("_", " ")}</option>)}
                    </select>
                    <p className="text-xs text-casino-muted">BJ pays 3:2</p>
                  </div>
                </div>
                <button onClick={handleDeal} disabled={busy}
                  className="w-full py-3 rounded-xl font-bold text-sm transition-all bg-gradient-to-r from-green-700 to-green-600 text-white hover:shadow-lg hover:shadow-green-500/20 disabled:opacity-50 disabled:cursor-not-allowed">
                  {busy ? "Dealing..." : "DEAL"}
                </button>
              </>
            )}

            {phase === "playing" && (
              <div className="grid grid-cols-3 gap-2">
                <button onClick={() => handleAction("hit")} disabled={busy}
                  className="py-3 rounded-xl font-bold text-sm bg-gradient-to-b from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 text-white transition-all disabled:opacity-50 shadow-lg">
                  HIT
                </button>
                <button onClick={() => handleAction("stand")} disabled={busy}
                  className="py-3 rounded-xl font-bold text-sm bg-gradient-to-b from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white transition-all disabled:opacity-50 shadow-lg">
                  STAND
                </button>
                <button onClick={() => handleAction("double")} disabled={busy}
                  className="py-3 rounded-xl font-bold text-sm bg-gradient-to-b from-yellow-600 to-yellow-700 hover:from-yellow-500 hover:to-yellow-600 text-white transition-all disabled:opacity-50 shadow-lg">
                  DOUBLE
                </button>
              </div>
            )}

            {phase === "result" && (
              <button onClick={newGame}
                className="w-full py-3 rounded-xl font-bold text-sm transition-all bg-gradient-to-r from-gold to-yellow-500 text-black hover:shadow-lg hover:shadow-gold/20">
                New Hand
              </button>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <BetHistory title="Blackjack History" bets={history} onLoadMore={() => setHistoryPage(p => p + 1)} />
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
