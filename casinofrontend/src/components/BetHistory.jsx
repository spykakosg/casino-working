"use client";

export default function BetHistory({ history, bets, title, currency, onLoadMore }) {
  const items = history || bets || [];
  return (
    <div className="bg-casino-card border border-casino-border rounded-2xl overflow-hidden h-full flex flex-col">
      <div className="px-4 py-3 border-b border-casino-border flex items-center justify-between">
        <h3 className="text-sm font-mono uppercase tracking-widest text-casino-muted">{title || "Bet History"}</h3>
        <span className="text-xs text-casino-muted">{items.length} bets</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-casino-muted text-sm font-mono">
            No bets yet
          </div>
        ) : (
          <div className="divide-y divide-casino-border">
            {items.map((bet, i) => (
              <BetRow key={bet.id ?? i} bet={bet} />
            ))}
          </div>
        )}
      </div>

      {items.length >= 20 && (
        <div className="p-3 border-t border-casino-border">
          <button
            onClick={onLoadMore}
            className="w-full text-casino-muted text-xs font-mono hover:text-white transition-colors py-1"
          >
            Load more
          </button>
        </div>
      )}
    </div>
  );
}

function readNum(...values) {
  for (const value of values) {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return 0;
}

function BetRow({ bet }) {
  const amount = readNum(bet.betAmount, bet.bet_amount, bet.amount, bet.stake);
  const payout = readNum(bet.payout, bet.winAmount, bet.win_amount, bet.cashout);
  const profit = readNum(bet.profit, payout - amount);
  const roll = readNum(bet.roll, bet.result);
  const game = bet.game || "";
  const isPush = Math.abs(profit) < 0.00000001;
  const isWin = profit > 0;
  const ccy = bet.currency || "";
  const isCrypto = ["BTC", "ETH", "ETH_POLYGON"].includes(ccy);

  function fmt(v) {
    if (!Number.isFinite(v)) return "0";
    const abs = Math.abs(v);
    const dec = isCrypto ? 8 : abs > 0 && abs < 0.0001 ? 8 : abs > 0 && abs < 1 ? 6 : 4;
    return v.toFixed(dec).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  }

  return (
    <div className={`px-4 py-3 flex items-center gap-3 hover:bg-casino-surface/50 transition-colors ${
      isWin ? "border-l-2 border-green-500/40" : isPush ? "border-l-2 border-yellow-500/30" : "border-l-2 border-red-500/20"
    }`}>
      <div className={`font-mono font-bold text-sm w-12 shrink-0 ${isWin ? "text-green-400" : isPush ? "text-yellow-400" : "text-red-400"}`}>
        {game === "plinko"
          ? `${readNum(bet.multiplier).toFixed(2)}×`
          : (Number.isFinite(roll) ? roll.toFixed(2) : "—")}
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-xs text-casino-muted font-mono truncate">
          {game === "plinko"
            ? `plinko · bucket ${bet.bucket ?? "?"}`
            : `${bet.direction || "—"} ${bet.target ?? "—"} · ${readNum(bet.multiplier).toFixed(2)}×`}
        </div>
        <div className="text-xs text-casino-muted/60 font-mono">
          {fmt(amount)} → {fmt(payout)}
        </div>
      </div>

      <div className={`text-xs font-mono font-semibold shrink-0 ${
        isWin ? "text-green-400" : isPush ? "text-yellow-400" : "text-red-400"
      }`}>
        {isPush ? fmt(0) : isWin ? `+${fmt(profit)}` : fmt(profit)}
      </div>
    </div>
  );
}
