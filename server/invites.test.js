import test from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { startDiscordOAuth, finishDiscordOAuth, startWalletLink, finishWalletLink } from "./discordAuth.js";
import { handleInviteRequest, InviteApiError } from "./invites.js";

const origin = "https://game.example";
const env = {
  DISCORD_CLIENT_ID: "client-id",
  DISCORD_CLIENT_SECRET: "client-secret",
  DISCORD_GUILD_ID: "1253481714710220810",
  DISCORD_HOLDER_ROLE_ID: "1545507860455096460",
  DISCORD_REDIRECT_URI: "https://game.example/api/discord/callback",
  SESSION_SECRET: "test-invites-session-secret-with-adequate-length",
  MONAD_RPC_URL: "https://rpc.monad.xyz",
};

const challengerId = "123456789012345678";
const opponentId = "234567890123456789";
const account = privateKeyToAccount("0x0000000000000000000000000000000000000000000000000000000000000001");
const opponentAccount = privateKeyToAccount("0x0000000000000000000000000000000000000000000000000000000000000002");

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function cookiePair(value) { return String(value).split(";")[0]; }
function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

class MockD1Statement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.values = []; }
  bind(...values) { this.values = values; return this; }
  first() { return this.db.first(this.sql, this.values); }
  all() { return this.db.all(this.sql, this.values); }
  run() { return this.db.run(this.sql, this.values); }
}

class MockD1 {
  constructor() {
    this.rows = new Map();
    this.players = new Map([[opponentId, {
      discord_id: opponentId, username: "rival", display_name: "Rival Player",
      avatar_url: null, last_seen: new Date().toISOString(),
    }]]);
  }
  prepare(sql) { return new MockD1Statement(this, sql); }
  async first(sql, v) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (normalized.startsWith("SELECT discord_id, username, display_name FROM chog_players WHERE discord_id = ?1")) {
      return clone(this.players.get(v[0]) || null);
    }
    if (normalized.startsWith("SELECT * FROM chog_challenge_invites WHERE id = ?1")) {
      return clone(this.rows.get(v[0]) || null);
    }
    if (normalized.startsWith("SELECT COUNT(*) AS count FROM chog_challenge_invites")) {
      const count = [...this.rows.values()].filter((row) =>
        row.challenger_discord_id === v[0]
        && row.created_at > v[1]
        && ["PENDING_ACCEPTANCE", "TERMS_ACCEPTED", "READY"].includes(row.status)
      ).length;
      return { count };
    }
    if (normalized.startsWith("UPDATE chog_challenge_invites SET status = 'EXPIRED'")) {
      const row = this.rows.get(v[1]);
      if (row && row.status === "PENDING_ACCEPTANCE") {
        row.status = "EXPIRED";
        row.updated_at = v[0];
      }
      return null;
    }
    if (normalized.startsWith("UPDATE chog_challenge_invites") && normalized.includes("RETURNING *")) {
      return this.updateReturning(normalized, v);
    }
    throw new Error("MockD1.first received unexpected SQL: " + normalized);
  }
  async all(sql, v) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    let rows;
    if (normalized.startsWith("SELECT * FROM chog_challenge_invites WHERE opponent_discord_id = ?1 OR opponent_discord_id = ?2")) {
      rows = [...this.rows.values()].filter((row) => row.opponent_discord_id === v[0] || row.opponent_discord_id === v[1]);
    } else if (normalized.startsWith("SELECT * FROM chog_challenge_invites WHERE challenger_discord_id = ?1")) {
      rows = [...this.rows.values()].filter((row) => row.challenger_discord_id === v[0]);
    } else {
      throw new Error("MockD1.all received unexpected SQL: " + normalized);
    }
    return { results: rows.sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,50).map(clone) };
  }
  async run(sql, v) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (normalized.startsWith("INSERT INTO chog_players")) {
      const [discord_id, username, display_name, avatar_url, wallet_address, last_seen, created_at] = v;
      const previous = this.players.get(discord_id);
      this.players.set(discord_id, { discord_id, username, display_name, avatar_url, wallet_address, last_seen, created_at: previous?.created_at || created_at });
      return { success: true, meta: { changes: 1 } };
    }
    if (normalized.startsWith("INSERT INTO chog_challenge_invites")) {
      const fields = [
        "id","challenger_discord_id","challenger_username","challenger_wallet","challenger_token_id",
        "opponent_discord_id","opponent_username","opponent_wallet","opponent_token_id","condition_text",
        "terms_hash","challenger_terms_accepted","challenger_terms_accepted_at","opponent_terms_accepted",
        "opponent_terms_accepted_at","challenger_ready","opponent_ready","status","created_at","updated_at","expires_at","game_mode"
      ];
      const row = Object.fromEntries(fields.map((field, index) => [field, v[index]]));
      this.rows.set(row.id, row);
      return { success: true, meta: { changes: 1 } };
    }
    if (normalized.startsWith("UPDATE chog_challenge_invites SET status = 'EXPIRED'")) {
      const row = this.rows.get(v[1]);
      if (row && row.status === "PENDING_ACCEPTANCE") {
        row.status = "EXPIRED";
        row.updated_at = v[0];
      }
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }
    throw new Error("MockD1.run received unexpected SQL: " + normalized);
  }
  async updateReturning(sql, v) {
    if (sql.includes("opponent_terms_accepted = 0") && sql.includes("opponent_discord_id = ?1")) {
      const row = this.rows.get(v[5]);
      if (!row || row.status !== "PENDING_ACCEPTANCE" || row.opponent_discord_id !== v[6]) return null;
      Object.assign(row, {
        opponent_discord_id: v[0], opponent_username: v[1], opponent_wallet: v[2], opponent_token_id: v[3],
        opponent_terms_accepted: 0, opponent_terms_accepted_at: null, status: "TERMS_ACCEPTED", updated_at: v[4],
      });
      return clone(row);
    }
    if (sql.includes("SET status = 'DECLINED'")) {
      const row = this.rows.get(v[2]);
      if (!row || row.status !== "PENDING_ACCEPTANCE" || row.opponent_discord_id !== v[3]) return null;
      row.opponent_discord_id = v[0]; row.status = "DECLINED"; row.updated_at = v[1];
      return clone(row);
    }
    if (sql.includes("SET status = 'CANCELLED'")) {
      const row = this.rows.get(v[1]);
      if (!row || row.status !== "PENDING_ACCEPTANCE" || row.challenger_discord_id !== v[2]) return null;
      row.status = "CANCELLED"; row.updated_at = v[0];
      return clone(row);
    }
    if (sql.includes("challenger_ready = CASE")) {
      const row = this.rows.get(v[2]);
      if (!row || row.status !== "READY" || !row.challenger_terms_accepted || !row.opponent_terms_accepted
        || ![row.challenger_discord_id, row.opponent_discord_id].includes(v[0])) return null;
      if (row.challenger_discord_id === v[0]) row.challenger_ready = 1;
      if (row.opponent_discord_id === v[0]) row.opponent_ready = 1;
      row.status = "READY";
      row.updated_at = v[1];
      return clone(row);
    }
    if (sql.includes("terms_hash = ?2") && sql.includes("challenger_ready = 0") && sql.includes("opponent_terms_accepted = 0")) {
      const row = this.rows.get(v[3]);
      if (!row || !["TERMS_ACCEPTED", "READY"].includes(row.status) || row.pact_id || row.pact_tx_hash) return null;
      const column = sql.includes("opponent_demand_text = ?1") ? "opponent_demand_text" : "condition_text";
      row[column] = v[0]; row.terms_hash = v[1];
      row.challenger_terms_accepted = 0; row.opponent_terms_accepted = 0;
      row.challenger_terms_accepted_at = v[2]; row.opponent_terms_accepted_at = null;
      row.challenger_ready = 0; row.opponent_ready = 0; row.status = "TERMS_ACCEPTED"; row.updated_at = v[2];
      return clone(row);
    }
    if (sql.includes("SET challenger_terms_accepted = 1") || sql.includes("SET opponent_terms_accepted = 1")) {
      const row = this.rows.get(v[2]);
      if (!row || !["TERMS_ACCEPTED", "READY"].includes(row.status) || row.pact_id) return null;
      const own = sql.includes("SET challenger_terms_accepted = 1") ? "challenger" : "opponent";
      row[own + "_terms_accepted"] = 1;
      row[own + "_terms_accepted_at"] = v[0];
      row.terms_hash = v[1];
      row.status = row.challenger_terms_accepted && row.opponent_terms_accepted ? "READY" : "TERMS_ACCEPTED";
      row.updated_at = v[0];
      return clone(row);
    }
    throw new Error("MockD1.updateReturning received unexpected SQL: " + sql);
  }
}

async function makeLinkedSession({ discordId = challengerId, username = "ChallengeMaker", walletAccount = account } = {}) {
  const start = await startDiscordOAuth({ origin, env, secure: true });
  const state = new URL(start.location).searchParams.get("state");
  const callback = await finishDiscordOAuth({
    requestUrl: `${origin}/api/discord/callback?code=test-code&state=${state}`,
    cookieHeader: cookiePair(start.cookies[0]),
    env,
    secure: true,
    fetchImpl: async (url) => {
      const target = String(url);
      if (target.endsWith("/oauth2/token")) return jsonResponse({ access_token: "mock-access" });
      if (target.endsWith("/users/@me")) return jsonResponse({ id: discordId, username, global_name: username });
      if (target.endsWith(`/users/@me/guilds/${env.DISCORD_GUILD_ID}/member`)) return jsonResponse({ roles: [env.DISCORD_HOLDER_ROLE_ID] });
      throw new Error("Unexpected Discord endpoint: " + target);
    },
  });
  const sessionCookie = cookiePair(callback.cookies.find((value) => value.startsWith("chog_session=")));
  const challenge = await startWalletLink({ cookieHeader: sessionCookie, env, origin, secure: true });
  const signature = await walletAccount.signMessage({ message: challenge.body.message });
  const walletResult = await finishWalletLink({
    cookieHeader: `${sessionCookie}; ${cookiePair(challenge.cookies[0])}`,
    env,
    message: challenge.body.message,
    signature,
    secure: true,
  });
  return cookiePair(walletResult.cookies.find((value) => value.startsWith("chog_session=")));
}

function rpcFetch({ owned = account.address.toLowerCase() } = {}) {
  return async (url, options = {}) => {
    if (String(url) !== env.MONAD_RPC_URL) throw new Error("Unexpected fetch endpoint: " + url);
    const request = JSON.parse(options.body);
    assert.equal(request.method, "eth_call");
    assert.equal(request.params[0].to.toLowerCase(), "0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763");
    return jsonResponse({
      jsonrpc: "2.0", id: 1,
      result: "0x" + String(owned).slice(2).toLowerCase().padStart(64, "0"),
    });
  };
}

function makeRow(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    challenger_discord_id: challengerId,
    challenger_username: "ChallengeMaker",
    challenger_wallet: account.address.toLowerCase(),
    challenger_token_id: "561",
    opponent_discord_id: opponentId,
    opponent_username: null,
    opponent_wallet: null,
    opponent_token_id: null,
    condition_text: "Post a harmless silly message for one day.",
    terms_hash: "a".repeat(64),
    challenger_terms_accepted: 0,
    challenger_terms_accepted_at: now,
    opponent_terms_accepted: 0,
    opponent_terms_accepted_at: null,
    challenger_ready: 0,
    opponent_ready: 0,
    status: "PENDING_ACCEPTANCE",
    created_at: now,
    updated_at: now,
    expires_at: null,
    ...overrides,
  };
}

test("creates a persistent invite in Cloudflare D1 after verifying linked wallet ownership", async () => {
  env.CHOG_DB = new MockD1();
  const cookieHeader = await makeLinkedSession();
  const result = await handleInviteRequest({
    method: "POST", url: "/api/invites", cookieHeader, env, origin, fetchImpl: rpcFetch(),
    body: {
      action: "create", opponentDiscordId: opponentId, challengerTokenId: "561",
      condition: "Post a harmless silly message for one day.", agreeToCondition: true,
    },
  });
  assert.equal(result.status, 201);
  assert.equal(result.body.invite.status, "PENDING_ACCEPTANCE");
  assert.equal(result.body.invite.challenger.tokenId, "561");
  assert.equal(result.body.invite.opponent.discordId, opponentId);
  assert.match(result.body.invite.termsHash, /^[0-9a-f]{64}$/);
  assert.match(result.body.inviteUrl, /invite\.html\?id=/);
  assert.equal(env.CHOG_DB.rows.size, 1);
});

test("rejects a condition that is plainly unsafe before writing to D1", async () => {
  env.CHOG_DB = new MockD1();
  const cookieHeader = await makeLinkedSession();
  await assert.rejects(
    handleInviteRequest({
      method: "POST", url: "/api/invites", cookieHeader, env, origin,
      fetchImpl: async () => { throw new Error("RPC should not be called for unsafe condition"); },
      body: {
        action: "create", opponentDiscordId: opponentId, challengerTokenId: "561",
        condition: "Doxx their private address.", agreeToCondition: true,
      },
    }),
    (error) => error instanceof InviteApiError && error.code === "CONDITION_UNSAFE"
  );
  assert.equal(env.CHOG_DB.rows.size, 0);
});

test("rejects a Chog not owned by the Discord-linked wallet", async () => {
  env.CHOG_DB = new MockD1();
  const cookieHeader = await makeLinkedSession();
  await assert.rejects(
    handleInviteRequest({
      method: "POST", url: "/api/invites", cookieHeader, env, origin,
      fetchImpl: rpcFetch({ owned: "0x2222222222222222222222222222222222222222" }),
      body: {
        action: "create", opponentDiscordId: opponentId, challengerTokenId: "561",
        condition: "Post a harmless silly message for one day.", agreeToCondition: true,
      },
    }),
    (error) => error instanceof InviteApiError && error.code === "CHOG_NOT_OWNED"
  );
  assert.equal(env.CHOG_DB.rows.size, 0);
});

test("the challenged Discord account can accept with its own verified Chog", async () => {
  const db = new MockD1();
  const row = makeRow();
  db.rows.set(row.id, row);
  env.CHOG_DB = db;
  const cookieHeader = await makeLinkedSession({ discordId: opponentId, username: "Opponent", walletAccount: opponentAccount });
  const result = await handleInviteRequest({
    method: "POST", url: "/api/invites", cookieHeader, env, origin, fetchImpl: rpcFetch({ owned: opponentAccount.address.toLowerCase() }),
    body: { action: "accept", id: row.id, opponentTokenId: "973", agreeToCondition: true },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.invite.status, "TERMS_ACCEPTED");
  assert.equal(result.body.invite.viewerRole, "opponent");
  assert.equal(result.body.invite.opponent.wallet, opponentAccount.address.toLowerCase());
  assert.equal(result.body.invite.opponent.tokenId, "973");
  assert.equal(env.CHOG_DB.rows.get(row.id).opponent_terms_accepted, 0);
  assert.equal(env.CHOG_DB.rows.get(row.id).status, "TERMS_ACCEPTED");
});

test("a different holder cannot read an invitation addressed to someone else", async () => {
  const db = new MockD1();
  const row = makeRow();
  db.rows.set(row.id, row);
  env.CHOG_DB = db;
  const cookieHeader = await makeLinkedSession({ discordId: "345678901234567890", username: "WrongAccount" });
  await assert.rejects(
    handleInviteRequest({
      method: "GET", url: `/api/invites?id=${row.id}`, cookieHeader, env, origin,
      fetchImpl: async () => { throw new Error("No RPC should be needed for reads"); },
    }),
    (error) => error instanceof InviteApiError && error.code === "INVITE_FORBIDDEN"
  );
});

test("both linked players can record readiness; the second sets status READY", async () => {
  const db = new MockD1();
  const row = makeRow({
    status: "READY",
    challenger_terms_accepted: 1,
    opponent_username: "Opponent",
    opponent_wallet: opponentAccount.address.toLowerCase(),
    opponent_token_id: "973",
    opponent_terms_accepted: 1,
    opponent_terms_accepted_at: new Date().toISOString(),
  });
  db.rows.set(row.id, row);
  env.CHOG_DB = db;
  const challengerCookie = await makeLinkedSession({ discordId: challengerId, username: "ChallengeMaker", walletAccount: account });
  const opponentCookie = await makeLinkedSession({ discordId: opponentId, username: "Opponent", walletAccount: opponentAccount });

  const opponentReady = await handleInviteRequest({
    method: "POST", url: "/api/invites", cookieHeader: opponentCookie, env, origin,
    body: { action: "ready", id: row.id },
  });
  assert.equal(opponentReady.body.invite.status, "READY");
  assert.equal(opponentReady.body.invite.opponent.ready, true);
  assert.equal(opponentReady.body.multiplayerAvailable, true);

  const challengerReady = await handleInviteRequest({
    method: "POST", url: "/api/invites", cookieHeader: challengerCookie, env, origin,
    body: { action: "ready", id: row.id },
  });
  assert.equal(challengerReady.body.invite.status, "READY");
  assert.equal(challengerReady.body.invite.opponent.ready, true);
  assert.equal(challengerReady.body.invite.challenger.ready, true);
});

test("both players must write separate demands and accept the combined terms", async () => {
  const db = new MockD1();
  const now = new Date().toISOString();
  const row = makeRow({
    status: "TERMS_ACCEPTED",
    opponent_username: "Opponent",
    opponent_wallet: opponentAccount.address.toLowerCase(),
    opponent_token_id: "973",
    opponent_demand_text: "",
    challenger_terms_accepted: 0,
    challenger_terms_accepted_at: null,
    opponent_terms_accepted: 0,
    opponent_terms_accepted_at: null,
  });
  db.rows.set(row.id, row);
  env.CHOG_DB = db;
  const challengerCookie = await makeLinkedSession({ discordId: challengerId, username: "ChallengeMaker", walletAccount: account });
  const opponentCookie = await makeLinkedSession({ discordId: opponentId, username: "Opponent", walletAccount: opponentAccount });

  const savedChallengerDemand = await handleInviteRequest({
    method: "POST", url: "/api/invites", cookieHeader: challengerCookie, env, origin,
    body: { action: "saveDemand", id: row.id, demand: "Post a harmless silly message for one day." },
  });
  assert.equal(savedChallengerDemand.status, 200);
  assert.equal(savedChallengerDemand.body.invite.challengerDemand, "Post a harmless silly message for one day.");
  assert.equal(savedChallengerDemand.body.invite.opponentDemand, "");

  await assert.rejects(
    handleInviteRequest({
      method: "POST", url: "/api/invites", cookieHeader: challengerCookie, env, origin,
      body: { action: "acceptTerms", id: row.id },
    }),
    (error) => error instanceof InviteApiError && error.code === "CONDITION_LENGTH"
  );

  const savedOpponentDemand = await handleInviteRequest({
    method: "POST", url: "/api/invites", cookieHeader: opponentCookie, env, origin,
    body: { action: "saveDemand", id: row.id, demand: "Share a harmless drawing of your Chog." },
  });
  assert.equal(savedOpponentDemand.body.invite.opponentDemand, "Share a harmless drawing of your Chog.");
  assert.equal(savedOpponentDemand.body.invite.challenger.termsAccepted, false);
  assert.equal(savedOpponentDemand.body.invite.opponent.termsAccepted, false);

  const challengerAccepted = await handleInviteRequest({
    method: "POST", url: "/api/invites", cookieHeader: challengerCookie, env, origin,
    body: { action: "acceptTerms", id: row.id },
  });
  assert.equal(challengerAccepted.body.invite.status, "TERMS_ACCEPTED");
  assert.equal(challengerAccepted.body.invite.challenger.termsAccepted, true);
  assert.equal(challengerAccepted.body.invite.opponent.termsAccepted, false);

  const opponentAccepted = await handleInviteRequest({
    method: "POST", url: "/api/invites", cookieHeader: opponentCookie, env, origin,
    body: { action: "acceptTerms", id: row.id },
  });
  assert.equal(opponentAccepted.body.invite.status, "READY");
  assert.equal(opponentAccepted.body.invite.challenger.termsAccepted, true);
  assert.equal(opponentAccepted.body.invite.opponent.termsAccepted, true);
  assert.match(opponentAccepted.body.invite.termsHash, /^[0-9a-f]{64}$/);
});

test("editing either demand resets both previous acceptances", async () => {
  const db = new MockD1();
  const now = new Date().toISOString();
  const row = makeRow({
    status: "READY",
    opponent_username: "Opponent",
    opponent_wallet: opponentAccount.address.toLowerCase(),
    opponent_token_id: "973",
    opponent_demand_text: "Share a harmless drawing of your Chog.",
    challenger_terms_accepted: 1,
    challenger_terms_accepted_at: now,
    opponent_terms_accepted: 1,
    opponent_terms_accepted_at: now,
  });
  db.rows.set(row.id, row);
  env.CHOG_DB = db;
  const challengerCookie = await makeLinkedSession({ discordId: challengerId, username: "ChallengeMaker", walletAccount: account });
  const changed = await handleInviteRequest({
    method: "POST", url: "/api/invites", cookieHeader: challengerCookie, env, origin,
    body: { action: "saveDemand", id: row.id, demand: "Post a different harmless silly message." },
  });
  assert.equal(changed.body.invite.status, "TERMS_ACCEPTED");
  assert.equal(changed.body.invite.challenger.termsAccepted, false);
  assert.equal(changed.body.invite.opponent.termsAccepted, false);
});
test("returns an explicit configuration error if Cloudflare D1 binding is absent", async () => {
  const cookieHeader = await makeLinkedSession();
  delete env.CHOG_DB;
  await assert.rejects(
    handleInviteRequest({ method: "GET", url: "/api/invites", cookieHeader, env, origin }),
    (error) => error instanceof InviteApiError && error.code === "D1_NOT_CONFIGURED" && error.status === 503
  );
});


test("unregistered username invite can only be claimed by the matching Discord account", async () => {
  const db = new MockD1();
  env.CHOG_DB = db;
  const challengerCookie = await makeLinkedSession({ discordId: challengerId, username: "challenger", walletAccount: account });
  const created = await handleInviteRequest({
    method: "POST",
    url: "/api/invites",
    cookieHeader: challengerCookie,
    env,
    origin,
    fetchImpl: rpcFetch(),
    body: {
      action: "create",
      opponentDiscordId: "",
      opponentUsername: "new_rival",
      challengerTokenId: "561",
      condition: "Post a harmless silly message for one day.",
      agreeToCondition: true,
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.invite.opponent.username, "@new_rival");
  assert.equal(created.body.invite.status, "PENDING_ACCEPTANCE");
  const row = db.rows.get(created.body.invite.id);
  assert.equal(row.opponent_discord_id, "username:new_rival");

  const wrongCookie = await makeLinkedSession({ discordId: "345678901234567890", username: "wrong_rival", walletAccount: opponentAccount });
  await assert.rejects(
    handleInviteRequest({
      method: "GET",
      url: `/api/invites?id=${row.id}`,
      cookieHeader: wrongCookie,
      env,
      origin,
    }),
    (error) => error instanceof InviteApiError && error.code === "INVITE_FORBIDDEN",
  );

  const intendedCookie = await makeLinkedSession({ discordId: opponentId, username: "new_rival", walletAccount: opponentAccount });
  const accepted = await handleInviteRequest({
    method: "POST",
    url: "/api/invites",
    cookieHeader: intendedCookie,
    env,
    origin,
    fetchImpl: rpcFetch({ owned: opponentAccount.address.toLowerCase() }),
    body: { action: "accept", id: row.id, opponentTokenId: "973", agreeToCondition: true },
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.invite.status, "TERMS_ACCEPTED");
  assert.equal(accepted.body.invite.opponent.discordId, opponentId);
  assert.equal(db.rows.get(row.id).opponent_discord_id, opponentId);
});


test("owner can create prototype practice without a real Chog and mode is returned", async () => {
  const db = new MockD1();
  env.CHOG_DB = db;
  const ownerCookie = await makeLinkedSession({
    discordId: "1304031867162595361",
    username: "arena_owner",
    walletAccount: account,
  });
  const result = await handleInviteRequest({
    method: "POST",
    url: "/api/invites",
    cookieHeader: ownerCookie,
    env,
    origin,
    body: {
      action: "create",
      opponentDiscordId: opponentId,
      opponentUsername: "rival",
      challengerTokenId: "prototype:ember",
      gameMode: "PRACTICE",
      condition: "Post a harmless silly message for one day.",
      agreeToCondition: true,
    },
  });
  assert.equal(result.status, 201);
  assert.equal(result.body.invite.gameMode, "PRACTICE");
  assert.equal(db.rows.get(result.body.invite.id).game_mode, "PRACTICE");
});

test("practice invite accepts a prototype fighter without NFT ownership lookup", async () => {
  const db = new MockD1();
  const row = makeRow({ game_mode: "PRACTICE" });
  db.rows.set(row.id, row);
  env.CHOG_DB = db;
  const opponentCookie = await makeLinkedSession({
    discordId: opponentId,
    username: "rival",
    walletAccount: opponentAccount,
  });
  const accepted = await handleInviteRequest({
    method: "POST",
    url: "/api/invites",
    cookieHeader: opponentCookie,
    env,
    origin,
    body: {
      action: "accept",
      id: row.id,
      opponentTokenId: "prototype:tide",
      agreeToCondition: true,
    },
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.invite.gameMode, "PRACTICE");
  assert.equal(accepted.body.invite.opponent.tokenId, "prototype:tide");
  assert.equal(db.rows.get(row.id).opponent_wallet, opponentAccount.address.toLowerCase());
});

test("non-owner cannot create prototype practice invites", async () => {
  const db = new MockD1();
  env.CHOG_DB = db;
  const playerCookie = await makeLinkedSession({ discordId: challengerId, username: "regular_player", walletAccount: account });
  await assert.rejects(
    handleInviteRequest({
      method: "POST",
      url: "/api/invites",
      cookieHeader: playerCookie,
      env,
      origin,
      body: {
        action: "create",
        opponentDiscordId: opponentId,
        opponentUsername: "rival",
        challengerTokenId: "prototype:ember",
        gameMode: "PRACTICE",
        condition: "Post a harmless silly message for one day.",
        agreeToCondition: true,
      },
    }),
    (error) => error instanceof InviteApiError && error.code === "PRACTICE_MODE_FORBIDDEN" && error.status === 403,
  );
});
