-- ============================================================
-- Crash Game Schema — run this after schema.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS crash_rounds (
  id               SERIAL PRIMARY KEY,
  server_seed      TEXT,               -- revealed after crash
  server_seed_hash TEXT NOT NULL,      -- shown before round starts
  crash_point      NUMERIC(10, 2),     -- filled after crash
  status           VARCHAR(16) NOT NULL DEFAULT 'waiting', -- waiting|running|crashed
  started_at       TIMESTAMPTZ,
  crashed_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crash_rounds_status ON crash_rounds(status);
CREATE INDEX IF NOT EXISTS idx_crash_rounds_created ON crash_rounds(created_at DESC);

CREATE TABLE IF NOT EXISTS crash_bets (
  id           BIGSERIAL PRIMARY KEY,
  round_id     INTEGER NOT NULL REFERENCES crash_rounds(id),
  user_id      INTEGER NOT NULL REFERENCES users(id),
  currency     VARCHAR(20) NOT NULL,
  bet_amount   NUMERIC(28, 8) NOT NULL,
  auto_cashout NUMERIC(10, 2),         -- null = manual cashout
  cashout_at   NUMERIC(10, 2),         -- multiplier when cashed out
  payout       NUMERIC(28, 8) NOT NULL DEFAULT 0,
  won          BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crash_bets_user   ON crash_bets(user_id);
CREATE INDEX IF NOT EXISTS idx_crash_bets_round  ON crash_bets(round_id);
