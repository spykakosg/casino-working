"use client";
import { useState } from "react";
import { verifyProvablyFair } from "@/lib/api";

export default function ProvablyFairPage() {
  const [serverSeed, setServerSeed] = useState("");
  const [clientSeed, setClientSeed] = useState("");
  const [nonce, setNonce] = useState("0");
  const [result, setResult] = useState(null);

  async function run() {
    const data = await verifyProvablyFair(serverSeed, clientSeed, nonce);
    setResult(data);
  }

  return (
    <main className="min-h-screen max-w-2xl mx-auto p-4 space-y-3">
      <h1 className="text-2xl font-display">Provably Fair Verification</h1>
      <input className="w-full p-2 bg-casino-card border border-casino-border" placeholder="Server seed" value={serverSeed} onChange={(e)=>setServerSeed(e.target.value)} />
      <input className="w-full p-2 bg-casino-card border border-casino-border" placeholder="Client seed" value={clientSeed} onChange={(e)=>setClientSeed(e.target.value)} />
      <input className="w-full p-2 bg-casino-card border border-casino-border" placeholder="Nonce" value={nonce} onChange={(e)=>setNonce(e.target.value)} />
      <button className="btn-gold px-4 py-2" onClick={run}>Verify</button>
      {result && <pre className="bg-casino-card border border-casino-border p-3 rounded">{JSON.stringify(result, null, 2)}</pre>}
    </main>
  );
}
