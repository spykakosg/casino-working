/**
 * HD Wallet Address Generator
 *
 * Generates unique BTC deposit addresses per user from a single master
 * mnemonic using the EXACT same derivation as the working btc-testnet wallet:
 *   BTC path: m/84'/1'/0'/0/{index}  (testnet)
 *             m/84'/0'/0'/0/{index}  (mainnet)
 *   Address type: p2wpkh (native segwit, tb1… / bc1…)
 *
 * For EVM currencies (ETH_POLYGON, USDT) derivation uses ethers HDNodeWallet.
 *
 * Env vars:
 *   WALLET_MNEMONIC      — 12/24-word BIP-39 phrase (required for real addresses)
 *   TESTNET_MODE         — "true" for testnet networks
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const bitcoin = require("bitcoinjs-lib");
const bip39   = require("bip39");
const ecc     = require("tiny-secp256k1");
const { BIP32Factory } = require("bip32");
const { ethers } = require("ethers");
const pool    = require("../db/pool");
const { isTestnet } = require("../config/networkMode");

// Initialise secp256k1 — required by bitcoinjs-lib v6
bitcoin.initEccLib(ecc);
const bip32 = BIP32Factory(ecc);

const BTC_NETWORK = isTestnet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;
const BTC_COIN    = isTestnet ? 1 : 0; // BIP-44 coin type

// ─── Mnemonic ────────────────────────────────────────────────────────────────

function getMnemonic() {
  const raw = (process.env.WALLET_MNEMONIC || "").trim().toLowerCase();
  if (!raw) return null;
  if (!bip39.validateMnemonic(raw)) {
    console.warn("⚠️  WALLET_MNEMONIC is invalid — using placeholder deposit addresses.");
    return null;
  }
  return raw;
}

// ─── BTC address derivation (mirrors working wallet's wallet.js) ─────────────

async function deriveBTCAddress(index) {
  const mnemonic = getMnemonic();
  if (!mnemonic) {
    // Distinct prefix so the SQL placeholder filter works on both nets
    return `${isTestnet ? "tb1" : "bc1"}q_placeholder_${index}`;
  }

  const seed   = await bip39.mnemonicToSeed(mnemonic);          // async, same as working wallet
  const root   = bip32.fromSeed(seed, BTC_NETWORK);
  const path   = `m/84'/${BTC_COIN}'/0'/0/${index}`;
  const child  = root.derivePath(path);

  const { address } = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(child.publicKey),
    network: BTC_NETWORK,
  });

  return address;
}

// ─── EVM address derivation ──────────────────────────────────────────────────

function deriveEVMAddress(index) {
  const mnemonic = getMnemonic();
  if (!mnemonic) return `0xDEMO${String(index).padStart(36, "0")}`;

  try {
    const path   = `m/44'/60'/0'/0/${index}`;
    const hdNode = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, path);
    return hdNode.address;
  } catch (err) {
    console.warn("⚠️  EVM address derivation failed:", err.message);
    return `0xDEMO${String(index).padStart(36, "0")}`;
  }
}

// ─── Assign addresses to one user ────────────────────────────────────────────

async function generateAddressForUser(userId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Each user gets a unique slice of the index space
    const base = userId * 10;

    const currencies = [
      { currency: "ETH_POLYGON", address: deriveEVMAddress(base + 0) },
      { currency: "USDT",        address: deriveEVMAddress(base + 1) },
      { currency: "BTC",         address: await deriveBTCAddress(base + 2) },
    ];

    let updatedRows = 0;
    for (const { currency, address } of currencies) {
      const res = await client.query(
        `UPDATE wallets
         SET deposit_address = $1
         WHERE user_id = $2
           AND currency   = $3
           AND (
             deposit_address IS NULL
             OR deposit_address = ''
             OR deposit_address LIKE '0xDEMO%'
             OR deposit_address LIKE 'tb1q_placeholder_%'
             OR deposit_address LIKE 'bc1q_placeholder_%'
           )`,
        [address, userId, currency]
      );
      updatedRows += res.rowCount;
    }

    await client.query("COMMIT");

    if (updatedRows > 0) {
      console.log(`✅ Assigned deposit addresses to user ${userId} (${updatedRows} row(s) updated)`);
    }

    return { currencies, updatedRows };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ─── Backfill all users missing addresses ────────────────────────────────────

async function ensureAllDepositAddresses() {
  const result = await pool.query(
    `SELECT DISTINCT user_id
     FROM wallets
     WHERE deposit_address IS NULL
       AND currency IN ('USDT', 'ETH_POLYGON', 'BTC')`
  );

  let changedUsers = 0;
  for (const { user_id } of result.rows) {
    const r = await generateAddressForUser(user_id);
    if (r.updatedRows > 0) changedUsers++;
  }
  return changedUsers;
}

async function backfillAddresses() {
  const assigned = await ensureAllDepositAddresses();
  console.log(`Done — assigned addresses for ${assigned} user(s).`);
  process.exit(0);
}

if (require.main === module) {
  backfillAddresses().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { generateAddressForUser, deriveEVMAddress, ensureAllDepositAddresses };
