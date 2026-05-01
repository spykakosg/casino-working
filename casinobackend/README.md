# 🎲 Crypto Casino — Backend

Full backend for a crypto casino with:
- Provably fair dice game engine (HMAC-SHA256)
- Internal balance system (all bets off-chain, instant)
- Deposit watching (Polygon ETH, Polygon USDT, Tron USDT, Bitcoin)
- HD wallet — unique deposit address per user
- JWT auth (register/login)
- Withdrawal system with admin approval queue
- Admin panel API

---

## Project Structure

```
casino/
├── src/
│   ├── app.js                    ← Express entry point
│   ├── db/
│   │   ├── pool.js               ← PostgreSQL connection pool
│   │   └── schema.sql            ← Database schema (run once)
│   ├── engine/
│   │   ├── rng.js                ← Provably fair RNG
│   │   └── bet.js                ← Atomic bet engine
│   ├── games/
│   │   └── dice.js               ← Dice game logic
│   ├── routes/
│   │   ├── auth.js               ← Register, login, me
│   │   ├── games.js              ← Bet, verify, history
│   │   ├── wallet.js             ← Balances, deposits, withdrawals
│   │   └── admin.js              ← Admin stats, user mgmt
│   ├── middleware/
│   │   └── auth.js               ← JWT middleware
│   └── services/
│       ├── depositWatcher.js     ← Blockchain deposit monitor
│       └── addressGenerator.js  ← HD wallet address generator
├── tests/
│   └── dice.test.js
├── .env.example
└── package.json
```

---

## Setup (Windows)

### Step 1 — Install PostgreSQL

Download from: https://www.postgresql.org/download/windows/

During install:
- Set a password for the `postgres` user (remember it)
- Keep default port 5432
- Make sure "Command Line Tools" is checked

After install, open a **new** PowerShell window and run:

```powershell
psql -U postgres -c "CREATE DATABASE casino_db;"
```

### Step 2 — Install Node.js

Download from: https://nodejs.org (LTS version)

### Step 3 — Set up the project

```powershell
# Enter the casino folder
cd path\to\casino

# Install dependencies
npm install

# Copy env file
copy .env.example .env
```

### Step 4 — Configure .env

Open `.env` in Notepad and fill in:

```
DATABASE_URL=postgresql://postgres:YOURPASSWORD@localhost:5432/casino_db
JWT_SECRET=   ← generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
WALLET_MNEMONIC=  ← generate with: node -e "const {ethers}=require('ethers'); console.log(ethers.Wallet.createRandom().mnemonic.phrase)"
```

For ALCHEMY_POLYGON_URL: sign up free at https://alchemy.com, create a Polygon app, copy the HTTPS URL.

### Optional: Testnet mode (recommended before mainnet)

Add these to `.env`:

```
TESTNET_MODE=true
TESTNET_EVM_RPC_URL=https://rpc-amoy.polygon.technology
TESTNET_USDT_CONTRACT=0x...   # your Amoy test USDT contract
BTC_EXPLORER_BASE_URL=https://blockstream.info/testnet/api

# For real testnet payouts from withdrawalWorker
PAYOUT_PROVIDER=testnet
TESTNET_PAYOUT_PRIVATE_KEY=0x...
TESTNET_BTC_WIF=c...           # preferred for testnet BTC payouts
# or TESTNET_BTC_PRIVATE_KEY_HEX=...
# optional: TESTNET_BTC_FROM_ADDRESS=tb1... (auto-derived from key if omitted)
```

Notes:
- In testnet mode, deposit watcher uses `TESTNET_EVM_RPC_URL` instead of `ALCHEMY_POLYGON_URL`.
- BTC testnet deposits are supported via testnet explorer URL.
- BTC testnet withdrawals are implemented in worker. Configure `TESTNET_BTC_WIF` (or `TESTNET_BTC_PRIVATE_KEY_HEX`) and fund the corresponding testnet address before enabling BTC payouts.


### Windows CMD quick-start (copy/paste)

If you are using **Command Prompt (cmd.exe)**, use these commands:

```cmd
cd /d C:\path\to\casino-working\casinobackend
npm install

:: set testnet env for current cmd window
set TESTNET_MODE=true
set TESTNET_EVM_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
set TESTNET_USDT_CONTRACT=0x94f29c9e01a5b19546231141b870d14074be939c
set BTC_EXPLORER_BASE_URL=https://blockstream.info/testnet/api
set PAYOUT_PROVIDER=testnet
set TESTNET_PAYOUT_PRIVATE_KEY=0xYOUR_TESTNET_PRIVATE_KEY

:: run app + workers
npm run dev
```

Open two more CMD windows in the same folder and run:

```cmd
npm run watcher
npm run withdrawal-worker
```

If you prefer `.env`, create `casinobackend\.env` and put the same values there.

### Backup wallets table from Windows CMD

To run this backup SQL from **Command Prompt (cmd.exe)**, use one of these options:

**Option A — open psql then paste SQL**

```cmd
cd /d C:\path\to\casino-working\casinobackend
psql -U postgres -d casino_db
```

Then paste:

```sql
CREATE TABLE wallets_backup_mainnet_2026_04_30 AS
SELECT * FROM wallets;
```

Exit psql with:

```sql
\q
```

**Option B — one command from CMD**

```cmd
psql -U postgres -d casino_db -c "CREATE TABLE wallets_backup_mainnet_2026_04_30 AS SELECT * FROM wallets;"
```

### Step 5 — Run the database schema

```powershell
psql -U postgres -d casino_db -f src\db\schema.sql
```

### Step 6 — Start the server

```powershell
npm run dev
```

You should see:
```
🎲 Casino backend running on http://localhost:4000
   Routes: /api/auth  /api/games  /api/wallet  /api/admin
```

Test it:
```powershell
curl http://localhost:4000/health
```

---

## API Reference

### Auth
| Method | Route | Body | Description |
|--------|-------|------|-------------|
| POST | /api/auth/register | `{username, password, email?}` | Create account |
| POST | /api/auth/login | `{username, password}` | Get JWT token |
| GET | /api/auth/me | — | Current user + balances |
| PUT | /api/auth/password | `{currentPassword, newPassword}` | Change password |
| GET | /api/auth/seeds | — | View seed hashes |
| PUT | /api/auth/client-seed | `{currency, clientSeed}` | Set custom seed |

### Games
| Method | Route | Body | Description |
|--------|-------|------|-------------|
| POST | /api/games/dice/bet | `{currency, betAmount, target, direction}` | Place a bet |
| GET | /api/games/dice/info | — | Game config & presets |
| GET | /api/games/dice/verify | `?serverSeed=&clientSeed=&nonce=` | Verify any past bet |
| POST | /api/games/dice/seed | `{currency}` | Rotate server seed |
| GET | /api/games/bets | `?limit=&offset=&game=` | Bet history |

### Wallet
| Method | Route | Description |
|--------|-------|-------------|
| GET | /api/wallet/balances | All currency balances |
| GET | /api/wallet/deposit/:currency | Get deposit address |
| GET | /api/wallet/deposits | Deposit history |
| POST | /api/wallet/withdraw | Request withdrawal `{currency, amount, toAddress}` |
| GET | /api/wallet/withdrawals | Withdrawal history |

### Admin (requires admin role)
| Method | Route | Description |
|--------|-------|-------------|
| GET | /api/admin/stats | Platform stats |
| GET | /api/admin/users | List all users |
| GET | /api/admin/users/:id | User detail |
| PUT | /api/admin/users/:id/ban | Ban/unban `{banned: true/false}` |
| GET | /api/admin/withdrawals/pending | Pending withdrawals |
| PUT | /api/admin/withdrawals/:id | Approve/reject `{action, txHash?}` |

---

## Running the Deposit Watcher

In a separate terminal:

```powershell
npm run watcher
```

This monitors the blockchain for incoming deposits and credits user balances automatically.

## Assigning Deposit Addresses

After users register, run once to generate their deposit addresses:

```powershell
npm run gen-addresses
```

---

## Running Tests

```powershell
npm test
```

---

## Making a User an Admin

```sql
UPDATE users SET role = 'admin' WHERE username = 'yourusername';
```


## Alternative implementation options

If the current all-in-one implementation feels too complex, here are simpler ways to ship the same capabilities incrementally:

1. **Phase features behind flags**
   - Keep existing routes/UI hidden behind env-based feature flags.
   - Roll out one domain at a time (`referrals`, then `account recovery`, then `withdrawal queue`).

2. **Use managed providers first, then self-host**
   - Email verification/reset: use Auth0/Firebase/Supabase auth flows instead of custom token tables.
   - Leaderboards/referrals: use a managed analytics store or Redis sorted sets before a full relational design.

3. **Replace worker queue with a cron-based puller (short term)**
   - Instead of a continuously running worker, run a scheduled job every minute to process pending withdrawals.
   - This reduces operational complexity while preserving auditability and retries.

4. **Split PRs by risk area**
   - PR A: DB schema + migrations only.
   - PR B: backend APIs only.
   - PR C: frontend pages/components only.
   - PR D: blockchain integrations and job worker only.

5. **Keep blockchain integrations adapter-only until production readiness**
   - Ship interfaces and mock adapters first.
   - Add BTC/EVM concrete implementations once secrets, providers, monitoring, and reconciliation playbooks are in place.

6. **Start with read-only community features**
   - Launch leaderboard/provably-fair verifier first (low risk), then referrals payouts after monitoring and abuse controls are validated.

7. **Prefer existing queue technology**
   - Use BullMQ/SQS/Cloud Tasks instead of custom SQL job-claiming logic if your team already supports one queue platform.

8. **Move anti-abuse to perimeter controls**
   - Keep in-app limits minimal.
   - Offload rate limits/challenges to API gateway/WAF for consistency and easier tuning.

9. **Adopt “minimal viable recovery”**
   - Implement password reset first.
   - Add email verification enforcement later (e.g., only required at withdrawal time).

10. **Introduce formal acceptance criteria per feature**
   - For each domain, define “done” checks (unit/integration tests + runbook + observability signals) before enabling in production.
