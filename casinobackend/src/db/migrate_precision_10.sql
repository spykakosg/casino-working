-- Increase amount precision so BTC/ETH small-profit payouts don't round to zero.
ALTER TABLE wallets      ALTER COLUMN balance    TYPE NUMERIC(28, 10);
ALTER TABLE deposits     ALTER COLUMN amount     TYPE NUMERIC(28, 10);
ALTER TABLE withdrawals  ALTER COLUMN amount     TYPE NUMERIC(28, 10);
ALTER TABLE withdrawals  ALTER COLUMN fee        TYPE NUMERIC(28, 10);
ALTER TABLE bets         ALTER COLUMN bet_amount TYPE NUMERIC(28, 10);
ALTER TABLE bets         ALTER COLUMN payout     TYPE NUMERIC(28, 10);
ALTER TABLE bets         ALTER COLUMN profit     TYPE NUMERIC(28, 10);
ALTER TABLE crash_bets   ALTER COLUMN bet_amount TYPE NUMERIC(28, 10);
ALTER TABLE crash_bets   ALTER COLUMN payout     TYPE NUMERIC(28, 10);
