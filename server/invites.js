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

function getDb(env) {
  if (!env?.CHOG_DB || typeof env.CHOG_DB.prepare !== "function") {
    throw new InviteApiError(
      "Cloudflare D1 is not configured. Create the D1 database, bind it to this Pages project as CHOG_DB, and apply migrations/0001_challenge_invites.sql plus migrations/0002_player_directory.sql.",
      { status: 503, code: "D1_NOT_CONFIGURED" }
    );
  }
  return env.CHOG_DB;
}

function validUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function validDiscordId(value) {
  return typeof value === "string" && /^\d{17,20}$/.test(value);
}
function normalizeDiscordUsername(value) {
  const username = String(value ?? "").trim().replace(/^@/, "").toLowerCase();
  return /^[a-z0-9][a-z0-9._]{0,30}[a-z0-9_]$/.test(username) ? username : "";
}
function usernameInviteTarget(row) {
  return typeof row?.opponent_discord_id === "string" && row.opponent_discord_id.startsWith("username:")
    ? row.opponent_discord_id.slice("username:".length)
    : "";
}
function isUsernameInviteFor(row, user) {
  const target = usernameInviteTarget(row);
  return Boolean(target && normalizeDiscordUsername(user?.discordUsername) === target);
}
function validTokenId(value) {
  return (typeof value === "string" || typeof value === "number") && /^\d{1,78}$/.test(String(value));
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
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: CHOG_CONTRACT, data }, "latest"] }),
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
  const expired = row.status === "PENDING_ACCEPTANCE" && row.expires_at && Date.parse(row.expires_at) <= Date.now();
  return {
    id: row.id,
    challenger: {
      discordId: row.challenger_discord_id,
      username: row.challenger_username,
      wallet: row.challenger_wallet,
      tokenId: row.challenger_token_id,
      termsAccepted: Boolean(row.challenger_terms_accepted),
      ready: Boolean(row.challenger_ready),
    },
    opponent: {
      discordId: row.opponent_discord_id,
      username: row.opponent_username,
      wallet: row.opponent_wallet,
      tokenId: row.opponent_token_id,
      termsAccepted: Boolean(row.opponent_terms_accepted),
      ready: Boolean(row.opponent_ready),
    },
    condition: row.condition_text,
    termsHash: row.terms_hash,
    status: expired ? "EXPIRED" : row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    viewerRole: currentDiscordId === row.challenger_discord_id ? "challenger" : "opponent",
  };
}

async function getInvite({ env, id }) {
  const db = getDb(env);
  const row = await db.prepare("SELECT * FROM chog_challenge_invites WHERE id = ?1 LIMIT 1").bind(id).first();
  if (!row) throw new InviteApiError("Invitation not found.", { status: 404, code: "INVITE_NOT_FOUND" });
  if (row.status === "PENDING_ACCEPTANCE" && row.expires_at && Date.parse(row.expires_at) <= Date.now()) {
    await db.prepare(
      "UPDATE chog_challenge_invites SET status = 'EXPIRED', updated_at = ?1 WHERE id = ?2 AND status = 'PENDING_ACCEPTANCE'"
    ).bind(new Date().toISOString(), id).run();
    row.status = "EXPIRED";
  }
  return row;
}

async function conditionalUpdate({ env, sql, values, conflictCode = "INVITE_STATE_CONFLICT" }) {
  const db = getDb(env);
  const result = await db.prepare(sql).bind(...values).first();
  if (!result) {
    throw new InviteApiError("This invitation is no longer in the expected state. Refresh and try again.", {
      status: 409,
      code: conflictCode,
    });
  }
  return result;
}

async function createInvite({ user, body, env, origin, fetchImpl }) {
  const db = getDb(env);
  if (!user.walletAddress) throw new InviteApiError("Link your wallet before creating an invitation.", { status: 409, code: "WALLET_NOT_LINKED" });
  const requestedDiscordId = String(body.opponentDiscordId ?? "").trim();
  const requestedUsername = normalizeDiscordUsername(body.opponentUsername);
  let opponentDiscordId = "";
  let opponentName = "";

  if (validDiscordId(requestedDiscordId)) {
    if (requestedDiscordId === user.discordId) throw new InviteApiError("You cannot challenge yourself.", { status: 400, code: "SELF_CHALLENGE" });
    const opponent = await db.prepare(
      "SELECT discord_id, username, display_name FROM chog_players WHERE discord_id = ?1 LIMIT 1"
    ).bind(requestedDiscordId).first();
    if (!opponent) {
      throw new InviteApiError(
        "That selected player is no longer in the Arena directory. Search again and select the username result.",
        { status: 404, code: "PLAYER_NOT_REGISTERED" },
      );
    }
    opponentDiscordId = requestedDiscordId;
    opponentName = String(opponent.display_name || opponent.username || "Discord player");
  } else {
    if (!requestedUsername) {
      throw new InviteApiError("Select a player from search or choose a valid Discord username to invite.", { status: 400, code: "OPPONENT_USERNAME_INVALID" });
    }
    if (requestedUsername === normalizeDiscordUsername(user.discordUsername)) {
      throw new InviteApiError("You cannot challenge yourself.", { status: 400, code: "SELF_CHALLENGE" });
    }
    // Unregistered usernames can be invited. Their Discord identity is bound on acceptance.
    opponentDiscordId = `username:${requestedUsername}`;
    opponentName = `@${requestedUsername}`;
  }

  const tokenId = String(body.challengerTokenId ?? "");
  const condition = cleanCondition(body.condition);
  if (body.agreeToCondition !== true) {
    throw new InviteApiError("Confirm that the condition is voluntary, harmless, and will be shown publicly if a Pact NFT is minted.", { status: 400, code: "TERMS_NOT_ACKNOWLEDGED" });
  }
  await assertOwnsChog({ owner: user.walletAddress, tokenId, env, fetchImpl });

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const recent = await db.prepare(
    "SELECT COUNT(*) AS count FROM chog_challenge_invites WHERE challenger_discord_id = ?1 AND created_at > ?2 AND status IN ('PENDING_ACCEPTANCE','TERMS_ACCEPTED','READY')"
  ).bind(user.discordId, since).first();
  if (Number(recent?.count ?? 0) >= 3) {
    throw new InviteApiError("You already have three open challenges. Cancel or finish one before creating another.", { status: 429, code: "TOO_MANY_OPEN_INVITES" });
  }

  const now = new Date();
  const invite = {
    id: crypto.randomUUID(),
    challenger_discord_id: user.discordId,
    challenger_username: user.username,
    challenger_wallet: user.walletAddress.toLowerCase(),
    challenger_token_id: tokenId,
    opponent_discord_id: opponentDiscordId,
    opponent_username: opponentName,
    opponent_wallet: null,
    opponent_token_id: null,
    condition_text: condition,
    terms_hash: await hashText(condition),
    challenger_terms_accepted: 1,
    challenger_terms_accepted_at: now.toISOString(),
    opponent_terms_accepted: 0,
    opponent_terms_accepted_at: null,
    challenger_ready: 0,
    opponent_ready: 0,
    status: "PENDING_ACCEPTANCE",
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    // Pending invites persist until accepted, declined, or cancelled; no automatic expiry.
    expires_at: null,
  };

  await db.prepare(
    `INSERT INTO chog_challenge_invites (
      id, challenger_discord_id, challenger_username, challenger_wallet, challenger_token_id,
      opponent_discord_id, opponent_username, opponent_wallet, opponent_token_id, condition_text,
      terms_hash, challenger_terms_accepted, challenger_terms_accepted_at, opponent_terms_accepted,
      opponent_terms_accepted_at, challenger_ready, opponent_ready, status, created_at, updated_at, expires_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)`
  ).bind(
    invite.id, invite.challenger_discord_id, invite.challenger_username, invite.challenger_wallet,
    invite.challenger_token_id, invite.opponent_discord_id, invite.opponent_username, invite.opponent_wallet,
    invite.opponent_token_id, invite.condition_text, invite.terms_hash, invite.challenger_terms_accepted,
    invite.challenger_terms_accepted_at, invite.opponent_terms_accepted, invite.opponent_terms_accepted_at,
    invite.challenger_ready, invite.opponent_ready, invite.status, invite.created_at, invite.updated_at, invite.expires_at,
  ).run();

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
  if (!auth.authenticated) throw new InviteApiError("Connect Discord and verify the holder role first.", { status: 401, code: "DISCORD_SESSION_REQUIRED" });
  const user = auth.user;
  const db = getDb(env);

  if (method === "GET") {
    const id = parsedUrl.searchParams.get("id");
    if (id) {
      if (!validUuid(id)) throw new InviteApiError("Invalid invitation ID.", { status: 400, code: "INVITE_ID_INVALID" });
      const row = await getInvite({ env, id });
      if (![row.challenger_discord_id, row.opponent_discord_id].includes(user.discordId) && !isUsernameInviteFor(row, user)) {
        throw new InviteApiError("This invitation belongs to another Discord account.", { status: 403, code: "INVITE_FORBIDDEN" });
      }
      return { status: 200, body: { invite: presentInvite(row, user.discordId) }, headers: { "Cache-Control": "private, no-store" } };
    }

    const view = parsedUrl.searchParams.get("view") || "incoming";
    if (!["incoming", "outgoing"].includes(view)) throw new InviteApiError("Choose the incoming or outgoing invitation view.", { status: 400, code: "INVITE_VIEW_INVALID" });
    const result = view === "incoming"
      ? await db.prepare(
          "SELECT * FROM chog_challenge_invites WHERE opponent_discord_id = ?1 OR opponent_discord_id = ?2 ORDER BY created_at DESC LIMIT 50"
        ).bind(user.discordId, `username:${normalizeDiscordUsername(user.discordUsername)}`).all()
      : await db.prepare(
          "SELECT * FROM chog_challenge_invites WHERE challenger_discord_id = ?1 ORDER BY created_at DESC LIMIT 50"
        ).bind(user.discordId).all();
    const rows = Array.isArray(result?.results) ? result.results : [];
    return {
      status: 200,
      body: { invites: rows.map((row) => presentInvite(row, user.discordId)) },
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
  const row = await getInvite({ env, id });
  const isChallenger = user.discordId === row.challenger_discord_id;
  const isUsernameClaim = isUsernameInviteFor(row, user);
  const isOpponent = user.discordId === row.opponent_discord_id || isUsernameClaim;
  if (!isChallenger && !isOpponent) throw new InviteApiError("This invitation belongs to another Discord account.", { status: 403, code: "INVITE_FORBIDDEN" });

  if (body.action === "accept") {
    if (!isOpponent) throw new InviteApiError("Only the challenged player can accept this invitation.", { status: 403, code: "INVITE_ACTION_FORBIDDEN" });
    if (row.status !== "PENDING_ACCEPTANCE" || Date.parse(row.expires_at) <= Date.now()) {
      throw new InviteApiError("This invitation is no longer accepting responses.", { status: 409, code: "INVITE_NOT_PENDING" });
    }
    if (!user.walletAddress) throw new InviteApiError("Link your wallet before accepting the challenge.", { status: 409, code: "WALLET_NOT_LINKED" });
    if (body.agreeToCondition !== true) throw new InviteApiError("Read and explicitly accept the proposed condition before accepting.", { status: 400, code: "TERMS_NOT_ACKNOWLEDGED" });

    const tokenId = String(body.opponentTokenId ?? "");
    await assertOwnsChog({ owner: user.walletAddress, tokenId, env, fetchImpl });
    const now = new Date().toISOString();
    const updated = await conditionalUpdate({
      env,
      sql: `UPDATE chog_challenge_invites SET
        opponent_discord_id = ?1, opponent_username = ?2, opponent_wallet = ?3, opponent_token_id = ?4,
        opponent_terms_accepted = 1, opponent_terms_accepted_at = ?5,
        status = 'TERMS_ACCEPTED', updated_at = ?5
        WHERE id = ?6 AND status = 'PENDING_ACCEPTANCE' AND opponent_discord_id = ?7
        RETURNING *`,
      values: [user.discordId, user.username, user.walletAddress.toLowerCase(), tokenId, now, id, row.opponent_discord_id],
    });
    return { status: 200, body: { invite: presentInvite(updated, user.discordId) }, headers: { "Cache-Control": "no-store" } };
  }

  if (body.action === "decline") {
    if (!isOpponent) throw new InviteApiError("Only the challenged player can decline this invitation.", { status: 403, code: "INVITE_ACTION_FORBIDDEN" });
    const updated = await conditionalUpdate({
      env,
      sql: "UPDATE chog_challenge_invites SET opponent_discord_id = ?1, status = 'DECLINED', updated_at = ?2 WHERE id = ?3 AND status = 'PENDING_ACCEPTANCE' AND opponent_discord_id = ?4 RETURNING *",
      values: [user.discordId, new Date().toISOString(), id, row.opponent_discord_id],
    });
    return { status: 200, body: { invite: presentInvite(updated, user.discordId) }, headers: { "Cache-Control": "no-store" } };
  }

  if (body.action === "cancel") {
    if (!isChallenger) throw new InviteApiError("Only the challenger can cancel the pending invitation.", { status: 403, code: "INVITE_ACTION_FORBIDDEN" });
    const updated = await conditionalUpdate({
      env,
      sql: "UPDATE chog_challenge_invites SET status = 'CANCELLED', updated_at = ?1 WHERE id = ?2 AND status = 'PENDING_ACCEPTANCE' AND challenger_discord_id = ?3 RETURNING *",
      values: [new Date().toISOString(), id, user.discordId],
    });
    return { status: 200, body: { invite: presentInvite(updated, user.discordId) }, headers: { "Cache-Control": "no-store" } };
  }

  if (body.action === "ready") {
    if (!["TERMS_ACCEPTED", "READY"].includes(row.status)) {
      throw new InviteApiError("Both players must accept the condition before readiness can be recorded.", { status: 409, code: "INVITE_TERMS_PENDING" });
    }
    const requiredWallet = isChallenger ? row.challenger_wallet : row.opponent_wallet;
    if (!user.walletAddress || !requiredWallet || user.walletAddress.toLowerCase() !== requiredWallet.toLowerCase()) {
      throw new InviteApiError("Reconnect the wallet selected for this challenge before confirming readiness.", { status: 403, code: "INVITE_WALLET_MISMATCH" });
    }
    const now = new Date().toISOString();
    const updated = await conditionalUpdate({
      env,
      sql: `UPDATE chog_challenge_invites SET
        challenger_ready = CASE WHEN challenger_discord_id = ?1 THEN 1 ELSE challenger_ready END,
        opponent_ready = CASE WHEN opponent_discord_id = ?1 THEN 1 ELSE opponent_ready END,
        status = CASE
          WHEN (challenger_ready = 1 OR challenger_discord_id = ?1)
           AND (opponent_ready = 1 OR opponent_discord_id = ?1) THEN 'READY'
          ELSE status
        END,
        updated_at = ?2
        WHERE id = ?3 AND status IN ('TERMS_ACCEPTED','READY')
          AND (challenger_discord_id = ?1 OR opponent_discord_id = ?1)
        RETURNING *`,
      values: [user.discordId, now, id],
      conflictCode: "INVITE_READY_CONFLICT",
    });
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
