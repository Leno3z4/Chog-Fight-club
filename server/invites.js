import { readDiscordSession } from "./discordAuth.js";
import { inviteExpiryAt, isPendingInviteExpired } from "./launchPolicy.js";

const CHOG_CONTRACT = "0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763";
const DEFAULT_RPC = "https://rpc.monad.xyz";
const ACTIVE_STATUSES = ["PENDING_ACCEPTANCE", "TERMS_ACCEPTED", "READY"];
const PENDING_DEMAND = "__PENDING_LOBBY_DEMAND__";

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
  // Until the target registers, only the Discord OAuth identity currently holding the exact
  // username may view/respond. Registration binds the row to that account's immutable user ID.
  return Boolean(
    target &&
    row?.status === "PENDING_ACCEPTANCE" &&
    !row?.expires_at &&
    target === normalizeDiscordUsername(user?.discordUsername)
  );
}
function validPrototypeFighter(value) {
  const id = String(value ?? "");
  return ["prototype:ember", "prototype:tide", "prototype:volt"].includes(id) ? id : "";
}
function validTokenId(value) {
  return (typeof value === "string" || typeof value === "number") && /^\d{1,78}$/.test(String(value));
}
function cleanCondition(value) {
  if (typeof value !== "string") {
    throw new InviteApiError("Write the condition both players must agree to.", { status: 400, code: "CONDITION_REQUIRED" });
  }
  const text = value.trim().replace(/\s+/g, " ");
  if (text === PENDING_DEMAND) {
    throw new InviteApiError("Write your own demand in the lobby.", { status: 400, code: "CONDITION_REQUIRED" });
  }
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
  const expired = isPendingInviteExpired(row);
  const pendingDemand = row.condition_text === PENDING_DEMAND;
  const challengerDemand = pendingDemand ? "" : (row.condition_text || "");
  const opponentDemand = row.opponent_demand_text || "";
  const reservedUsername = usernameInviteTarget(row);
  return {
    id: row.id,
    challenger: {
      discordId: row.challenger_discord_id,
      username: row.challenger_username,
      wallet: row.challenger_wallet || null,
      tokenId: row.challenger_token_id || null,
      termsAccepted: Boolean(row.challenger_terms_accepted),
      ready: Boolean(row.challenger_ready),
    },
    opponent: {
      discordId: reservedUsername ? null : row.opponent_discord_id,
      username: reservedUsername ? `@${reservedUsername}` : row.opponent_username,
      wallet: row.opponent_wallet || null,
      tokenId: row.opponent_token_id || null,
      termsAccepted: Boolean(row.opponent_terms_accepted),
      ready: Boolean(row.opponent_ready),
    },
    condition: challengerDemand,
    targetUsername: reservedUsername || null,
    registrationPending: Boolean(reservedUsername),
    gameMode: row.game_mode === "PRACTICE" ? "PRACTICE" : "OFFICIAL",
    challengerDemand,
    opponentDemand,
    termsHash: challengerDemand && opponentDemand ? row.terms_hash : "",
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
  if (isPendingInviteExpired(row)) {
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

async function createInvite({ user, body, env, origin }) {
  const db = getDb(env);
  const requestedDiscordId = String(body.opponentDiscordId ?? "").trim();
  const rawUsername = String(body.opponentUsername ?? "").trim();
  const requestedUsername = normalizeDiscordUsername(rawUsername);
  let opponentDiscordId = "anyone";
  let opponentName = "Anyone with this link";
  let unresolvedUsernameTarget = false;

  // A blank target creates a link any eligible holder can claim. A username target can be
  // reserved before signup; on verified registration the row is bound to that user's Discord ID.
  if (requestedDiscordId || rawUsername) {
    if (validDiscordId(requestedDiscordId)) {
      if (requestedDiscordId === user.discordId) {
        throw new InviteApiError("You cannot challenge yourself.", { status: 400, code: "SELF_CHALLENGE" });
      }
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
      if (requestedDiscordId) {
        throw new InviteApiError("Select a registered player, enter a valid Discord username, or clear the field to create a shareable link.", { status: 400, code: "OPPONENT_USERNAME_INVALID" });
      }
      if (!requestedUsername) {
        throw new InviteApiError("Enter a valid Discord username, select a registered player, or leave the target empty to create a shareable link.", { status: 400, code: "OPPONENT_USERNAME_INVALID" });
      }
      if (requestedUsername === normalizeDiscordUsername(user.discordUsername)) {
        throw new InviteApiError("You cannot challenge yourself.", { status: 400, code: "SELF_CHALLENGE" });
      }
      const registeredOpponent = await db.prepare(
        "SELECT discord_id, username, display_name FROM chog_players WHERE username = ?1 COLLATE NOCASE LIMIT 1"
      ).bind(requestedUsername).first();
      if (registeredOpponent) {
        if (registeredOpponent.discord_id === user.discordId) {
          throw new InviteApiError("You cannot challenge yourself.", { status: 400, code: "SELF_CHALLENGE" });
        }
        opponentDiscordId = registeredOpponent.discord_id;
        opponentName = String(registeredOpponent.display_name || registeredOpponent.username || requestedUsername);
      } else {
        opponentDiscordId = `username:${requestedUsername}`;
        opponentName = `@${requestedUsername}`;
        unresolvedUsernameTarget = true;
      }
    }
  }

  const practiceMode = body.gameMode === "PRACTICE";
  if (practiceMode && !user.isAdmin) {
    throw new InviteApiError("Prototype multiplayer is available only to the Arena owner for testing.", { status: 403, code: "PRACTICE_MODE_FORBIDDEN" });
  }

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
    game_mode: practiceMode ? "PRACTICE" : "OFFICIAL",
    challenger_discord_id: user.discordId,
    challenger_username: user.username,
    // Empty fighter fields are deliberate until both players enter the lobby.
    challenger_wallet: "",
    challenger_token_id: "",
    opponent_discord_id: opponentDiscordId,
    opponent_username: opponentName,
    opponent_wallet: null,
    opponent_token_id: null,
    // This internal placeholder satisfies the legacy D1 schema; it is never presented
    // as a player demand and cannot be accepted as final terms.
    condition_text: PENDING_DEMAND,
    terms_hash: await hashText(PENDING_DEMAND),
    challenger_terms_accepted: 0,
    challenger_terms_accepted_at: now.toISOString(),
    opponent_terms_accepted: 0,
    opponent_terms_accepted_at: null,
    challenger_ready: 0,
    opponent_ready: 0,
    status: "PENDING_ACCEPTANCE",
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    expires_at: unresolvedUsernameTarget ? null : inviteExpiryAt(now),
  };

  await db.prepare(
    `INSERT INTO chog_challenge_invites (
      id, challenger_discord_id, challenger_username, challenger_wallet, challenger_token_id,
      opponent_discord_id, opponent_username, opponent_wallet, opponent_token_id, condition_text,
      terms_hash, challenger_terms_accepted, challenger_terms_accepted_at, opponent_terms_accepted,
      opponent_terms_accepted_at, challenger_ready, opponent_ready, status, created_at, updated_at, expires_at, game_mode
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)`
  ).bind(
    invite.id, invite.challenger_discord_id, invite.challenger_username, invite.challenger_wallet,
    invite.challenger_token_id, invite.opponent_discord_id, invite.opponent_username, invite.opponent_wallet,
    invite.opponent_token_id, invite.condition_text, invite.terms_hash, invite.challenger_terms_accepted,
    invite.challenger_terms_accepted_at, invite.opponent_terms_accepted, invite.opponent_terms_accepted_at,
    invite.challenger_ready, invite.opponent_ready, invite.status, invite.created_at, invite.updated_at, invite.expires_at, invite.game_mode,
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
      const isGenericRecipient = row.opponent_discord_id === "anyone" && row.status === "PENDING_ACCEPTANCE" && user.discordId !== row.challenger_discord_id;
      const isParticipant = [row.challenger_discord_id, row.opponent_discord_id].includes(user.discordId) || isUsernameInviteFor(row, user) || isGenericRecipient;
      if (!isParticipant && !(user.isAdmin && row.status === "DISPUTED")) {
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
  const isGenericClaim = row.opponent_discord_id === "anyone" && row.status === "PENDING_ACCEPTANCE" && user.discordId !== row.challenger_discord_id;
  const isOpponent = user.discordId === row.opponent_discord_id || isUsernameClaim || isGenericClaim;
  if (!isChallenger && !isOpponent) throw new InviteApiError("This invitation belongs to another Discord account.", { status: 403, code: "INVITE_FORBIDDEN" });

  if (body.action === "accept") {
    if (!isOpponent) throw new InviteApiError("Only the intended recipient can accept this invitation.", { status: 403, code: "INVITE_ACTION_FORBIDDEN" });
    if (row.status !== "PENDING_ACCEPTANCE" || isPendingInviteExpired(row)) {
      throw new InviteApiError("This invitation is no longer accepting responses.", { status: 409, code: "INVITE_NOT_PENDING" });
    }
    const now = new Date().toISOString();
    const updated = await conditionalUpdate({
      env,
      sql: `UPDATE chog_challenge_invites SET
        opponent_discord_id = ?1, opponent_username = ?2, opponent_wallet = NULL, opponent_token_id = NULL,
        opponent_terms_accepted = 0, opponent_terms_accepted_at = NULL,
        status = 'TERMS_ACCEPTED', updated_at = ?3
        WHERE id = ?4 AND status = 'PENDING_ACCEPTANCE' AND opponent_discord_id = ?5 AND challenger_discord_id <> ?1
        RETURNING *`,
      values: [user.discordId, user.username, now, id, row.opponent_discord_id],
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

  if (body.action === "selectFighter") {
    if (!["TERMS_ACCEPTED", "READY"].includes(row.status) || row.pact_id || row.pact_tx_hash
      || row.challenger_pact_signature || row.opponent_pact_signature) {
      throw new InviteApiError("Choose a Chog after joining the lobby and before the Pact is signed.", { status: 409, code: "FIGHTER_SELECTION_LOCKED" });
    }
    if (!user.walletAddress) {
      throw new InviteApiError("Connect and verify the wallet linked to your Discord account before saving a Chog.", { status: 409, code: "WALLET_NOT_LINKED" });
    }
    const practiceMode = row.game_mode === "PRACTICE";
    const tokenId = practiceMode ? validPrototypeFighter(body.tokenId) : String(body.tokenId ?? "");
    if (!tokenId) {
      throw new InviteApiError(practiceMode ? "Choose Ember, Tide, or Volt for prototype practice." : "Choose a valid Chog token.", { status: 400, code: "FIGHTER_INVALID" });
    }
    if (!practiceMode) await assertOwnsChog({ owner: user.walletAddress, tokenId, env, fetchImpl });
    const walletColumn = isChallenger ? "challenger_wallet" : "opponent_wallet";
    const tokenColumn = isChallenger ? "challenger_token_id" : "opponent_token_id";
    const now = new Date().toISOString();
    const updated = await conditionalUpdate({
      env,
      sql: `UPDATE chog_challenge_invites SET
        ${walletColumn} = ?1, ${tokenColumn} = ?2,
        challenger_terms_accepted = 0, challenger_terms_accepted_at = ?3,
        opponent_terms_accepted = 0, opponent_terms_accepted_at = NULL,
        challenger_ready = 0, opponent_ready = 0, status = 'TERMS_ACCEPTED', updated_at = ?3
        WHERE id = ?4 AND status IN ('TERMS_ACCEPTED','READY') AND pact_id IS NULL AND pact_tx_hash IS NULL
          AND challenger_pact_signature IS NULL AND opponent_pact_signature IS NULL
          AND (challenger_discord_id = ?5 OR opponent_discord_id = ?5)
        RETURNING *`,
      values: [user.walletAddress.toLowerCase(), tokenId, now, id, user.discordId],
      conflictCode: "FIGHTER_SELECTION_CONFLICT",
    });
    return {
      status: 200,
      body: { invite: presentInvite(updated, user.discordId), notice: "Your Chog is saved to this lobby. It will not be transferred." },
      headers: { "Cache-Control": "no-store" },
    };
  }

  if (body.action === "saveDemand") {
    if (!row.challenger_wallet || !row.challenger_token_id || !row.opponent_wallet || !row.opponent_token_id) {
      throw new InviteApiError("Both players must choose and save their Chogs before writing conditions.", { status: 409, code: "CHOGS_NOT_SELECTED" });
    }
    const expectedWallet = isChallenger ? row.challenger_wallet : row.opponent_wallet;
    if (!expectedWallet || !user.walletAddress || expectedWallet.toLowerCase() !== user.walletAddress.toLowerCase()) {
      throw new InviteApiError("Connect the wallet linked to this challenge before editing your demand.", { status: 403, code: "INVITE_WALLET_MISMATCH" });
    }
    if (!["TERMS_ACCEPTED", "READY"].includes(row.status) || row.pact_id || row.pact_tx_hash) {
      throw new InviteApiError("Demands can only be edited in the lobby before the Pact NFT is minted.", { status: 409, code: "DEMAND_EDIT_LOCKED" });
    }
    const demand = cleanCondition(body.demand);
    const now = new Date().toISOString();
    const challengerDemand = isChallenger ? demand : row.condition_text;
    const opponentDemand = isChallenger ? (row.opponent_demand_text || "") : demand;
    const combined = `Challenger demand: ${challengerDemand}\nOpponent demand: ${opponentDemand}`;
    const demandHash = await hashText(combined);
    const column = isChallenger ? "condition_text" : "opponent_demand_text";
    const acceptedColumn = isChallenger ? "challenger_terms_accepted" : "opponent_terms_accepted";
    const acceptedAtColumn = isChallenger ? "challenger_terms_accepted_at" : "opponent_terms_accepted_at";
    const updated = await conditionalUpdate({
      env,
      sql: `UPDATE chog_challenge_invites SET ${column} = ?1, terms_hash = ?2,
        challenger_terms_accepted = 0, opponent_terms_accepted = 0,
        challenger_terms_accepted_at = ?3, opponent_terms_accepted_at = NULL,
        challenger_ready = 0, opponent_ready = 0, status = 'TERMS_ACCEPTED', updated_at = ?3
        WHERE id = ?4 AND status IN ('TERMS_ACCEPTED','READY') AND pact_id IS NULL
          AND challenger_pact_signature IS NULL AND opponent_pact_signature IS NULL
        RETURNING *`,
      values: [demand, demandHash, now, id],
      conflictCode: "DEMAND_SAVE_CONFLICT",
    });
    return { status: 200, body: { invite: presentInvite(updated, user.discordId) }, headers: { "Cache-Control": "no-store" } };
  }

  if (body.action === "acceptTerms") {
    if (!row.challenger_wallet || !row.challenger_token_id || !row.opponent_wallet || !row.opponent_token_id) {
      throw new InviteApiError("Both players must choose and save their Chogs before accepting the demands.", { status: 409, code: "CHOGS_NOT_SELECTED" });
    }
    if (row.condition_text === PENDING_DEMAND || !String(row.opponent_demand_text || "").trim()) {
      throw new InviteApiError("Both players must write and save their demands before accepting the terms.", { status: 409, code: "DEMANDS_NOT_READY" });
    }
    const expectedWallet = isChallenger ? row.challenger_wallet : row.opponent_wallet;
    if (!expectedWallet || !user.walletAddress || expectedWallet.toLowerCase() !== user.walletAddress.toLowerCase()) {
      throw new InviteApiError("Connect the wallet linked to this challenge before accepting the demands.", { status: 403, code: "INVITE_WALLET_MISMATCH" });
    }
    if (row.status !== "TERMS_ACCEPTED" && row.status !== "READY") {
      throw new InviteApiError("Join the lobby before accepting the final demands.", { status: 409, code: "LOBBY_NOT_JOINED" });
    }
    if (row.pact_id || row.pact_tx_hash) {
      throw new InviteApiError("The Pact NFT has already been minted; the agreed terms are locked.", { status: 409, code: "DEMAND_EDIT_LOCKED" });
    }
    const challengerDemand = cleanCondition(row.condition_text);
    const opponentDemand = cleanCondition(row.opponent_demand_text);
    const now = new Date().toISOString();
    const combined = `Challenger demand: ${challengerDemand}\nOpponent demand: ${opponentDemand}`;
    const demandHash = await hashText(combined);
    const ownFlag = isChallenger ? "challenger_terms_accepted" : "opponent_terms_accepted";
    const ownAt = isChallenger ? "challenger_terms_accepted_at" : "opponent_terms_accepted_at";
    const otherFlag = isChallenger ? "opponent_terms_accepted" : "challenger_terms_accepted";
    const updated = await conditionalUpdate({
      env,
      sql: `UPDATE chog_challenge_invites SET ${ownFlag} = 1, ${ownAt} = ?1, terms_hash = ?2,
        status = CASE WHEN ${otherFlag} = 1 THEN 'READY' ELSE 'TERMS_ACCEPTED' END,
        updated_at = ?1
        WHERE id = ?3 AND status IN ('TERMS_ACCEPTED','READY') AND pact_id IS NULL
        RETURNING *`,
      values: [now, demandHash, id],
      conflictCode: "TERMS_ACCEPT_CONFLICT",
    });
    const bothAccepted = Boolean(updated.challenger_terms_accepted && updated.opponent_terms_accepted);
    return {
      status: 200,
      body: {
        invite: presentInvite(updated, user.discordId),
        notice: bothAccepted
          ? "Both players accepted the written demands. The agreement NFT can now be signed and minted."
          : "Your acceptance is saved. The other player must also accept both written demands.",
      },
      headers: { "Cache-Control": "no-store" },
    };
  }

  if (body.action === "ready") {
    if (row.status !== "READY" || !row.challenger_terms_accepted || !row.opponent_terms_accepted) {
      throw new InviteApiError("Both players must accept both written demands before readiness can be recorded.", { status: 409, code: "INVITE_TERMS_PENDING" });
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
        status = 'READY',
        updated_at = ?2
        WHERE id = ?3 AND status = 'READY'
          AND challenger_terms_accepted = 1 AND opponent_terms_accepted = 1
          AND (challenger_discord_id = ?1 OR opponent_discord_id = ?1)
        RETURNING *`,
      values: [user.discordId, now, id],
      conflictCode: "INVITE_READY_CONFLICT",
    });
    return {
      status: 200,
      body: {
        invite: presentInvite(updated, user.discordId),
        multiplayerAvailable: true,
        notice: updated.challenger_ready && updated.opponent_ready
          ? "Both players are ready. Starting the real-time match is now available."
          : "Your readiness is saved. Wait for the other player in the lobby.",
      },
      headers: { "Cache-Control": "no-store" },
    };
  }

  throw new InviteApiError("Unknown invitation action.", { status: 400, code: "INVITE_ACTION_UNKNOWN" });
}
