/**
 * HD Wallet Address Generator
 *
 * Generates unique deposit addresses for each user from a single
 * master mnemonic using BIP-44 derivation paths.
 *
 * Derivation paths:
 *   Polygon/ETH: m/44'/60'/0'/0/{index}
 *   Tron:        m/44'/195'/0'/0/{index}
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

if (!process.env.WALLET_MNEMONIC) {
  console.error("❌  WALLET_MNEMONIC not set in .env");
  process.exit(1);
}

const masterWallet = ethers.Wallet.fromPhrase(process.env.WALLET_MNEMONIC);

/**
 * Derive an EVM address (Polygon/ETH) at a given index
 */
function deriveEVMAddress(index) {
  const path = `m/44'/60'/0'/0/${index}`;
  const hdNode = ethers.HDNodeWallet.fromPhrase(process.env.WALLET_MNEMONIC, undefined, path);
  return hdNode.address;
}

/**
 * Derive a Tron address at a given index
 * Tron uses the same secp256k1 keys as Ethereum but with base58check encoding
 * For simplicity we derive the EVM key and convert
 */
function deriveTronAddress(index) {
  const path = `m/44'/195'/0'/0/${index}`;
  const hdNode = ethers.HDNodeWallet.fromPhrase(process.env.WALLET_MNEMONIC, undefined, path);
  // Convert ETH address to Tron format (replace 0x prefix with 41, then base58check encode)
  // For production use tronweb: TronWeb.address.fromHex("41" + hdNode.address.slice(2))
  // Here we return the raw hex address — integrate TronWeb for full Tron support
  return `T${hdNode.address.slice(3)}`; // simplified placeholder — use tronweb in production
}

/**
 * Assign deposit addresses to a single user
 */
async function generateAddressForUser(userId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Use the userId as the derivation index (simple, deterministic)
    // In production you may want a separate sequential counter table
    const index = userId;

    const currencies = [
      { currency: "ETH_POLYGON", address: deriveEVMAddress(index) },
      { currency: "USDT_POLYGON", address: deriveEVMAddress(index) }, // same address, different token
      { currency: "USDT_TRON", address: deriveTronAddress(index) },
      { currency: "BTC", address: `bc1q_placeholder_${index}` }, // integrate bitcoinjs-lib for real BTC
    ];

    for (const { currency, address } of currencies) {
      await client.query(
        `UPDATE wallets SET deposit_address = $1
         WHERE user_id = $2 AND currency = $3 AND deposit_address IS NULL`,
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

// Run if called directly
if (require.main === module) {
  backfillAddresses().catch(console.error);
}

module.exports = { generateAddressForUser, deriveEVMAddress };
