/**
 * HD Wallet Address Generator
 *
 * Generates unique deposit addresses for each user from a single
 * master mnemonic using BIP-44 derivation paths.
 *
 * Derivation paths:
 *   Polygon/ETH: m/44'/60'/0'/0/{index}
 *   Bitcoin:     m/44'/0'/0'/0/{index}
 *
 * IMPORTANT: Back up your WALLET_MNEMONIC securely.
 * Losing it = losing access to all deposited funds.
 *
 * Run once to assign addresses to all users without one:
 *   node src/services/addressGenerator.js
 *
 * Or call generateAddressForUser(userId) programmatically.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const { ethers } = require("ethers");
const pool = require("../db/pool");

let hasWarnedInvalidMnemonic = false;
let hasWarnedMissingBtcDeps = false;

let bitcoin = null;
let bip32 = null;
let bip39 = null;

try {
  bitcoin = require("bitcoinjs-lib");
  const ecc = require("tiny-secp256k1");
  const { BIP32Factory } = require("bip32");
  bip39 = require("bip39");
  bitcoin.initEccLib(ecc);
  bip32 = BIP32Factory(ecc);
} catch {
  // BTC derivation deps are optional in environments where npm install is restricted.
}

function getNormalizedMnemonic() {
  const raw = (process.env.WALLET_MNEMONIC || "").trim().toLowerCase();
  if (!raw) return null;
  if (!bip39) return raw;
  if (!bip39.validateMnemonic(raw)) {
    if (!hasWarnedInvalidMnemonic) {
      hasWarnedInvalidMnemonic = true;
      console.warn("⚠️ Invalid WALLET_MNEMONIC. Falling back to demo deposit addresses.");
    }
    return null;
  }
  return raw;
}

/**
 * Derive an EVM address (Polygon/ETH) at a given index
 */
function deriveEVMAddress(index) {
  const fallback = `0xDEMO${String(index).padStart(36, "0")}`;
  const mnemonic = getNormalizedMnemonic();
  if (!mnemonic) return fallback;

  try {
    const path = `m/44'/60'/0'/0/${index}`;
    const hdNode = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, path);
    return hdNode.address;
  } catch (err) {
    if (!hasWarnedInvalidMnemonic) {
      hasWarnedInvalidMnemonic = true;
      console.warn("⚠️ Invalid WALLET_MNEMONIC. Falling back to demo deposit addresses.", err.message);
    }
    return fallback;
  }
}

function deriveBTCAddress(index) {
  const fallback = `bc1q_placeholder_${index}`;
  if (!bitcoin || !bip32 || !bip39) {
    if (!hasWarnedMissingBtcDeps) {
      hasWarnedMissingBtcDeps = true;
      console.warn("⚠️ Missing BTC libs (bitcoinjs-lib/bip32/bip39/tiny-secp256k1). Using placeholder BTC addresses.");
    }
    return fallback;
  }
  const mnemonic = getNormalizedMnemonic();
  if (!mnemonic) return fallback;

  try {
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const root = bip32.fromSeed(seed, bitcoin.networks.bitcoin);
    const child = root.derivePath(`m/84'/0'/0'/0/${index}`);
    const payment = bitcoin.payments.p2wpkh({
      pubkey: Buffer.from(child.publicKey),
      network: bitcoin.networks.bitcoin,
    });
    return payment.address || fallback;
  } catch (err) {
    console.warn("⚠️ BTC derivation failed. Falling back to placeholder address.", err.message);
    return fallback;
  }
}

/**
 * Assign deposit addresses to a single user
 */
async function generateAddressForUser(userId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Use deterministic, per-currency derivation indexes so each wallet row
    // has a unique deposit_address (wallets.deposit_address is UNIQUE).
    const baseIndex = userId * 10;

    const currencies = [
      { currency: "ETH_POLYGON", address: deriveEVMAddress(baseIndex + 0) },
      { currency: "USDT", address: deriveEVMAddress(baseIndex + 1) },
      { currency: "USDT_POLYGON", address: deriveEVMAddress(baseIndex + 2) },
      { currency: "BTC", address: deriveBTCAddress(baseIndex + 3) },
    ];

    for (const { currency, address } of currencies) {
      await client.query(
        `UPDATE wallets SET deposit_address = $1
         WHERE user_id = $2
           AND currency = $3
           AND (
             deposit_address IS NULL
             OR deposit_address = ''
             OR deposit_address LIKE '0xDEMO%'
             OR deposit_address LIKE 'bc1q_placeholder_%'
           )`,
        [address, userId, currency]
      );
    }

    await client.query("COMMIT");
    console.log(`✅ Assigned deposit addresses to user ${userId}`);
    return currencies;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Backfill — assign addresses to all users who don't have one yet
 */
async function backfillAddresses() {
  const result = await pool.query(
    `SELECT DISTINCT user_id FROM wallets WHERE deposit_address IS NULL`
  );

  console.log(`Assigning addresses to ${result.rows.length} users...`);
  for (const row of result.rows) {
    await generateAddressForUser(row.user_id);
  }
  console.log("Done.");
  process.exit(0);
}

/**
 * Ensure all users with missing wallet addresses get assigned.
 * Safe to run on startup of background services.
 */
async function ensureAllDepositAddresses() {
  const result = await pool.query(
    `SELECT DISTINCT user_id FROM wallets WHERE deposit_address IS NULL`
  );

  for (const row of result.rows) {
    await generateAddressForUser(row.user_id);
  }

  return result.rows.length;
}

// Run if called directly
if (require.main === module) {
  backfillAddresses().catch(console.error);
}

module.exports = { generateAddressForUser, deriveEVMAddress, ensureAllDepositAddresses };
