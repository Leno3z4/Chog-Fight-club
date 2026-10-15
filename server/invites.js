import { readDiscordSession } from "./discordAuth.js";

const CHOG_CONTRACT = "0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763";
const DEFAULT_RPC = "https://rpc.monad.xyz";
const ACTIVE_STATUSES = ["PENDING_ACCEPTANCE", "TERMS_ACCEPTED", "READY"];

export class InviteApiError extends Error {
  constructor(message, { status = 500, code = "INVITE_ERROR" } = {}) {
    super(message);
    this.name = "InviteApiError";
    this.status = status;
    this.code = code;
  }
}

function inviteConfig(env) {
  const url = String(env?.SUPABASE_URL ?? "").replace(/\/$/, "");
  const key = String(env?.SUPABASE_SERVICE_ROLE_KEY ?? "");
  if (!url || !key) {
    throw new InviteApiError(
      "Persistent invitations are not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server, then apply the Supabase migration.",
      { status: 503, code: "INVITE_STORE_NOT_CONFIGURED" }
    );
  }
  return { url, key };
}

async function dbRequest({ env, path, method = "GET", body, fetchImpl = fetch, prefer }) {
  const config = inviteConfig(env);
  const headers = {
    apikey: config.key,
    Authorization: `Bearer ${config.key}`,
    Accept: "application/json",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (prefer) headers.Prefer = prefer;
  let response;
  try {
    response = await fetchImpl(`${config.url}/rest/v1/${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new InviteApiError("The invitation store could not be reached.", { status: 502, code: "INVITE_STORE_UNAVAILABLE" });
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 404) {
      throw new InviteApiError("Invitation not found.", { status: 404, code: "INVITE_NOT_FOUND" });
    }
    if (response.status === 409 || response.status === 412) {
      throw new InviteApiError("This invitation changed while you were acting on it. Refresh and try again.", { status: 409, code: "INVITE_STATE_CONFLICT" });
    }
    if (response.status >= 500) {
      throw new InviteApiError("The invitation store returned an error. Check the database migration and server credentials.", { status: 502, code: "INVITE_STORE_ERROR" });
    }
    throw new InviteApiError("The invitation request was rejected by the store.", { status: 400, code: "INVITE_STORE_REJECTED" });
  }
  return payload;
}

function validUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function validDiscordId(value) {
  return typeof value === "string" && /^\d{17,20}$/.test(value);
}
function validTokenId(value) {
  return (typeof value === "string" || typeof value === "number")
    && /^\d{1,78}$/.test(String(value));
}
function cleanCondition(value) {
  if (typeof value !== "string") {
    throw new InviteApiError("Write the condition both players must agree to.", { status: 400, code: "CONDITION_REQUIRED" });
  }
  const text = value.trim().replace(/\s+/g, " ");
  if (text.length < 5 || text.length > 500) {
    throw new InviteApiError("The condition must be between 5 and 500 characters.", { status: 400, code: "CONDITION_LENGTH" });
  }
  if (/https?:\/\/|www\./i.test(text)) {
    throw new InviteApiError("Do not put links in challenge conditions. Keep the task text self-contained.", { status: 400, code: "CONDITION_LINK_BLOCKED" });
  }
  if (/\b(doxx?\w*|self[- ]?harm|suicide|non[- ]?consensual|threaten\w*|sexual violence|leak private|share private address|illegal activity)\b/i.test(text)) {
    throw new InviteApiError("That condition is not allowed. Conditions must be voluntary, harmless, and non-invasive.", { status: 400, code: "CONDITION_UNSAFE" });
  }
  return text;
}

async function hashText(value) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function assertOwnsChog({ owner, tokenId, env, fetchImpl = fetch }) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(String(owner ?? ""))) {
    throw new InviteApiError("Link your wallet before choosing a Chog.", { status: 409, code: "WALLET_NOT_LINKED" });
  }
  if (!validTokenId(tokenId)) throw new InviteApiError("Choose a valid Chog token ID.", { status: 400, code: "INVALID_CHOG_ID" });
  const rpcUrl = String(env?.MONAD_RPC_URL || env?.VITE_MONAD_RPC_URL || DEFAULT_RPC);
  const data = "0x6352211e" + BigInt(String(tokenId)).toString(16).padStart(64, "0");
  let response;
  try {
    response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to: CHOG_CONTRACT, data }, "latest"],
      }),
    });
  } catch {
    throw new InviteApiError("Could not verify Chog ownership on Monad. Try again.", { status: 502, code: "MONAD_RPC_UNAVAILABLE" });
  }
  if (!response.ok) throw new InviteApiError("Could not verify Chog ownership on Monad. Try again.", { status: 502, code: "MONAD_RPC_ERROR" });
  const payload = await response.json().catch(() => null);
  if (payload?.error || typeof payload?.result !== "string" || payload.result.length < 66) {
    throw new InviteApiError("That token is not a readable Chog Genesis NFT. Refresh your roster and try again.", { status: 400, code: "CHOG_NOT_FOUND" });
  }
  const actualOwner = "0x" + payload.result.slice(-40);
  if (actualOwner.toLowerCase() !== owner.toLowerCase()) {
    throw new InviteApiError("That Chog is not currently owned by the wallet linked to this Discord account.", { status: 403, code: "CHOG_NOT_OWNED" });
  }
}

function presentInvite(row, currentDiscordId) {
  return {
    id: row.id,
    challenger: {
      discordId: row.challenger_discord_id,
      username: row.challenger_username,
      wallet: row.challenger_wallet,
      tokenId: row.challenger_token_id,
      termsAccepted: row.challenger_terms_accepted,
      ready: row.challenger_ready,
    },
    opponent: {
      discordId: row.opponent_discord_id,
      username: row.opponent_username,
      wallet: row.opponent_wallet,
      tokenId: row.opponent_token_id,
      termsAccepted: row.opponent_terms_accepted,
      ready: row.opponent_ready,
    },
    condition: row.condition_text,
    termsHash: row.terms_hash,
    status: row.status === "PENDING_ACCEPTANCE" && Date.parse(row.expires_at) <= Date.now() ? "EXPIRED" : row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    viewerRole: currentDiscordId === row.challenger_discord_id ? "challenger" : "opponent",
  };
}

async function getInvite({ env, id, fetchImpl }) {
  const rows = await dbRequest({
    env,
    path: `chog_challenge_invites?select=*&id=eq.${encodeURIComponent(id)}&limit=1`,
    fetchImpl,
  });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) throw new InviteApiError("Invitation not found.", { status: 404, code: "INVITE_NOT_FOUND" });
  if (row.status === "PENDING_ACCEPTANCE" && Date.parse(row.expires_at) <= Date.now()) {
    await dbRequest({
      env,
      path: `chog_challenge_invites?id=eq.${encodeURIComponent(id)}&status=eq.PENDING_ACCEPTANCE`,
      method: "PATCH",
      body: { status: "EXPIRED", updated_at: new Date().toISOString() },
      prefer: "return=minimal",
      fetchImpl,
    });
    row.status = "EXPIRED";
  }
  return row;
}

async function updateState({ env, id, filters = "", body, fetchImpl }) {
  const filter = `chog_challenge_invites?id=eq.${encodeURIComponent(id)}${filters}`;
  const rows = await dbRequest({
    env, path: filter, method: "PATCH", body, prefer: "return=representation", fetchImpl,
  });
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new InviteApiError("This invitation is no longer in the expected state.", { status: 409, code: "INVITE_STATE_CONFLICT" });
  }
  return rows[0];
}

async function createInvite({ user, body, env, origin, fetchImpl }) {
  if (!user.walletAddress) throw new InviteApiError("Link your wallet before creating an invitation.", { status: 409, code: "WALLET_NOT_LINKED" });
  const opponentDiscordId = String(body.opponentDiscordId ?? "").trim();
  if (!validDiscordId(opponentDiscordId)) {
    throw new InviteApiError("Enter the opponent's numeric Discord user ID. The recipient must sign in with that exact Discord account.", { status: 400, code: "OPPONENT_DISCORD_ID_INVALID" });
  }
  if (opponentDiscordId === user.discordId) {
    throw new InviteApiError("You cannot challenge yourself.", { status: 400, code: "SELF_CHALLENGE" });
  }
  const tokenId = String(body.challengerTokenId ?? "");
  const condition = cleanCondition(body.condition);
  if (body.agreeToCondition !== true) {
    throw new InviteApiError("Confirm that the condition is voluntary, harmless, and will be shown publicly if a Pact NFT is minted.", { status: 400, code: "TERMS_NOT_ACKNOWLEDGED" });
  }
  await assertOwnsChog({ owner: user.walletAddress, tokenId, env, fetchImpl });

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const recent = await dbRequest({
    env,
    path: `chog_challenge_invites?select=id,status&challenger_discord_id=eq.${encodeURIComponent(user.discordId)}&created_at=gt.${encodeURIComponent(since)}&limit=30`,
    fetchImpl,
  });
  const openCount = (Array.isArray(recent) ? recent : []).filter((row) => ACTIVE_STATUSES.includes(row.status)).length;
  if (openCount >= 3) {
    throw new InviteApiError("You already have three open challenges. Cancel or finish one before creating another.", { status: 429, code: "TOO_MANY_OPEN_INVITES" });
  }

  const now = new Date();
  const row = {
    id: crypto.randomUUID(),
    challenger_discord_id: user.discordId,
    challenger_username: user.username,
    challenger_wallet: user.walletAddress.toLowerCase(),
    challenger_token_id: tokenId,
    opponent_discord_id: opponentDiscordId,
    condition_text: condition,
    terms_hash: await hashText(condition),
    challenger_terms_accepted: true,
    challenger_terms_accepted_at: now.toISOString(),
    opponent_terms_accepted: false,
    opponent_terms_accepted_at: null,
    challenger_ready: false,
    opponent_ready: false,
    status: "PENDING_ACCEPTANCE",
    expires_at: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
  const created = await dbRequest({
    env, path: "chog_challenge_invites", method: "POST", body: row,
    prefer: "return=representation", fetchImpl,
  });
  const invite = Array.isArray(created) ? created[0] : null;
  if (!invite) throw new InviteApiError("The invitation could not be saved.", { status: 502, code: "INVITE_CREATE_FAILED" });
  return {
    invite: presentInvite(invite, user.discordId),
    inviteUrl: new URL(`/invite.html?id=${encodeURIComponent(invite.id)}`, origin).toString(),
  };
}

export async function handleInviteRequest({
  method, url, cookieHeader = "", env, body = {}, origin, fetchImpl = fetch,
}) {
  const parsedUrl = new URL(url, origin || "http://localhost");
  const auth = await readDiscordSession({ cookieHeader, env });
  if (!auth.authenticated) {
    throw new InviteApiError("Connect Discord and verify the holder role first.", { status: 401, code: "DISCORD_SESSION_REQUIRED" });
  }
  const user = auth.user;

  if (method === "GET") {
    const id = parsedUrl.searchParams.get("id");
    if (id) {
      if (!validUuid(id)) throw new InviteApiError("Invalid invitation ID.", { status: 400, code: "INVITE_ID_INVALID" });
      const row = await getInvite({ env, id, fetchImpl });
      if (![row.challenger_discord_id, row.opponent_discord_id].includes(user.discordId)) {
        throw new InviteApiError("This invitation belongs to another Discord account.", { status: 403, code: "INVITE_FORBIDDEN" });
      }
      return { status: 200, body: { invite: presentInvite(row, user.discordId) }, headers: { "Cache-Control": "private, no-store" } };
    }

    const view = parsedUrl.searchParams.get("view") || "incoming";
    if (!["incoming", "outgoing"].includes(view)) {
      throw new InviteApiError("Choose the incoming or outgoing invitation view.", { status: 400, code: "INVITE_VIEW_INVALID" });
    }
    const field = view === "incoming" ? "opponent_discord_id" : "challenger_discord_id";
    const rows = await dbRequest({
      env,
      path: `chog_challenge_invites?select=*&${field}=eq.${encodeURIComponent(user.discordId)}&order=created_at.desc&limit=50`,
      fetchImpl,
    });
    return {
      status: 200,
      body: { invites: (Array.isArray(rows) ? rows : []).map((row) => presentInvite(row, user.discordId)) },
      headers: { "Cache-Control": "private, no-store" },
    };
  }

  if (method !== "POST") throw new InviteApiError("Method not allowed.", { status: 405, code: "METHOD_NOT_ALLOWED" });
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new InviteApiError("A JSON request body is required.", { status: 400, code: "INVALID_BODY" });
  if (body.action === "create") {
    const created = await createInvite({ user, body, env, origin: parsedUrl.origin, fetchImpl });
    return { status: 201, body: created, headers: { "Cache-Control": "no-store" } };
  }

  const id = String(body.id ?? "");
  if (!validUuid(id)) throw new InviteApiError("Invalid invitation ID.", { status: 400, code: "INVITE_ID_INVALID" });
  const row = await getInvite({ env, id, fetchImpl });
  const isChallenger = user.discordId === row.challenger_discord_id;
  const isOpponent = user.discordId === row.opponent_discord_id;
  if (!isChallenger && !isOpponent) throw new InviteApiError("This invitation belongs to another Discord account.", { status: 403, code: "INVITE_FORBIDDEN" });

  if (body.action === "accept") {
    if (!isOpponent) throw new InviteApiError("Only the challenged player can accept this invitation.", { status: 403, code: "INVITE_ACTION_FORBIDDEN" });
    if (row.status !== "PENDING_ACCEPTANCE" || Date.parse(row.expires_at) <= Date.now()) {
      throw new InviteApiError("This invitation is no longer accepting responses.", { status: 409, code: "INVITE_NOT_PENDING" });
    }
    if (!user.walletAddress) throw new InviteApiError("Link your wallet before accepting the challenge.", { status: 409, code: "WALLET_NOT_LINKED" });
    if (body.agreeToCondition !== true) {
      throw new InviteApiError("Read and explicitly accept the proposed condition before accepting.", { status: 400, code: "TERMS_NOT_ACKNOWLEDGED" });
    }
    const tokenId = String(body.opponentTokenId ?? "");
    await assertOwnsChog({ owner: user.walletAddress, tokenId, env, fetchImpl });
    const now = new Date().toISOString();
    const updated = await updateState({
      env, id, filters: `&status=eq.PENDING_ACCEPTANCE&opponent_discord_id=eq.${encodeURIComponent(user.discordId)}&expires_at=gt.${encodeURIComponent(now)}`,
      body: {
        opponent_username: user.username,
        opponent_wallet: user.walletAddress.toLowerCase(),
        opponent_token_id: tokenId,
        opponent_terms_accepted: true,
        opponent_terms_accepted_at: now,
        status: "TERMS_ACCEPTED",
        updated_at: now,
      },
      fetchImpl,
    });
    return { status: 200, body: { invite: presentInvite(updated, user.discordId) }, headers: { "Cache-Control": "no-store" } };
  }

  if (body.action === "decline") {
    if (!isOpponent) throw new InviteApiError("Only the challenged player can decline this invitation.", { status: 403, code: "INVITE_ACTION_FORBIDDEN" });
    if (row.status !== "PENDING_ACCEPTANCE") throw new InviteApiError("Only a pending invitation can be declined.", { status: 409, code: "INVITE_NOT_PENDING" });
    const updated = await updateState({
      env, id, filters: `&status=eq.PENDING_ACCEPTANCE&opponent_discord_id=eq.${encodeURIComponent(user.discordId)}`,
      body: { status: "DECLINED", updated_at: new Date().toISOString() }, fetchImpl,
    });
    return { status: 200, body: { invite: presentInvite(updated, user.discordId) }, headers: { "Cache-Control": "no-store" } };
  }

  if (body.action === "cancel") {
    if (!isChallenger) throw new InviteApiError("Only the challenger can cancel the pending invitation.", { status: 403, code: "INVITE_ACTION_FORBIDDEN" });
    if (row.status !== "PENDING_ACCEPTANCE") throw new InviteApiError("Only a pending invitation can be cancelled.", { status: 409, code: "INVITE_NOT_PENDING" });
    const updated = await updateState({
      env, id, filters: `&status=eq.PENDING_ACCEPTANCE&challenger_discord_id=eq.${encodeURIComponent(user.discordId)}`,
      body: { status: "CANCELLED", updated_at: new Date().toISOString() }, fetchImpl,
    });
    return { status: 200, body: { invite: presentInvite(updated, user.discordId) }, headers: { "Cache-Control": "no-store" } };
  }

  if (body.action === "ready") {
    if (!["TERMS_ACCEPTED", "READY"].includes(row.status)) {
      throw new InviteApiError("Both players must accept the condition before readiness can be recorded.", { status: 409, code: "INVITE_TERMS_PENDING" });
    }
    const result = await dbRequest({
      env,
      path: "rpc/chog_set_invite_ready",
      method: "POST",
      body: { p_invite_id: id, p_discord_id: user.discordId },
      prefer: "return=representation",
      fetchImpl,
    });
    const updated = Array.isArray(result) ? result[0] : result;
    if (!updated) throw new InviteApiError("Could not record readiness. Refresh the lobby.", { status: 409, code: "INVITE_READY_CONFLICT" });
    return {
      status: 200,
      body: {
        invite: presentInvite(updated, user.discordId),
        multiplayerAvailable: false,
        notice: updated.status === "READY"
          ? "Both players are ready. The invite state is synchronized, but the real-time PvP relay must be deployed before this can safely start a shared battle."
          : "Your readiness is saved. The invitation remains in the lobby while the other player gets ready.",
      },
      headers: { "Cache-Control": "no-store" },
    };
  }

  throw new InviteApiError("Unknown invitation action.", { status: 400, code: "INVITE_ACTION_UNKNOWN" });
}
