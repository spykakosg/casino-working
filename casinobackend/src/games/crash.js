/**
 * Crash Game — Provably Fair Math
 *
 * Crash point is derived from HMAC_SHA256(serverSeed, roundId).
 * The result is verifiable by anyone after the serverSeed is revealed.
 *
 * House edge: 1%
 * Formula: crashPoint = floor(99 / (1 - h)) / 100
 *   where h = first 8 hex chars of HMAC converted to float [0, 1)
 *
 * If h >= 0.99 (1% of the time) → instant crash at 1.00x (house edge)
 */

const crypto = require("crypto");

const HOUSE_EDGE = 0.01; // 1%
const MIN_CRASH  = 1.00;

/**
 * Generate crash point for a given serverSeed + roundId
 * @param {string} serverSeed
 * @param {number} roundId
 * @returns {number} e.g. 2.34
 */
function getCrashPoint(serverSeed, roundId) {
  const hmac = crypto.createHmac("sha256", serverSeed);
  hmac.update(String(roundId));
  const hash = hmac.digest("hex");

  // Take first 8 hex chars → float in [0, 1)
  const h = parseInt(hash.slice(0, 8), 16) / 0x100000000;

  // House edge: 1% of outcomes crash instantly at 1.00x
  if (h >= (1 - HOUSE_EDGE)) return MIN_CRASH;

  // Crash point formula
  const rawPoint = Math.floor(99 / (1 - h)) / 100;
  return Math.max(MIN_CRASH, rawPoint);
}

/**
 * Verify a past round — anyone can call this after serverSeed is revealed
 */
function verifyCrashPoint(serverSeed, serverSeedHash, roundId, claimedCrashPoint) {
  const actualHash = crypto.createHash("sha256").update(serverSeed).digest("hex");
  if (actualHash !== serverSeedHash) return { valid: false, reason: "Server seed hash mismatch" };

  const actualCrash = getCrashPoint(serverSeed, roundId);
  const matches = Math.abs(actualCrash - claimedCrashPoint) < 0.01;
  return { valid: matches, actualCrash, claimedCrashPoint };
}

/**
 * Multiplier at a given elapsed time (ms)
 * Grows exponentially — reaches ~2x at ~10s, ~10x at ~40s
 */
function getMultiplierAtTime(elapsedMs) {
  const t = elapsedMs / 1000; // seconds
  const m = Math.pow(Math.E, 0.06 * t);
  return Math.max(1.00, parseFloat(m.toFixed(2)));
}

/**
 * Time (ms) at which a given multiplier is reached
 */
function getTimeForMultiplier(multiplier) {
  if (multiplier <= 1) return 0;
  return Math.log(multiplier) / 0.06 * 1000;
}

module.exports = {
  getCrashPoint,
  verifyCrashPoint,
  getMultiplierAtTime,
  getTimeForMultiplier,
};
