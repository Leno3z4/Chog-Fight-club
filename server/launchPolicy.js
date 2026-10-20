export const INVITE_EXPIRY_MS = 24 * 60 * 60 * 1000;
export const RESULT_REVIEW_WINDOW_MS = 5 * 60 * 1000;

export function inviteExpiryAt(createdAt = Date.now()) {
  const timestamp = createdAt instanceof Date ? createdAt.getTime() : Number(createdAt);
  if (!Number.isFinite(timestamp)) throw new TypeError("A valid invite creation time is required.");
  return new Date(timestamp + INVITE_EXPIRY_MS).toISOString();
}

export function isPendingInviteExpired(row, now = Date.now()) {
  if (row?.status !== "PENDING_ACCEPTANCE" || !row.expires_at) return false;
  const expiry = Date.parse(row.expires_at);
  return Number.isFinite(expiry) && expiry <= now;
}

export function resultReviewRemainingMs(updatedAt, now = Date.now()) {
  const updated = Date.parse(updatedAt);
  // Unknown timestamps fail closed: never infer that an unreviewed result is ready.
  if (!Number.isFinite(updated)) return RESULT_REVIEW_WINDOW_MS;
  return Math.max(0, RESULT_REVIEW_WINDOW_MS - (now - updated));
}

export function resultSettlementAvailableAt(updatedAt, now = Date.now()) {
  const updated = Date.parse(updatedAt);
  return new Date((Number.isFinite(updated) ? updated : now) + RESULT_REVIEW_WINDOW_MS).toISOString();
}

export function normalizeDisputeReason(value) {
  if (typeof value !== "string") throw new TypeError("Add a short explanation for the result dispute.");
  const reason = value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (reason.length < 10) throw new RangeError("Explain the result concern in at least 10 characters.");
  if (reason.length > 500) throw new RangeError("Keep the result explanation to 500 characters or fewer.");
  if (/\bhttps?:\/\/|\bwww\./i.test(reason)) {
    throw new TypeError("Do not include links or private evidence in a result dispute.");
  }
  return reason;
}

export function readBattleLog(serialized) {
  if (Array.isArray(serialized)) return serialized.filter((entry) => entry && typeof entry === "object");
  if (typeof serialized !== "string" || !serialized) return [];
  try {
    const parsed = JSON.parse(serialized);
    return Array.isArray(parsed) ? parsed.filter((entry) => entry && typeof entry === "object") : [];
  } catch {
    return [];
  }
}

export function appendBattleLog(serialized, event, maxEntries = 200) {
  const entries = readBattleLog(serialized);
  entries.push(event);
  return JSON.stringify(entries.slice(-maxEntries));
}
