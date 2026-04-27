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
