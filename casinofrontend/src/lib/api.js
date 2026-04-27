const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

function getToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("casino_token");
}

async function request(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
export async function login(username, password) {
  const data = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  localStorage.setItem("casino_token", data.token);
  return data;
}

export async function register(username, password, email) {
  const data = await request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password, email }),
  });
  localStorage.setItem("casino_token", data.token);
  return data;
}

export function logout() {
  localStorage.removeItem("casino_token");
}

export async function getMe() {
  return request("/api/auth/me");
}

export async function getSeeds() {
  return request("/api/auth/seeds");
}

export async function setClientSeed(currency, clientSeed) {
  return request("/api/auth/client-seed", {
    method: "PUT",
    body: JSON.stringify({ currency, clientSeed }),
  });
}

export async function rotateServerSeed(currency) {
  return request("/api/games/dice/seed", {
    method: "POST",
    body: JSON.stringify({ currency }),
  });
}

// ─── Games ────────────────────────────────────────────────────────────────────
export async function placeDiceBet({ currency, betAmount, target, direction }) {
  return request("/api/games/dice/bet", {
    method: "POST",
    body: JSON.stringify({ currency, betAmount, target, direction }),
  });
}

export async function getDiceInfo() {
  return request("/api/games/dice/info");
}

export async function getBetHistory(limit = 20, offset = 0) {
  return request(`/api/games/bets?limit=${limit}&offset=${offset}&game=dice`);
}

// ─── Wallet ───────────────────────────────────────────────────────────────────
export async function getBalances() {
  return request("/api/wallet/balances");
}

export async function getDepositAddress(currency) {
  return request(`/api/wallet/deposit/${currency}`);
}

export async function requestWithdrawal(currency, amount, toAddress) {
  return request("/api/wallet/withdraw", {
    method: "POST",
    body: JSON.stringify({ currency, amount, toAddress }),
  });
}

export async function getDepositHistory() {
  return request("/api/wallet/deposits");
}

export async function getWithdrawalHistory() {
  return request("/api/wallet/withdrawals");
}

export async function getCrashBetHistory(limit = 20, offset = 0) {
  return request(`/api/crash/my-bets?limit=${limit}&offset=${offset}`);
}

// ─── Roulette ─────────────────────────────────────────────────────────────────
export async function placeRouletteBet({ currency, betAmount, betType, betValue }) {
  return request("/api/games/roulette/bet", {
    method: "POST",
    body: JSON.stringify({ currency, betAmount, betType, betValue }),
  });
}

export async function getRouletteBetHistory(limit = 20, offset = 0) {
  return request(`/api/games/bets?limit=${limit}&offset=${offset}&game=roulette`);
}

// ─── Blackjack ────────────────────────────────────────────────────────────────
export async function blackjackDeal({ currency, betAmount }) {
  return request("/api/blackjack/deal", {
    method: "POST",
    body: JSON.stringify({ currency, betAmount }),
  });
}

export async function blackjackAction({ gameId, action }) {
  return request("/api/blackjack/action", {
    method: "POST",
    body: JSON.stringify({ gameId, action }),
  });
}

export async function getBlackjackBetHistory(limit = 20, offset = 0) {
  return request(`/api/games/bets?limit=${limit}&offset=${offset}&game=blackjack`);
}

// ─── Plinko ───────────────────────────────────────────────────────────────────
export async function placePlinkoBet({ currency, betAmount, rows, risk }) {
  return request("/api/games/plinko/bet", {
    method: "POST",
    body: JSON.stringify({ currency, betAmount, rows, risk }),
  });
}

export async function getPlinkoBetHistory(limit = 20, offset = 0) {
  return request(`/api/games/bets?limit=${limit}&offset=${offset}&game=plinko`);
}

// ─── Mines ────────────────────────────────────────────────────────────────────
export async function minesStart({ currency, betAmount, mineCount }) {
  return request("/api/mines/start", {
    method: "POST",
    body: JSON.stringify({ currency, betAmount, mineCount }),
  });
}

export async function minesReveal({ gameId, tileIndex }) {
  return request("/api/mines/reveal", {
    method: "POST",
    body: JSON.stringify({ gameId, tileIndex }),
  });
}

export async function minesCashout({ gameId }) {
  return request("/api/mines/cashout", {
    method: "POST",
    body: JSON.stringify({ gameId }),
  });
}

export async function getMinesBetHistory(limit = 20, offset = 0) {
  return request(`/api/games/bets?limit=${limit}&offset=${offset}&game=mines`);
}

// ─── Limbo ────────────────────────────────────────────────────────────────────
export async function placeLimboBet({ currency, betAmount, target }) {
  return request("/api/games/limbo/bet", {
    method: "POST",
    body: JSON.stringify({ currency, betAmount, target }),
  });
}

export async function getLimboBetHistory(limit = 20, offset = 0) {
  return request(`/api/games/bets?limit=${limit}&offset=${offset}&game=limbo`);
}

// ─── Slots ────────────────────────────────────────────────────────────────────
export async function placeSlotsBet({ currency, betAmount }) {
  return request("/api/games/slots/bet", {
    method: "POST",
    body: JSON.stringify({ currency, betAmount }),
  });
}

export async function getSlotsBetHistory(limit = 20, offset = 0) {
  return request(`/api/games/bets?limit=${limit}&offset=${offset}&game=slots`);
}

// ─── Admin ────────────────────────────────────────────────────────────────────
export async function adminGetStats() {
  return request("/api/admin/stats");
}

export async function adminGetUsers(limit = 50, offset = 0, search = "") {
  const q = search ? `&search=${encodeURIComponent(search)}` : "";
  return request(`/api/admin/users?limit=${limit}&offset=${offset}${q}`);
}

export async function adminGetUser(id) {
  return request(`/api/admin/users/${id}`);
}

export async function adminBanUser(id, banned) {
  return request(`/api/admin/users/${id}/ban`, {
    method: "PUT",
    body: JSON.stringify({ banned }),
  });
}

export async function adminCreditUser(id, currency, amount) {
  return request(`/api/admin/users/${id}/credit`, {
    method: "PUT",
    body: JSON.stringify({ currency, amount }),
  });
}

export async function adminResetPnl() {
  return request("/api/admin/stats/reset", { method: "POST" });
}

export async function getPrices() {
  return request("/api/prices");
}

export async function adminGetPendingWithdrawals() {
  return request("/api/admin/withdrawals/pending");
}

export async function adminProcessWithdrawal(id, action, txHash) {
  return request(`/api/admin/withdrawals/${id}`, {
    method: "PUT",
    body: JSON.stringify({ action, txHash: txHash || undefined }),
  });
}
