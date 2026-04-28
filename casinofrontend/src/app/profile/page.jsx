"use client";
import { useEffect, useState } from "react";
import Navbar from "@/components/Navbar";
import {
  getBalances,
  getProfile,
  getMyReferral,
  createReferral,
  getSeeds,
  setClientSeed,
  rotateServerSeed,
} from "@/lib/api";

export default function ProfilePage() {
  const [balances, setBalances] = useState({});
  const [profile, setProfile] = useState(null);
  const [referral, setReferral] = useState(null);
  const [seeds, setSeeds] = useState({});
  const [seedInputs, setSeedInputs] = useState({});
  const [error, setError] = useState("");

  async function loadAll() {
    try {
      setError("");
      const [b, p, r, s] = await Promise.all([
        getBalances(),
        getProfile(),
        getMyReferral().catch(() => ({ referral: null })),
        getSeeds(),
      ]);
      setBalances(Object.fromEntries(Object.entries(b.balances).map(([k, v]) => [k, v.balance])));
      setProfile(p);
      setReferral(r.referral || null);
      setSeeds(s.seeds || {});
      setSeedInputs(Object.fromEntries(Object.entries(s.seeds || {}).map(([k, v]) => [k, v.clientSeed])));
    } catch (err) {
      setError(err.message || "Failed to load profile");
    }
  }

  useEffect(() => { loadAll(); }, []);

  async function handleCreateReferral() {
    try {
      const res = await createReferral();
      if (!res.code) {
        setError(res.warning || "Referral system is not initialized yet");
        return;
      }
      setReferral({ ...(referral || {}), code: res.code });
    } catch (err) {
      setError(err.message || "Failed to create referral code");
    }
  }

  async function handleUpdateSeed(currency) {
    await setClientSeed(currency, seedInputs[currency] || "default-seed");
    await loadAll();
  }

  async function handleRotate(currency) {
    await rotateServerSeed(currency);
    await loadAll();
  }

  return (
    <div className="min-h-screen">
      <Navbar balances={balances} activeCurrency="USDT" />
      <main className="max-w-6xl mx-auto p-4 space-y-4">
        <h1 className="text-2xl font-display">Profile</h1>
        {error && <p className="text-red-400 text-sm">{error}</p>}
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

        <section className="bg-casino-card border border-casino-border rounded-xl p-4">
          <h2 className="font-semibold mb-2">Provably fair seeds</h2>
          <p className="text-xs text-casino-muted mb-3">Use client seed updates + server seed rotation to verify fairness.</p>
          <div className="space-y-3">
            {Object.entries(seeds).map(([currency, seed]) => (
              <div key={currency} className="border border-casino-border rounded-lg p-3">
                <p className="font-mono text-sm mb-1">{currency}</p>
                <p className="text-xs text-casino-muted break-all">Server seed hash: {seed.serverSeedHash}</p>
                <p className="text-xs text-casino-muted mb-2">Nonce: {seed.nonce}</p>
                <div className="flex flex-col md:flex-row gap-2">
                  <input
                    value={seedInputs[currency] || ""}
                    onChange={(e) => setSeedInputs((prev) => ({ ...prev, [currency]: e.target.value }))}
                    className="flex-1 bg-casino-surface border border-casino-border px-2 py-1 rounded"
                    placeholder="Client seed"
                  />
                  <button className="btn-gold px-3 py-1" onClick={() => handleUpdateSeed(currency)}>Update client seed</button>
                  <button className="px-3 py-1 border border-casino-border rounded" onClick={() => handleRotate(currency)}>Rotate server seed</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function Card({ title, value }) {
  return <div className="bg-casino-card border border-casino-border rounded-xl p-3"><p className="text-xs text-casino-muted">{title}</p><p className="text-xl">{value}</p></div>;
}
