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

function BetRow({ bet }) {
  const amount = parseFloat(bet.betAmount ?? bet.bet_amount);
  const payout = parseFloat(bet.payout || 0);
  const profit = bet.profit !== undefined && bet.profit !== null ? parseFloat(bet.profit) : payout - amount;
  const roll = typeof bet.roll === "number" ? bet.roll : parseFloat(bet.roll);
  const isPush = Math.abs(profit) < 0.0001;
  const isWin = profit > 0.0001;
  const ccy = bet.currency || "";
  const isCrypto = ccy === "BTC" || ccy === "ETH_POLYGON";
  const dec = isCrypto ? 10 : 5;
  function fmt(v) { return v.toFixed(dec); }
  return (
    <div className={`px-4 py-3 flex items-center gap-3 hover:bg-casino-surface/50 transition-colors ${
      isWin ? "border-l-2 border-green-500/40" : isPush ? "border-l-2 border-yellow-500/30" : "border-l-2 border-red-500/20"
    }`}>
      {/* Roll */}
      <div className={`font-mono font-bold text-sm w-12 shrink-0 ${isWin ? "text-green-400" : isPush ? "text-yellow-400" : "text-red-400"}`}>
        {!isNaN(roll) ? roll.toFixed(2) : "—"}
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <div className="text-xs text-casino-muted font-mono truncate">
          {bet.direction} {bet.target} · {bet.multiplier}×
        </div>
        <div className="text-xs text-casino-muted/60 font-mono">
          {fmt(amount)} → {fmt(payout)}
        </div>
      </div>

      {/* Profit */}
      <div className={`text-xs font-mono font-semibold shrink-0 ${
        isWin ? "text-green-400" : isPush ? "text-yellow-400" : "text-red-400"
      }`}>
        {isPush ? fmt(0) : isWin ? `+${fmt(profit)}` : fmt(profit)}
      </div>
    </div>
  );
}
