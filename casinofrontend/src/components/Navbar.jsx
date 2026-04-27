"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

const CURRENCY_SYMBOLS = {
  USDT_POLYGON: "USDT",
  ETH_POLYGON:  "ETH",
  USDT_TRON:    "USDT₮",
  BTC:          "BTC",
};

export default function Navbar({ balances = {}, activeCurrency, onCurrencyChange }) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  function handleLogout() {
    logout();
    router.push("/login");
  }

  const balance = balances[activeCurrency] ?? 0;
  const isCrypto = activeCurrency === "BTC" || activeCurrency === "ETH_POLYGON";
  const balanceDecimals = isCrypto ? 10 : 5;

  return (
    <header className="border-b border-casino-border bg-casino-surface/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-4">

        {/* Logo */}
        <Link href="/game/dice" className="font-display text-2xl text-gold-gradient tracking-widest shrink-0">
          CASINOX
        </Link>

        {/* Nav links */}
        <nav className="hidden md:flex items-center gap-1">
          <NavLink href="/game/dice" active={pathname === "/game/dice"}>🎲 Dice</NavLink>
          <NavLink href="/game/crash" active={pathname === "/game/crash"}>🚀 Crash</NavLink>
          <NavLink href="/game/roulette" active={pathname === "/game/roulette"}>🎰 Roulette</NavLink>
          <NavLink href="/game/blackjack" active={pathname === "/game/blackjack"}>🃏 Blackjack</NavLink>
          <NavLink href="/game/plinko" active={pathname === "/game/plinko"}>📍 Plinko</NavLink>
          <NavLink href="/game/mines" active={pathname === "/game/mines"}>💣 Mines</NavLink>
          <NavLink href="/game/limbo" active={pathname === "/game/limbo"}>🎯 Limbo</NavLink>
          <NavLink href="/game/slots" active={pathname === "/game/slots"}>🎰 Slots</NavLink>
          <NavLink href="/wallet" active={pathname === "/wallet"}>💼 Wallet</NavLink>
          {user?.role === "admin" && (
            <NavLink href="/admin" active={pathname === "/admin"}>🛡️ Admin</NavLink>
          )}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {/* Balance */}
          <div className="bg-casino-card border border-casino-border rounded-lg px-3 py-1.5 flex items-center gap-2">
            <select
              value={activeCurrency}
              onChange={e => onCurrencyChange?.(e.target.value)}
              className="bg-transparent text-casino-muted text-xs font-mono focus:outline-none cursor-pointer"
            >
              {Object.keys(CURRENCY_SYMBOLS).map(c => (
                <option key={c} value={c}>{CURRENCY_SYMBOLS[c]}</option>
              ))}
            </select>
            <span className="text-white font-mono text-sm font-medium">
              {balance.toFixed(balanceDecimals)}
            </span>
          </div>

          {/* Username */}
          <span className="text-casino-muted text-sm font-mono hidden sm:block">
            {user?.username}
          </span>

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="text-casino-muted hover:text-white text-sm transition-colors"
          >
            ⎋
          </button>
        </div>
      </div>

      {/* Mobile nav */}
      <div className="md:hidden flex border-t border-casino-border">
        <MobileNavLink href="/game/dice" active={pathname === "/game/dice"}>🎲 Dice</MobileNavLink>
        <MobileNavLink href="/game/crash" active={pathname === "/game/crash"}>🚀 Crash</MobileNavLink>
        <MobileNavLink href="/game/roulette" active={pathname === "/game/roulette"}>🎰 Roulette</MobileNavLink>
        <MobileNavLink href="/game/blackjack" active={pathname === "/game/blackjack"}>🃏 Blackjack</MobileNavLink>
        <MobileNavLink href="/game/plinko" active={pathname === "/game/plinko"}>📍 Plinko</MobileNavLink>
        <MobileNavLink href="/game/mines" active={pathname === "/game/mines"}>💣 Mines</MobileNavLink>
        <MobileNavLink href="/game/limbo" active={pathname === "/game/limbo"}>🎯 Limbo</MobileNavLink>
        <MobileNavLink href="/game/slots" active={pathname === "/game/slots"}>🎰 Slots</MobileNavLink>
        <MobileNavLink href="/wallet" active={pathname === "/wallet"}>💼 Wallet</MobileNavLink>
        {user?.role === "admin" && (
          <MobileNavLink href="/admin" active={pathname === "/admin"}>🛡️ Admin</MobileNavLink>
        )}
      </div>
    </header>
  );
}

function NavLink({ href, active, children }) {
  return (
    <Link
      href={href}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
        active
          ? "bg-gold/10 text-gold"
          : "text-casino-muted hover:text-white"
      }`}
    >
      {children}
    </Link>
  );
}

function MobileNavLink({ href, active, children }) {
  return (
    <Link
      href={href}
      className={`flex-1 text-center py-2.5 text-sm transition-colors ${
        active ? "text-gold border-b-2 border-gold" : "text-casino-muted"
      }`}
    >
      {children}
    </Link>
  );
}
