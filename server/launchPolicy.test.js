import test from "node:test";
import assert from "node:assert/strict";
import {
  INVITE_EXPIRY_MS,
  RESULT_REVIEW_WINDOW_MS,
  appendBattleLog,
  inviteExpiryAt,
  isPendingInviteExpired,
  normalizeDisputeReason,
  readBattleLog,
  resultReviewRemainingMs,
  resultSettlementAvailableAt,
} from "./launchPolicy.js";

test("challenge invitations expire 24 hours after creation", () => {
  const created = Date.parse("2026-10-20T12:00:00.000Z");
  assert.equal(INVITE_EXPIRY_MS, 24 * 60 * 60 * 1000);
  assert.equal(inviteExpiryAt(created), "2026-10-21T12:00:00.000Z");
});

test("only pending invitations expire, and expiry is inclusive", () => {
  const expires_at = "2026-10-21T12:00:00.000Z";
  assert.equal(isPendingInviteExpired({ status: "PENDING_ACCEPTANCE", expires_at }, Date.parse(expires_at)), true);
  assert.equal(isPendingInviteExpired({ status: "PENDING_ACCEPTANCE", expires_at }, Date.parse(expires_at) - 1), false);
  assert.equal(isPendingInviteExpired({ status: "TERMS_ACCEPTED", expires_at }, Date.parse(expires_at) + 1), false);
  assert.equal(isPendingInviteExpired({ status: "PENDING_ACCEPTANCE", expires_at: null }, Date.now()), false);
});

test("result settlement has a five-minute review window and fails closed on invalid timestamps", () => {
  const updatedAt = "2026-10-20T12:00:00.000Z";
  assert.equal(resultReviewRemainingMs(updatedAt, Date.parse(updatedAt)), RESULT_REVIEW_WINDOW_MS);
  assert.equal(resultReviewRemainingMs(updatedAt, Date.parse(updatedAt) + 1000), RESULT_REVIEW_WINDOW_MS - 1000);
  assert.equal(resultReviewRemainingMs(updatedAt, Date.parse(updatedAt) + RESULT_REVIEW_WINDOW_MS), 0);
  assert.equal(resultReviewRemainingMs("not-a-date", Date.parse(updatedAt)), RESULT_REVIEW_WINDOW_MS);
  assert.equal(resultSettlementAvailableAt(updatedAt), "2026-10-20T12:05:00.000Z");
});

test("result dispute reasons are bounded and do not accept links", () => {
  assert.equal(normalizeDisputeReason("The score shown does not match the final round result."), "The score shown does not match the final round result.");
  assert.throws(() => normalizeDisputeReason("too short"), /at least 10 characters/);
  assert.throws(() => normalizeDisputeReason("x".repeat(501)), /500 characters or fewer/);
  assert.throws(() => normalizeDisputeReason("Please review https://example.com/private-evidence"), /Do not include links/);
});

test("battle-log appends preserve valid prior entries and cap retained history", () => {
  const serialized = JSON.stringify([{ type: "round", round: 1 }]);
  assert.deepEqual(readBattleLog(appendBattleLog(serialized, { type: "result_dispute" })), [
    { type: "round", round: 1 },
    { type: "result_dispute" },
  ]);
  assert.deepEqual(readBattleLog("not-json"), []);
  const bounded = Array.from({ length: 5 }, (_, i) => ({ n: i }));
  assert.deepEqual(readBattleLog(appendBattleLog(JSON.stringify(bounded), { n: 5 }, 3)), [{ n: 3 }, { n: 4 }, { n: 5 }]);
});
