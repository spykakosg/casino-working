"use client";
import { useEffect, useState } from "react";
import Navbar from "@/components/Navbar";
import { getBalances, getProfile, getMyReferral, createReferral } from "@/lib/api";

export default function ProfilePage() {
  const [balances, setBalances] = useState({});
  const [profile, setProfile] = useState(null);
  const [referral, setReferral] = useState(null);

  useEffect(() => {
    (async () => {
      const b = await getBalances();
      const p = await getProfile();
      const r = await getMyReferral();
      setBalances(Object.fromEntries(Object.entries(b.balances).map(([k,v]) => [k, v.balance])));
      setProfile(p);
      setReferral(r.referral);
    })();
  }, []);

  async function handleCreateReferral() {
    const res = await createReferral();
    setReferral({ ...(referral || {}), code: res.code });
  }

  return (
    <div className="min-h-screen">
      <Navbar balances={balances} activeCurrency="USDT" />
      <main className="max-w-6xl mx-auto p-4 space-y-4">
        <h1 className="text-2xl font-display">Profile</h1>
        {profile && (
          <div className="grid md:grid-cols-4 gap-3">
            <Card title="Total Bets" value={profile.stats.totalBets} />
            <Card title="Total Wagered" value={profile.stats.totalWagered} />
            <Card title="Net Profit" value={profile.stats.netProfit} />
            <Card title="Win Rate" value={`${profile.stats.winRate}%`} />
          </div>
        )}
        <section className="bg-casino-card border border-casino-border rounded-xl p-4">
          <h2 className="font-semibold mb-2">Referral</h2>
          <p className="text-sm text-casino-muted">Code: {referral?.code || "Not created"}</p>
          <button onClick={handleCreateReferral} className="btn-gold mt-2 px-4 py-2">Generate invite code</button>
        </section>
      </main>
    </div>
  );
}

function Card({ title, value }) {
  return <div className="bg-casino-card border border-casino-border rounded-xl p-3"><p className="text-xs text-casino-muted">{title}</p><p className="text-xl">{value}</p></div>;
}
