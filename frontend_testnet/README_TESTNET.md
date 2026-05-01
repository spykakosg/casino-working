# Frontend Testnet

This folder is a dedicated frontend variant for testnet usage.

## What is different
- Defaults to Sepolia currencies in selectors:
  - `USDT_SEPOLIA`
  - `ETH_SEPOLIA`
- Keeps existing wallet/game flows for deposits and withdrawals through backend APIs.

## Run
```bash
cd frontend_testnet
npm install
npm run dev
```

Backend should be running in testnet mode and expose wallet/game endpoints.
