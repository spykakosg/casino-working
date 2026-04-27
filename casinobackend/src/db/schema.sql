-- ============================================================
-- Crypto Casino — PostgreSQL Schema
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(32) UNIQUE NOT NULL,
  email         VARCHAR(255) UNIQUE,
  password_hash TEXT NOT NULL,
  role          VARCHAR(16) NOT NULL DEFAULT 'player', -- player | admin
  is_banned     BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);

-- ============================================================
-- WALLETS (one row per user per currency)
-- ============================================================
CREATE TABLE wallets (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency      VARCHAR(20) NOT NULL,  -- USDT_POLYGON | ETH_POLYGON | USDT_TRON | BTC

  -- Internal balance (off-chain)
  balance       NUMERIC(28, 8) NOT NULL DEFAULT 0 CHECK (balance >= 0),

  -- Provably fair seeds
  server_seed   TEXT NOT NULL,         -- secret, never exposed during play
  client_seed   TEXT NOT NULL,         -- user-chosen, defaults to random
  nonce         INTEGER NOT NULL DEFAULT 0,

  -- Deposit address (unique per user per currency)
  deposit_address TEXT UNIQUE,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (user_id, currency)
);

CREATE INDEX idx_wallets_user ON wallets(user_id);
CREATE INDEX idx_wallets_deposit_address ON wallets(deposit_address);

-- ============================================================
-- DEPOSITS (on-chain transactions credited to internal balance)
-- ============================================================
CREATE TABLE deposits (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  currency      VARCHAR(20) NOT NULL,
  amount        NUMERIC(28, 8) NOT NULL,
  tx_hash       TEXT UNIQUE NOT NULL,   -- blockchain tx hash
  from_address  TEXT NOT NULL,
  to_address    TEXT NOT NULL,
  confirmations INTEGER NOT NULL DEFAULT 0,
  status        VARCHAR(16) NOT NULL DEFAULT 'pending', -- pending | confirmed | failed
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at  TIMESTAMPTZ
);

CREATE INDEX idx_deposits_user ON deposits(user_id);
CREATE INDEX idx_deposits_tx_hash ON deposits(tx_hash);
CREATE INDEX idx_deposits_status ON deposits(status);

-- ============================================================
-- WITHDRAWALS
-- ============================================================
CREATE TABLE withdrawals (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  currency        VARCHAR(20) NOT NULL,
  amount          NUMERIC(28, 8) NOT NULL,
  fee             NUMERIC(28, 8) NOT NULL DEFAULT 0,
  to_address      TEXT NOT NULL,
  tx_hash         TEXT UNIQUE,          -- filled when sent
  status          VARCHAR(16) NOT NULL DEFAULT 'pending', -- pending | processing | sent | failed
  review_required BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at    TIMESTAMPTZ
);

CREATE INDEX idx_withdrawals_user ON withdrawals(user_id);
CREATE INDEX idx_withdrawals_status ON withdrawals(status);

-- ============================================================
-- BETS
-- ============================================================
CREATE TABLE bets (
  id               BIGSERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id),
  currency         VARCHAR(20) NOT NULL,
  game             VARCHAR(32) NOT NULL,  -- dice | crash | slots | roulette

  -- Amounts
  bet_amount       NUMERIC(28, 8) NOT NULL,
  payout           NUMERIC(28, 8) NOT NULL,
  profit           NUMERIC(28, 8) NOT NULL,  -- can be negative
  won              BOOLEAN NOT NULL,

  -- Dice-specific columns (nullable for other games)
  roll             NUMERIC(6, 2),     -- 0.00–99.99
  target           NUMERIC(6, 2),
  direction        VARCHAR(8),        -- under | over
  multiplier       NUMERIC(12, 4),

  -- Provably fair proof
  server_seed_hash TEXT NOT NULL,
  client_seed      TEXT NOT NULL,
  nonce            INTEGER NOT NULL,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bets_user ON bets(user_id);
CREATE INDEX idx_bets_game ON bets(game);
CREATE INDEX idx_bets_created ON bets(created_at DESC);
CREATE INDEX idx_bets_user_game ON bets(user_id, game);

-- ============================================================
-- SESSIONS
-- ============================================================
CREATE TABLE sessions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip_address  INET,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- ============================================================
-- AUTO-UPDATE updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_wallets_updated_at
  BEFORE UPDATE ON wallets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
