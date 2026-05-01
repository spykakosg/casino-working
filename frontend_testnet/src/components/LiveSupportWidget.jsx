"use client";

import { useState } from "react";

export default function LiveSupportWidget() {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {open && (
        <div className="mb-2 w-72 rounded-xl border border-casino-border bg-casino-card p-3 shadow-xl">
          <h3 className="text-sm font-semibold mb-1">Live chat / support</h3>
          <p className="text-xs text-casino-muted mb-3">Agents are available 24/7.</p>
          <div className="space-y-2 text-sm">
            <a className="block text-gold hover:underline" href="mailto:support@casinox.local">Email support</a>
            <a className="block text-gold hover:underline" href="https://t.me" target="_blank">Telegram support</a>
          </div>
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-full bg-gold text-black font-semibold px-4 py-2 shadow-lg"
      >
        {open ? "Close" : "Support"}
      </button>
    </div>
  );
}
