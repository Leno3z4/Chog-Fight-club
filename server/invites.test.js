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
  SUPABASE_URL: "https://test-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
  MONAD_RPC_URL: "https://rpc.monad.xyz",
};

const challengerId = "123456789012345678";
const opponentId = "234567890123456789";
const account = privateKeyToAccount("0x0000000000000000000000000000000000000000000000000000000000000001");

function cookiePair(value) { return String(value).split(";")[0]; }
function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

async function makeLinkedSession() {
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
      if (target.endsWith("/users/@me")) return jsonResponse({ id: challengerId, username: "ChallengeMaker", global_name: "Challenge Maker" });
      if (target.endsWith(`/users/@me/guilds/${env.DISCORD_GUILD_ID}/member")) return jsonResponse({ roles: [env.DISCORD_HOLDER_ROLE_ID] });
      throw new Error("Unexpected Discord endpoint: " + target);
    },
  });
  const sessionCookie = cookiePair(callback.cookies.find((value) => value.startsWith("chog_session=")));
  const challenge = await startWalletLink({ cookieHeader: sessionCookie, env, origin, secure: true });
  const signature = await account.signMessage({ message: challenge.body.message });
  const walletResult = await finishWalletLink({
    cookieHeader: `${sessionCookie}; ${cookiePair(challenge.cookies[0])}`,
    env,
    message: challenge.body.message,
    signature,
    secure: true,
  });
  return cookiePair(walletResult.cookies.find((value) => value.startsWith("chog_session=")));
}

function mockFetch({ owned = account.address.toLowerCase(), insertedRows = [] } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    calls.push({ target, options });
    if (target === env.MONAD_RPC_URL) {
      const request = JSON.parse(options.body);
      assert.equal(request.method, "eth_call");
      assert.ok(request.params[0].data.startsWith("0x6352211e"));
      return jsonResponse({ jsonrpc: "2.0", id: 1, result: "0x" + String(owned).slice(2).toLowerCase().padStart(64, "0") });
    }
    if (target.startsWith(env.SUPABASE_URL + "/rest/v1/chog_challenge_invites")) {
      if (options.method === "POST") {
        const row = JSON.parse(options.body);
        const created = { ...row, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        insertedRows.push(created);
        return jsonResponse([created], 201);
      }
      if (options.method === "GET") return jsonResponse([]);
      throw new Error("Unexpected database method " + options.method);
    }
    throw new Error("Unexpected endpoint " + target);
  };
  return { fetchImpl, calls };
}

test("creates a persistent invite only after verifying linked wallet ownership", async () => {
  const cookieHeader = await makeLinkedSession();
  const insertedRows = [];
  const { fetchImpl, calls } = mockFetch({ insertedRows });
  const result = await handleInviteRequest({
    method: "POST",
    url: "/api/invites",
    cookieHeader,
    env,
    origin,
    fetchImpl,
    body: {
      action: "create",
      opponentDiscordId: opponentId,
      challengerTokenId: "561",
      condition: "Post a harmless silly message for one day.",
      agreeToCondition: true,
    },
  });

  assert.equal(result.status, 201);
  assert.equal(result.body.invite.status, "PENDING_ACCEPTANCE");
  assert.equal(result.body.invite.challenger.tokenId, "561");
  assert.equal(result.body.invite.opponent.discordId, opponentId);
  assert.equal(result.body.invite.condition, "Post a harmless silly message for one day.");
  assert.match(result.body.invite.termsHash, /^[0-9a-f]{64}$/);
  assert.match(result.body.inviteUrl, /invite\.html\?id=/);
  assert.equal(insertedRows.length, 1);
  assert.equal(insertedRows[0].challenger_wallet, account.address.toLowerCase());
  assert.equal(insertedRows[0].challenger_terms_accepted, true);
  assert.equal(calls.filter((call) => call.target === env.MONAD_RPC_URL).length, 1);
});

test("rejects a condition that is plainly unsafe before storing an invite", async () => {
  const cookieHeader = await makeLinkedSession();
  let networkCalls = 0;
  await assert.rejects(
    handleInviteRequest({
      method: "POST",
      url: "/api/invites",
      cookieHeader,
      env,
      origin,
      fetchImpl: async () => { networkCalls += 1; throw new Error("should not be reached"); },
      body: {
        action: "create",
        opponentDiscordId: opponentId,
        challengerTokenId: "561",
        condition: "Doxx their private address.",
        agreeToCondition: true,
      },
    }),
    (error) => error instanceof InviteApiError && error.code === "CONDITION_UNSAFE"
  );
  assert.equal(networkCalls, 0);
});

test("rejects a Chog not owned by the Discord-linked wallet", async () => {
  const cookieHeader = await makeLinkedSession();
  const { fetchImpl } = mockFetch({ owned: "0x2222222222222222222222222222222222222222" });
  await assert.rejects(
    handleInviteRequest({
      method: "POST",
      url: "/api/invites",
      cookieHeader,
      env,
      origin,
      fetchImpl,
      body: {
        action: "create",
        opponentDiscordId: opponentId,
        challengerTokenId: "561",
        condition: "Post a harmless silly message for one day.",
        agreeToCondition: true,
      },
    }),
    (error) => error instanceof InviteApiError && error.code === "CHOG_NOT_OWNED"
  );
});
