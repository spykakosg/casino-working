"use client";
import { useEffect, useState } from "react";
import Navbar from "@/components/Navbar";
import { getBalances, getLeaderboard } from "@/lib/api";

export default function LeaderboardPage() {
  const [balances, setBalances] = useState({});
  const [period, setPeriod] = useState("all");
  const [rows, setRows] = useState([]);

  useEffect(() => {
    getBalances().then((b) => {
      setBalances(Object.fromEntries(Object.entries(b.balances).map(([k, v]) => [k, v.balance])));
    });
  }, []);

  useEffect(() => {
    getLeaderboard(period, "wagered").then((d) => setRows(d.leaderboard));
  }, [period]);

  return (
    <div className="min-h-screen">
      <Navbar balances={balances} activeCurrency="USDT" />
      <main className="max-w-4xl mx-auto p-4">
        <h1 className="text-2xl font-display mb-3">Leaderboard — Top Wagerers</h1>
        <div className="flex gap-2 mb-3">
          <select className="bg-casino-card border border-casino-border p-2" value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="all">All-time</option>
          </select>
        </div>
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="bg-casino-card border border-casino-border p-3 rounded-lg flex justify-between">
              <span>#{r.rank} {r.username}</span>
              <span>{Number(r.value).toFixed(4)}</span>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
