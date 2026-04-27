const crypto = require("crypto");

/**
 * Provably Fair RNG Engine
 *
 * How it works:
 *  1. Server generates a random serverSeed (kept secret during play)
 *  2. Server gives the user a SHA256 hash of serverSeed (commitment)
 *  3. User provides a clientSeed (can be anything they choose)
 *  4. Each bet uses an incrementing nonce
 *  5. Result = HMAC_SHA256(serverSeed, clientSeed:nonce)
 *  6. After the bet, server reveals serverSeed → user can verify
 */

/**
 * Generate a cryptographically secure random server seed
 */
function generateServerSeed() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Hash the server seed — this is shown to the user BEFORE they bet
 * so they know the outcome was predetermined and not manipulated
 */
function hashServerSeed(serverSeed) {
  return crypto.createHash("sha256").update(serverSeed).digest("hex");
}

/**
 * Generate a default client seed (used if user doesn't set one)
 */
function generateClientSeed() {
  return crypto.randomBytes(8).toString("hex");
}

/**
 * Core RNG function — deterministically generates a float in [0, 1)
 * from serverSeed + clientSeed + nonce using HMAC-SHA256
 *
 * @param {string} serverSeed
 * @param {string} clientSeed
 * @param {number} nonce - increments with each bet
 * @param {number} cursor - for generating multiple numbers from one hash
 */
function generateFloat(serverSeed, clientSeed, nonce, cursor = 0) {
  const hmac = crypto.createHmac("sha256", serverSeed);
  hmac.update(`${clientSeed}:${nonce}:${cursor}`);
  const hash = hmac.digest("hex");

  // Take 4 bytes (8 hex chars) from the hash and convert to float [0, 1)
  const hexSegment = hash.slice(0, 8);
  const intValue = parseInt(hexSegment, 16);
  return intValue / 0x100000000; // divide by 2^32
}

/**
 * Generate a dice roll result: a float between 0.00 and 99.99
 * Represents the "rolled number" on a 0–100 scale
 *
 * @returns {number} e.g. 42.37
 */
function rollDice(serverSeed, clientSeed, nonce) {
  const float = generateFloat(serverSeed, clientSeed, nonce);
  // Scale to 0–99.99 with 2 decimal precision
  return Math.floor(float * 10000) / 100;
}

/**
 * Verify a past bet — anyone can call this with the revealed serverSeed
 * Returns true if the result matches what was originally played
 */
function verifyDiceRoll(serverSeed, clientSeed, nonce, claimedResult) {
  const result = rollDice(serverSeed, clientSeed, nonce);
  return Math.abs(result - claimedResult) < 0.001;
}

/**
 * Rotate seeds — called after user requests a new server seed
 * The OLD serverSeed is revealed (for verification), a new one is generated
 */
function rotateSeed(currentServerSeed) {
  const revealedSeed = currentServerSeed;
  const newServerSeed = generateServerSeed();
  const newHashedSeed = hashServerSeed(newServerSeed);
  return { revealedSeed, newServerSeed, newHashedSeed };
}

module.exports = {
  generateServerSeed,
  hashServerSeed,
  generateClientSeed,
  generateFloat,
  rollDice,
  verifyDiceRoll,
  rotateSeed,
};
