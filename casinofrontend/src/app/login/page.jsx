"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { login } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);
  const { setUser } = useAuth();
  const router = useRouter();

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await login(username, password);
      setUser(data.user);
      router.push("/game/dice");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      {/* Background grid lines */}
      <div className="fixed inset-0 opacity-5 pointer-events-none"
        style={{backgroundImage:"linear-gradient(var(--border) 1px,transparent 1px),linear-gradient(90deg,var(--border) 1px,transparent 1px)",backgroundSize:"60px 60px"}} />

      <div className="w-full max-w-sm animate-fade-up">
        {/* Logo */}
        <div className="text-center mb-10">
          <h1 className="font-display text-6xl text-gold-gradient tracking-widest">CASINOX</h1>
          <p className="text-casino-muted text-sm mt-2 font-mono tracking-wider">PROVABLY FAIR</p>
        </div>

        <div className="bg-casino-card border border-casino-border rounded-2xl p-8 glow-gold">
          <h2 className="text-xl font-semibold mb-6">Sign In</h2>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3 mb-5">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs text-casino-muted font-mono uppercase tracking-widest block mb-2">Username</label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="w-full bg-casino-surface border border-casino-border rounded-lg px-4 py-3 text-white placeholder-casino-muted focus:outline-none focus:border-gold transition-colors font-mono"
                placeholder="your_username"
                required
              />
            </div>
            <div>
              <label className="text-xs text-casino-muted font-mono uppercase tracking-widest block mb-2">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full bg-casino-surface border border-casino-border rounded-lg px-4 py-3 text-white placeholder-casino-muted focus:outline-none focus:border-gold transition-colors font-mono"
                placeholder="••••••••"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-gold w-full py-3 text-sm font-mono uppercase tracking-widest mt-2"
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>

          <p className="text-center text-casino-muted text-sm mt-6">
            No account?{" "}
            <Link href="/register" className="text-gold hover:text-gold-light transition-colors">
              Register
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
