"use client";
import { useEffect, useState } from "react";
import Navbar from "@/components/Navbar";
import {
  getBalances,
  getProfile,
  getMyReferral,
  createReferral,
  getReferralStats,
  getSeeds,
  setClientSeed,
  rotateServerSeed,
  changePassword,
} from "@/lib/api";

function randomSeed() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default function AccountPage() {
  const [balances, setBalances] = useState({});
  const [profile, setProfile] = useState(null);
  const [referral, setReferral] = useState(null);
  const [seeds, setSeeds] = useState({});
  const [seedInputs, setSeedInputs] = useState({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "" });
  const [affiliateStats, setAffiliateStats] = useState({ totals: { referees: 0, totalWagered: 0, totalCommission: 0 }, affiliates: [] });

  async function loadAll() {
    try {
      setError("");
      const [b, p, r, stats, s] = await Promise.all([
        getBalances(),
        getProfile(),
        getMyReferral(),
        getReferralStats(),
        getSeeds(),
      ]);
      setBalances(Object.fromEntries(Object.entries(b.balances).map(([k, v]) => [k, v.balance])));
      setProfile(p);
      setReferral(r.referral || (stats.code ? { code: stats.code } : null));
      setAffiliateStats(stats || { totals: { referees: 0, totalWagered: 0, totalCommission: 0 }, affiliates: [] });
      setSeeds(s.seeds || {});
      setSeedInputs(Object.fromEntries(Object.entries(s.seeds || {}).map(([k, v]) => [k, v.clientSeed])));
    } catch (err) {
      setError(err.message || "Failed to load account");
    }
  }

  useEffect(() => { loadAll(); }, []);

  async function handleCreateReferral() {
    try {
      const res = await createReferral();
      if (!res.code) throw new Error("Could not generate referral code");
      setReferral({ ...(referral || {}), code: res.code });
      setNotice("Affiliate code generated.");
    } catch (err) {
      setError(err.message || "Failed to create referral code");
    }
  }

  async function handleUpdateSeed(currency) {
    try {
      await setClientSeed(currency, seedInputs[currency] || randomSeed());
      await loadAll();
      setNotice(`Client seed updated for ${currency}.`);
    } catch (err) {
      setError(err.message || "Failed to update client seed");
    }
  }

  async function handleRotate(currency) {
    try {
      const data = await rotateServerSeed(currency);
      await loadAll();
      setNotice(`Server seed rotated for ${currency}. Old seed revealed: ${data.revealedServerSeed?.slice(0, 12)}...`);
    } catch (err) {
      setError(err.message || "Failed to rotate server seed");
    }
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    try {
      await changePassword(passwordForm.currentPassword, passwordForm.newPassword);
      setPasswordForm({ currentPassword: "", newPassword: "" });
      setNotice("Password changed successfully.");
    } catch (err) {
      setError(err.message || "Failed to change password");
    }
  }

  return (
    <div className="min-h-screen">
      <Navbar balances={balances} activeCurrency="USDT" />
      <main className="max-w-6xl mx-auto p-4 space-y-4">
        <h1 className="text-2xl font-display">Account</h1>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        {notice && <p className="text-green-400 text-sm">{notice}</p>}

        {profile && (
          <div className="grid md:grid-cols-4 gap-3">
            <Card title="Total Bets" value={profile.stats.totalBets} />
            <Card title="Total Wagered" value={profile.stats.totalWagered} />
            <Card title="Net Profit" value={profile.stats.netProfit} />
            <Card title="Win Rate" value={`${profile.stats.winRate}%`} />
          </div>
        )}

        <section className="bg-casino-card border border-casino-border rounded-xl p-4">
          <h2 className="font-semibold mb-2">Affiliate</h2>
          <p className="text-sm text-casino-muted">Code: {referral?.code || "Generating..."}</p>
          <button onClick={handleCreateReferral} className="btn-gold mt-2 px-4 py-2">Get my affiliate code</button>
          <div className="grid md:grid-cols-3 gap-2 mt-3 text-sm font-mono">
            <div className="bg-casino-surface rounded p-2"><span className="text-casino-muted text-xs">Referees</span><div>{affiliateStats.totals.referees}</div></div>
            <div className="bg-casino-surface rounded p-2"><span className="text-casino-muted text-xs">Total Wagered</span><div>{Number(affiliateStats.totals.totalWagered || 0).toFixed(4)}</div></div>
            <div className="bg-casino-surface rounded p-2"><span className="text-casino-muted text-xs">Total Commission</span><div>{Number(affiliateStats.totals.totalCommission || 0).toFixed(8)}</div></div>
          </div>
          <div className="mt-3 space-y-1">
            {affiliateStats.affiliates.length === 0 ? (
              <p className="text-xs text-casino-muted">No affiliates yet.</p>
            ) : affiliateStats.affiliates.map((a) => (
              <div key={a.id} className="text-xs font-mono bg-casino-surface rounded px-2 py-1 flex justify-between">
                <span>{a.username}</span>
                <span>Wagered: {a.wagered.toFixed(4)} | Commission: {a.commission.toFixed(8)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-casino-card border border-casino-border rounded-xl p-4">
          <h2 className="font-semibold mb-2">Provably fair seeds</h2>
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
                  <button className="btn-gold px-3 py-1" onClick={() => handleUpdateSeed(currency)}>Save client seed</button>
                  <button className="px-3 py-1 border border-casino-border rounded" onClick={() => setSeedInputs((prev)=>({ ...prev, [currency]: randomSeed() }))}>Generate seed</button>
                  <button className="px-3 py-1 border border-casino-border rounded" onClick={() => handleRotate(currency)}>Rotate server seed</button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-casino-card border border-casino-border rounded-xl p-4">
          <h2 className="font-semibold mb-2">Change password</h2>
          <form className="space-y-2" onSubmit={handleChangePassword}>
            <input type="password" className="w-full bg-casino-surface border border-casino-border px-3 py-2 rounded" placeholder="Current password" value={passwordForm.currentPassword} onChange={(e)=>setPasswordForm((p)=>({ ...p, currentPassword: e.target.value }))} />
            <input type="password" className="w-full bg-casino-surface border border-casino-border px-3 py-2 rounded" placeholder="New password (min 8 chars)" value={passwordForm.newPassword} onChange={(e)=>setPasswordForm((p)=>({ ...p, newPassword: e.target.value }))} />
            <button className="btn-gold px-4 py-2" type="submit">Update password</button>
          </form>
        </section>
      </main>
    </div>
  );
}

function Card({ title, value }) {
  return <div className="bg-casino-card border border-casino-border rounded-xl p-3"><p className="text-xs text-casino-muted">{title}</p><p className="text-xl">{value}</p></div>;
}
