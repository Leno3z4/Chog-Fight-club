import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { handleRealtimeTicketRequest } from "./realtimeTicket.js";
import { ArenaRoom } from "../realtime/worker.js";

const inviteId = "2a8b8f70-0c29-4ded-9c52-7c18e1f00001";
const discordId = "12345678901234567";
const walletAddress = "0x1111111111111111111111111111111111111111";
const secret = "test-secret-that-is-long-enough-for-realtime-tests";
const encoder = new TextEncoder();

async function signedSessionCookie() {
  const payload = {
    discordId,
    username: "Test Player",
    exp: Date.now() + 60 * 60 * 1000,
    walletAddress,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const key = await webcrypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = Buffer.from(await webcrypto.subtle.sign("HMAC", key, encoder.encode(encoded))).toString("base64url");
  return `chog_session=${encoded}.${signature}`;
}

function mockEnv(status) {
  const row = {
    id: inviteId,
    challenger_discord_id: discordId,
    opponent_discord_id: "98765432109876543",
    challenger_wallet: walletAddress,
    opponent_wallet: "0x2222222222222222222222222222222222222222",
    status,
  };
  return {
    SESSION_SECRET: secret,
    CHOG_DB: {
      prepare() {
        return {
          bind() {
            return { first: async () => row };
          },
        };
      },
    },
  };
}

async function requestTicket(status) {
  return handleRealtimeTicketRequest({
    method: "GET",
    url: `https://game.example/api/realtime-ticket?id=${inviteId}`,
    cookieHeader: await signedSessionCookie(),
    env: mockEnv(status),
  });
}

test("pending invitations cannot receive a realtime room ticket", async () => {
  await assert.rejects(requestTicket("PENDING_ACCEPTANCE"), (error) => {
    assert.equal(error.code, "INVITE_NOT_ACCEPTED");
    assert.equal(error.status, 409);
    return true;
  });
});

test("an accepted player can receive a signed realtime room ticket", async () => {
  const result = await requestTicket("TERMS_ACCEPTED");
  assert.equal(result.status, 200);
  assert.equal(result.body.inviteId, inviteId);
  assert.equal(result.body.role, "challenger");
  assert.match(result.body.ticket, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(result.body.expiresAt > Date.now(), true);
});

async function signedRoomTicket() {
  const claims = {
    v: 1,
    inviteId,
    discordId,
    walletAddress,
    role: "challenger",
    expiresAt: Date.now() + 60_000,
  };
  const encoded = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const key = await webcrypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = Buffer.from(await webcrypto.subtle.sign("HMAC", key, encoder.encode(encoded))).toString("base64url");
  return `${encoded}.${signature}`;
}

test("Durable Object rejects a valid ticket while the invitation is pending", async () => {
  const env = mockEnv("PENDING_ACCEPTANCE");
  const room = new ArenaRoom({
    id: { name: inviteId },
    getWebSockets: () => [],
  }, env);
  const ticket = await signedRoomTicket();
  const response = await room.fetch({
    url: `https://arena.example/room?ticket=${encodeURIComponent(ticket)}`,
    headers: new Headers({ Upgrade: "websocket" }),
  });
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.match(body.error, /invited player must accept/i);
});
