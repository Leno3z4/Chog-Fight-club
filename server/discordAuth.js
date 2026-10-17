import { recoverMessageAddress } from "viem";

const SESSION_COOKIE = "chog_session";
const STATE_COOKIE = "chog_oauth_state";
const WALLET_CHALLENGE_COOKIE = "chog_wallet_challenge";
const DEFAULT_HOLDER_ROLE_ID = "1545507860455096460";
const DEFAULT_GUILD_ID = "1253481714710220810";
const DISCORD_API = "https://discord.com/api/v10";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class DiscordAuthError extends Error {
  constructor(message, { status = 500, code = "DISCORD_AUTH_ERROR" } = {}) {
    super(message);
    this.name = "DiscordAuthError";
    this.status = status;
    this.code = code;
  }
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmac(value, secret) {
  if (!globalThis.crypto?.subtle) throw new DiscordAuthError("This runtime does not provide Web Crypto.", { status: 500, code: "CRYPTO_UNAVAILABLE" });
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return base64UrlEncode(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

async function seal(payload, secret) {
  const encoded = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  return encoded + "." + await hmac(encoded, secret);
}

async function unseal(value, secret) {
  if (!value || typeof value !== "string") return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const encoded = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  const expected = await hmac(encoded, secret);
  if (!constantTimeEqual(signature, expected)) return null;
  try {
    return JSON.parse(decoder.decode(base64UrlDecode(encoded)));
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const result = {};
  for (const part of String(header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    result[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return result;
}

function cookie(name, value, { maxAge, secure = true } = {}) {
  const fields = [`${name}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (secure) fields.push("Secure");
  if (Number.isFinite(maxAge)) fields.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  return fields.join("; ");
}

function clearCookie(name, secure) {
  return cookie(name, "", { maxAge: 0, secure });
}

function config(env, origin) {
  const required = ["DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "SESSION_SECRET"];
  const missing = required.filter((key) => !String(env?.[key] ?? "").trim());
  if (missing.length) {
    throw new DiscordAuthError(
      `Discord access is not configured yet. Missing server settings: ${missing.join(", ")}.`,
      { status: 503, code: "DISCORD_CONFIG_MISSING" }
    );
  }
  const redirectUri = env.DISCORD_REDIRECT_URI || new URL("/api/discord/callback", origin).toString();
  return {
    clientId: env.DISCORD_CLIENT_ID,
    clientSecret: env.DISCORD_CLIENT_SECRET,
    guildId: env.DISCORD_GUILD_ID || DEFAULT_GUILD_ID,
    holderRoleId: env.DISCORD_HOLDER_ROLE_ID || DEFAULT_HOLDER_ROLE_ID,
    sessionSecret: env.SESSION_SECRET,
    redirectUri,
  };
}

function redirect(path, origin, cookies = []) {
  return { status: 302, location: new URL(path, origin).toString(), cookies };
}

function oauthErrorPath(code) {
  return "/?error=" + encodeURIComponent(code);
}

export async function startDiscordOAuth({ origin, env, secure = true, returnTo = "/profile.html" }) {
  const settings = config(env, origin);
  const random = new Uint8Array(32);
  crypto.getRandomValues(random);
  const state = base64UrlEncode(random);
  const safeReturnTo = typeof returnTo === "string"
    && returnTo.startsWith("/")
    && !returnTo.startsWith("//")
    && !returnTo.includes("\\r")
    && !returnTo.includes("\\n")
    ? returnTo
    : "/profile.html";
  const stateCookie = await seal({ state, exp: Date.now() + 10 * 60 * 1000, returnTo: safeReturnTo }, settings.sessionSecret);
  const authorize = new URL("https://discord.com/oauth2/authorize");
  authorize.searchParams.set("client_id", settings.clientId);
  authorize.searchParams.set("redirect_uri", settings.redirectUri);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", "identify guilds.members.read");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("prompt", "consent");

  return {
    status: 302,
    location: authorize.toString(),
    cookies: [cookie(STATE_COOKIE, stateCookie, { maxAge: 600, secure })],
  };
}

export async function finishDiscordOAuth({ requestUrl, cookieHeader, env, secure = true, fetchImpl = fetch }) {
  const url = new URL(requestUrl);
  const clearState = clearCookie(STATE_COOKIE, secure);
  let settings;
  try {
    settings = config(env, url.origin);
  } catch (error) {
    return redirect(oauthErrorPath(error.code || "discord_configuration"), url.origin, [clearState]);
  }

  const cookies = parseCookies(cookieHeader);
  const statePayload = await unseal(cookies[STATE_COOKIE], settings.sessionSecret);
  const returnedState = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!statePayload || statePayload.exp < Date.now() || !returnedState || !constantTimeEqual(statePayload.state, returnedState)) {
    return redirect(oauthErrorPath("discord_state_invalid"), url.origin, [clearState]);
  }
  if (!code) return redirect(oauthErrorPath("discord_consent_cancelled"), url.origin, [clearState]);

  let tokenPayload;
  try {
    const form = new URLSearchParams({
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: settings.redirectUri,
    });
    const tokenResponse = await fetchImpl("https://discord.com/api/v10/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: form,
    });
    if (!tokenResponse.ok) throw new Error("Token exchange failed.");
    tokenPayload = await tokenResponse.json();
  } catch {
    return redirect(oauthErrorPath("discord_token_exchange_failed"), url.origin, [clearState]);
  }

  if (!tokenPayload?.access_token) {
    return redirect(oauthErrorPath("discord_token_missing"), url.origin, [clearState]);
  }

  let user;
  let member;
  try {
    const headers = { Authorization: `Bearer ${tokenPayload.access_token}`, accept: "application/json" };
    const userResponse = await fetchImpl(`${DISCORD_API}/users/@me`, { headers });
    if (!userResponse.ok) throw new Error("User lookup failed.");
    user = await userResponse.json();

    const memberResponse = await fetchImpl(
      `${DISCORD_API}/users/@me/guilds/${encodeURIComponent(settings.guildId)}/member`,
      { headers }
    );
    if (memberResponse.status === 404) {
      return redirect(oauthErrorPath("discord_not_in_server"), url.origin, [clearState]);
    }
    if (!memberResponse.ok) throw new Error("Guild membership lookup failed.");
    member = await memberResponse.json();
  } catch {
    return redirect(oauthErrorPath("discord_role_check_failed"), url.origin, [clearState]);
  }

  const roles = Array.isArray(member?.roles) ? member.roles.map(String) : [];
  // The project owner can enter without the holder role, but must still authenticate with Discord.
  const ownerDiscordIds = String(env?.ADMIN_DISCORD_IDS || "1304031867162595361")
    .split(",").map((value) => value.trim()).filter(Boolean);
  const isAdmin = ownerDiscordIds.includes(String(user.id));
  if (!isAdmin && !roles.includes(settings.holderRoleId)) {
    return redirect(oauthErrorPath("holder_role_required"), url.origin, [clearState]);
  }

  const now = Date.now();
  const session = {
    discordId: String(user.id),
    isAdmin,
    username: String(user.global_name || user.username || "Discord member"),
    displayName: String(user.global_name || user.username || "Discord member"),
    discordUsername: String(user.username || "discord-user"),
    discriminator: String(user.discriminator || ""),
    avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128` : null,
    guildId: settings.guildId,
    roleId: settings.holderRoleId,
    verifiedAt: now,
    exp: now + 6 * 60 * 60 * 1000,
  };
  const sessionCookie = await seal(session, settings.sessionSecret);
  const returnTo = typeof statePayload.returnTo === "string"
    && statePayload.returnTo.startsWith("/")
    && !statePayload.returnTo.startsWith("//")
    && !statePayload.returnTo.includes("\\r")
    && !statePayload.returnTo.includes("\\n")
    ? statePayload.returnTo
    : "/profile.html";
  return redirect(returnTo, url.origin, [
    clearState,
    cookie(SESSION_COOKIE, sessionCookie, { maxAge: 6 * 60 * 60, secure }),
  ]);
}

export async function readDiscordSession({ cookieHeader, env }) {
  const secret = String(env?.SESSION_SECRET ?? "");
  if (!secret) return { authenticated: false, reason: "not_configured" };
  const raw = parseCookies(cookieHeader)[SESSION_COOKIE];
  const session = await unseal(raw, secret);
  if (!session || !session.discordId || !session.exp || session.exp < Date.now()) {
    return { authenticated: false };
  }
  return {
    authenticated: true,
    user: {
      discordId: session.discordId,
      username: session.username,
      displayName: session.displayName || session.username,
      discordUsername: session.discordUsername || session.username,
      discriminator: session.discriminator,
      avatar: session.avatar,
      roleId: session.roleId,
      isAdmin: Boolean(session.isAdmin),
      walletAddress: session.walletAddress ?? null,
      walletLinkedAt: session.walletLinkedAt ?? null,
      verifiedAt: session.verifiedAt,
      expiresAt: session.exp,
    },
  };
}

async function readRawSession(cookieHeader, env) {
  const secret = String(env?.SESSION_SECRET ?? "");
  if (!secret) throw new DiscordAuthError("Discord session signing is not configured.", { status: 503, code: "DISCORD_CONFIG_MISSING" });
  const raw = parseCookies(cookieHeader)[SESSION_COOKIE];
  const session = await unseal(raw, secret);
  if (!session || !session.discordId || !session.exp || session.exp < Date.now()) {
    throw new DiscordAuthError("Connect Discord again before linking a wallet.", { status: 401, code: "DISCORD_SESSION_REQUIRED" });
  }
  return { session, secret };
}

export async function startWalletLink({ cookieHeader, env, origin, secure = true }) {
  const { session, secret } = await readRawSession(cookieHeader, env);
  const random = new Uint8Array(32);
  crypto.getRandomValues(random);
  const nonce = base64UrlEncode(random);
  const issuedAt = new Date().toISOString();
  const expiresAt = Date.now() + 5 * 60 * 1000;
  const message = [
    "Link this wallet to Chog Fight Club.",
    `Domain: ${new URL(origin).host}`,
    `Origin: ${origin}`,
    `Discord user ID: ${session.discordId}`,
    `Nonce: ${nonce}`,
    `Issued at: ${issuedAt}`,
    `Expires at: ${new Date(expiresAt).toISOString()}`,
    "This signature does not authorize NFT transfers or token spending.",
  ].join("\n");
  const challengeCookie = await seal({ nonce, message, discordId: session.discordId, exp: expiresAt }, secret);
  return {
    status: 200,
    body: { message, expiresAt },
    cookies: [cookie(WALLET_CHALLENGE_COOKIE, challengeCookie, { maxAge: 300, secure })],
  };
}

export async function finishWalletLink({ cookieHeader, env, message, signature, secure = true }) {
  const { session, secret } = await readRawSession(cookieHeader, env);
  const cookies = parseCookies(cookieHeader);
  const challenge = await unseal(cookies[WALLET_CHALLENGE_COOKIE], secret);
  if (!challenge || challenge.exp < Date.now() || challenge.discordId !== session.discordId || challenge.message !== message) {
    throw new DiscordAuthError("Wallet-link challenge expired or does not match this Discord session. Try again.", { status: 400, code: "WALLET_CHALLENGE_INVALID" });
  }
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) {
    throw new DiscordAuthError("A valid wallet signature is required.", { status: 400, code: "WALLET_SIGNATURE_INVALID" });
  }
  let address;
  try {
    address = await recoverMessageAddress({ message, signature });
  } catch {
    throw new DiscordAuthError("Could not verify this wallet signature.", { status: 400, code: "WALLET_SIGNATURE_INVALID" });
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new DiscordAuthError("The wallet signature recovered an invalid address.", { status: 400, code: "WALLET_ADDRESS_INVALID" });
  }

  const updatedSession = {
    ...session,
    walletAddress: address.toLowerCase(),
    walletLinkedAt: Date.now(),
  };
  const sessionCookie = await seal(updatedSession, secret);
  return {
    status: 200,
    body: { ok: true, walletAddress: updatedSession.walletAddress, walletLinkedAt: updatedSession.walletLinkedAt },
    cookies: [
      cookie(SESSION_COOKIE, sessionCookie, { maxAge: Math.max(0, (updatedSession.exp - Date.now()) / 1000), secure }),
      clearCookie(WALLET_CHALLENGE_COOKIE, secure),
    ],
  };
}

export function endDiscordSession({ secure = true }) {
  return { status: 200, cookies: [clearCookie(SESSION_COOKIE, secure), clearCookie(STATE_COOKIE, secure), clearCookie(WALLET_CHALLENGE_COOKIE, secure)], body: { ok: true } };
}
