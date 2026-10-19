import { readDiscordSession } from "./discordAuth.js";

export class RealtimeTicketError extends Error {
  constructor(message, { status = 500, code = "REALTIME_ERROR" } = {}) {
    super(message);
    this.name = "RealtimeTicketError";
    this.status = status;
    this.code = code;
  }
}
function validId(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}
async function signToken(payload, secret) {
  const encoded = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(encoded)));
  return encoded + "." + bytesToBase64Url(signature);
}

export async function handleRealtimeTicketRequest({ method, url, cookieHeader, env }) {
  if (method !== "GET") throw new RealtimeTicketError("Method not allowed.", { status: 405, code: "METHOD_NOT_ALLOWED" });
  const auth = await readDiscordSession({ cookieHeader, env });
  if (!auth.authenticated) throw new RealtimeTicketError("Connect Discord before entering the lobby.", { status: 401, code: "DISCORD_SESSION_REQUIRED" });
  if (!env?.CHOG_DB || typeof env.CHOG_DB.prepare !== "function") {
    throw new RealtimeTicketError("Cloudflare D1 is not configured.", { status: 503, code: "D1_NOT_CONFIGURED" });
  }
  const urlObject = new URL(url, "https://arena.invalid");
  const inviteId = urlObject.searchParams.get("id");
  if (!validId(inviteId)) throw new RealtimeTicketError("A valid challenge ID is required.", { status: 400, code: "INVITE_ID_INVALID" });
  const row = await env.CHOG_DB.prepare("SELECT * FROM chog_challenge_invites WHERE id = ?1 LIMIT 1").bind(inviteId).first();
  if (!row) throw new RealtimeTicketError("Challenge not found.", { status: 404, code: "INVITE_NOT_FOUND" });

  const user = auth.user;
  const isChallenger = row.challenger_discord_id === user.discordId;
  const isOpponent = row.opponent_discord_id === user.discordId;
  if (!isChallenger && !isOpponent) throw new RealtimeTicketError("This room belongs to another Discord account.", { status: 403, code: "ROOM_FORBIDDEN" });
  const wallet = isChallenger ? row.challenger_wallet : row.opponent_wallet;
  if (!wallet || !user.walletAddress || wallet.toLowerCase() !== user.walletAddress.toLowerCase()) {
    throw new RealtimeTicketError("Connect the wallet linked to this challenge.", { status: 403, code: "ROOM_WALLET_MISMATCH" });
  }
  if (row.status === "PENDING_ACCEPTANCE") {
    throw new RealtimeTicketError("The invited player must accept before anyone can join the realtime room.", { status: 409, code: "INVITE_NOT_ACCEPTED" });
  }
  if (!["TERMS_ACCEPTED", "READY", "IN_BATTLE", "RESULT_PENDING", "SETTLED", "CONDITION_PENDING", "CONDITION_FULFILLED"].includes(row.status)) {
    throw new RealtimeTicketError("This lobby is no longer active.", { status: 409, code: "ROOM_NOT_ACTIVE" });
  }
  if (row.status === "IN_BATTLE") {
    const battle = await env.CHOG_DB.prepare("SELECT status FROM chog_battles WHERE invite_id = ?1 LIMIT 1").bind(inviteId).first();
    if (!battle) throw new RealtimeTicketError("The match is being prepared. Retry in a moment.", { status: 409, code: "BATTLE_NOT_READY" });
  }

  const secret = String(env?.SESSION_SECRET || "");
  if (secret.length < 32) throw new RealtimeTicketError("Realtime ticket signing is not configured.", { status: 503, code: "SESSION_SECRET_MISSING" });
  const now = Date.now();
  const claims = {
    v: 1,
    inviteId,
    discordId: user.discordId,
    username: user.username || user.displayName || "Player",
    walletAddress: wallet.toLowerCase(),
    role: isChallenger ? "challenger" : "opponent",
    issuedAt: now,
    expiresAt: now + 60_000,
    nonce: crypto.randomUUID(),
  };
  return {
    status: 200,
    body: { ticket: await signToken(claims, secret), expiresAt: claims.expiresAt, inviteId, role: claims.role },
    headers: { "Cache-Control": "private, no-store" },
  };
}
