import test from "node:test";
import assert from "node:assert/strict";
import {
  startDiscordOAuth,
  finishDiscordOAuth,
  readDiscordSession,
} from "./discordAuth.js";

const origin = "https://game.example";
const env = {
  DISCORD_CLIENT_ID: "client-id",
  DISCORD_CLIENT_SECRET: "client-secret",
  DISCORD_GUILD_ID: "guild-123",
  DISCORD_HOLDER_ROLE_ID: "1545507860455096460",
  DISCORD_REDIRECT_URI: "https://game.example/api/discord/callback",
  SESSION_SECRET: "test-secret-that-is-long-enough-for-tests-only",
};

function cookiePair(value) {
  return value.split(";")[0];
}
function cookieValue(value) {
  return value.slice(value.indexOf("=") + 1).split(";")[0];
}
function mockResponse(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

test("OAuth start requires configuration and creates a CSRF state cookie", async () => {
  const result = await startDiscordOAuth({ origin, env, secure: true });
  assert.equal(result.status, 302);
  const url = new URL(result.location);
  assert.equal(url.origin, "https://discord.com");
  assert.equal(url.pathname, "/oauth2/authorize");
  assert.equal(url.searchParams.get("client_id"), "client-id");
  assert.equal(url.searchParams.get("redirect_uri"), env.DISCORD_REDIRECT_URI);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.match(url.searchParams.get("scope"), /identify/);
  assert.match(url.searchParams.get("scope"), /guilds.members.read/);
  assert.match(result.cookies[0], /^chog_oauth_state=/);
  assert.match(result.cookies[0], /HttpOnly/);
  assert.match(result.cookies[0], /Secure/);
});

test("callback validates OAuth state, checks role server-side, then creates a session", async () => {
  const start = await startDiscordOAuth({ origin, env, secure: true });
  const authorizeUrl = new URL(start.location);
  const state = authorizeUrl.searchParams.get("state");
  const stateCookie = cookiePair(start.cookies[0]);
  const calls = [];

  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    calls.push({ target, options });
    if (target.endsWith("/oauth2/token")) {
      const body = String(options.body);
      assert.match(body, /client_secret=client-secret/);
      return mockResponse({ access_token: "mock-access-token", token_type: "Bearer", expires_in: 3600 });
    }
    if (target.endsWith("/users/@me")) {
      assert.equal(options.headers.Authorization, "Bearer mock-access-token");
      return mockResponse({ id: "discord-user-1", username: "test-player", global_name: "Test Player", avatar: null });
    }
    if (target.endsWith("/users/@me/guilds/guild-123/member")) {
      return mockResponse({ roles: ["ordinary-role", "1545507860455096460"] });
    }
    throw new Error("Unexpected Discord API route: " + target);
  };

  const callback = await finishDiscordOAuth({
    requestUrl: `${origin}/api/discord/callback?code=mock-code&state=${state}`,
    cookieHeader: stateCookie,
    env,
    secure: true,
    fetchImpl,
  });

  assert.equal(callback.status, 302);
  assert.equal(callback.location, `${origin}/profile.html`);
  assert.equal(calls.length, 3);
  const sessionSetCookie = callback.cookies.find((value) => value.startsWith("chog_session="));
  assert.ok(sessionSetCookie, "expected signed session cookie");
  assert.match(sessionSetCookie, /HttpOnly/);
  assert.match(sessionSetCookie, /Secure/);

  const session = await readDiscordSession({
    cookieHeader: cookiePair(sessionSetCookie),
    env,
  });
  assert.equal(session.authenticated, true);
  assert.equal(session.user.discordId, "discord-user-1");
  assert.equal(session.user.username, "Test Player");
  assert.equal(session.user.roleId, env.DISCORD_HOLDER_ROLE_ID);
});

test("wrong OAuth state is rejected before calling Discord", async () => {
  const start = await startDiscordOAuth({ origin, env, secure: true });
  const stateCookie = cookiePair(start.cookies[0]);
  let networkCalls = 0;
  const result = await finishDiscordOAuth({
    requestUrl: `${origin}/api/discord/callback?code=mock-code&state=wrong-state`,
    cookieHeader: stateCookie,
    env,
    secure: true,
    fetchImpl: async () => { networkCalls += 1; return mockResponse({}); },
  });
  assert.equal(new URL(result.location).searchParams.get("error"), "discord_state_invalid");
  assert.equal(networkCalls, 0);
  assert.ok(result.cookies.some((value) => value.startsWith("chog_oauth_state=") && /Max-Age=0/.test(value)));
});

test("non-holder is denied and does not receive a session", async () => {
  const start = await startDiscordOAuth({ origin, env, secure: true });
  const state = new URL(start.location).searchParams.get("state");
  const stateCookie = cookiePair(start.cookies[0]);
  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.endsWith("/oauth2/token")) return mockResponse({ access_token: "mock-token" });
    if (target.endsWith("/users/@me")) return mockResponse({ id: "discord-user-2", username: "visitor" });
    if (target.endsWith("/users/@me/guilds/guild-123/member")) return mockResponse({ roles: ["ordinary-role"] });
    throw new Error("Unexpected route");
  };
  const result = await finishDiscordOAuth({
    requestUrl: `${origin}/api/discord/callback?code=mock-code&state=${state}`,
    cookieHeader: stateCookie,
    env,
    secure: true,
    fetchImpl,
  });
  assert.equal(new URL(result.location).searchParams.get("error"), "holder_role_required");
  assert.equal(result.cookies.some((value) => value.startsWith("chog_session=")), false);
});

test("missing guild ID blocks access rather than bypassing role checks", async () => {
  const result = await startDiscordOAuth({
    origin,
    env: { ...env, DISCORD_GUILD_ID: "" },
    secure: true,
  }).catch((error) => error);
  assert.equal(result.code, "DISCORD_CONFIG_MISSING");
});
