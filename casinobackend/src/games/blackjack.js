/**
 * Blackjack Game Logic — Provably Fair
 *
 * Standard rules:
 *  - Dealer stands on 17
 *  - Blackjack pays 3:2 (2.5x)
 *  - Double down on any two cards
 *  - No split (simplified)
 *  - No insurance
 *  - 6-deck shoe simulated via RNG
 *
 * Cards are dealt deterministically using HMAC-SHA256
 * Each card uses a different cursor from the same nonce.
 */

const { generateFloat } = require("../engine/rng");

const SUITS = ["hearts", "diamonds", "clubs", "spades"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function drawCard(serverSeed, clientSeed, nonce, cursor) {
  const float = generateFloat(serverSeed, clientSeed, nonce, cursor);
  const index = Math.floor(float * 52);
  const suit = SUITS[Math.floor(index / 13)];
  const rank = RANKS[index % 13];
  return { suit, rank };
}

function cardValue(rank) {
  if (rank === "A") return 11;
  if (["K", "Q", "J"].includes(rank)) return 10;
  return parseInt(rank);
}

function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    total += cardValue(card.rank);
    if (card.rank === "A") aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

function isBlackjack(cards) {
  return cards.length === 2 && handValue(cards) === 21;
}

function dealInitialHands(serverSeed, clientSeed, nonce) {
  const playerCards = [
    drawCard(serverSeed, clientSeed, nonce, 0),
    drawCard(serverSeed, clientSeed, nonce, 1),
  ];
  const dealerCards = [
    drawCard(serverSeed, clientSeed, nonce, 2),
    drawCard(serverSeed, clientSeed, nonce, 3),
  ];
  return { playerCards, dealerCards };
}

function playDealerHand(dealerCards, serverSeed, clientSeed, nonce, nextCursor) {
  let cursor = nextCursor;
  while (handValue(dealerCards) < 17) {
    dealerCards.push(drawCard(serverSeed, clientSeed, nonce, cursor));
    cursor++;
  }
  return { dealerCards, nextCursor: cursor };
}

/**
 * Resolve a complete blackjack game.
 * actions: array of "hit" | "stand" | "double"
 * The game plays out deterministically from the seed.
 */
function resolveBlackjackGame({ serverSeed, clientSeed, nonce, betAmount, actions }) {
  const { playerCards, dealerCards } = dealInitialHands(serverSeed, clientSeed, nonce);
  let cursor = 4; // next card cursor
  let currentBet = betAmount;
  let doubled = false;

  // Check for natural blackjack
  if (isBlackjack(playerCards)) {
    if (isBlackjack(dealerCards)) {
      // Push
      return buildResult(playerCards, dealerCards, currentBet, "push", false, nonce);
    }
    // Player blackjack — 3:2 payout
    return buildResult(playerCards, dealerCards, currentBet, "blackjack", false, nonce);
  }

  // If dealer has blackjack, player loses immediately
  if (isBlackjack(dealerCards)) {
    return buildResult(playerCards, dealerCards, currentBet, "dealer_blackjack", false, nonce);
  }

  // Play out player actions
  for (const action of actions) {
    if (action === "hit") {
      playerCards.push(drawCard(serverSeed, clientSeed, nonce, cursor));
      cursor++;
      if (handValue(playerCards) > 21) {
        return buildResult(playerCards, dealerCards, currentBet, "bust", doubled, nonce);
      }
    } else if (action === "double") {
      doubled = true;
      currentBet = betAmount * 2;
      playerCards.push(drawCard(serverSeed, clientSeed, nonce, cursor));
      cursor++;
      if (handValue(playerCards) > 21) {
        return buildResult(playerCards, dealerCards, currentBet, "bust", doubled, nonce);
      }
      break; // double means one card then stand
    } else if (action === "stand") {
      break;
    }
  }

  // Dealer plays
  const dealerResult = playDealerHand([...dealerCards], serverSeed, clientSeed, nonce, cursor);
  const finalDealerCards = dealerResult.dealerCards;

  const playerVal = handValue(playerCards);
  const dealerVal = handValue(finalDealerCards);

  let outcome;
  if (dealerVal > 21) outcome = "dealer_bust";
  else if (playerVal > dealerVal) outcome = "win";
  else if (playerVal < dealerVal) outcome = "lose";
  else outcome = "push";

  return buildResult(playerCards, finalDealerCards, currentBet, outcome, doubled, nonce);
}

function buildResult(playerCards, dealerCards, betAmount, outcome, doubled, nonce) {
  const playerValue = handValue(playerCards);
  const dealerValue = handValue(dealerCards);

  let multiplier;
  switch (outcome) {
    case "blackjack":       multiplier = 2.5; break;
    case "win":
    case "dealer_bust":     multiplier = 2; break;
    case "push":            multiplier = 1; break;
    default:                multiplier = 0; break; // bust, lose, dealer_blackjack
  }

  const payout = parseFloat((betAmount * multiplier).toFixed(8));
  const won = multiplier > 1;

  return {
    playerCards,
    dealerCards,
    playerValue,
    dealerValue,
    outcome,
    won,
    betAmount,
    multiplier,
    payout,
    profit: parseFloat((payout - betAmount).toFixed(8)),
    doubled,
    nonce,
  };
}

function validateBlackjackBet({ betAmount, balance }) {
  if (betAmount <= 0) return { valid: false, error: "Bet amount must be positive" };
  if (betAmount > balance) return { valid: false, error: "Insufficient balance" };
  return { valid: true };
}

module.exports = {
  resolveBlackjackGame,
  validateBlackjackBet,
  dealInitialHands,
  handValue,
  isBlackjack,
  drawCard,
  cardValue,
};
