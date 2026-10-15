import test from "node:test";
import assert from "node:assert/strict";
import {
  findOwnedChogTokenIds,
  OpenSeaLookupError,
  CHOG_CONTRACT,
} from "./openSeaChogs.js";

const owner = "0x1111111111111111111111111111111111111111";

function response(payload, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

test("filters to the exact Chog Genesis contract and returns token IDs", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: new URL(url), init });
    return response({
      nfts: [
        { contract: CHOG_CONTRACT, identifier: "561" },
        { contract: CHOG_CONTRACT.toUpperCase(), identifier: "973" },
        { contract: "0x2222222222222222222222222222222222222222", identifier: "12" },
        { contract: CHOG_CONTRACT, identifier: "not-an-id" },
      ],
      next: null,
    });
  };

  const tokenIds = await findOwnedChogTokenIds({ owner, apiKey: "test-only-key", fetchImpl });
  assert.deepEqual(tokenIds, ["561", "973"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, `/api/v2/chain/monad/account/${owner}/nfts`);
  assert.equal(calls[0].url.searchParams.get("collection"), "chog-genesis");
  assert.equal(calls[0].url.searchParams.get("limit"), "200");
  assert.equal(calls[0].init.headers["X-API-KEY"], "test-only-key");
});

test("paginates and de-duplicates repeated IDs", async () => {
  const cursors = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    const cursor = parsed.searchParams.get("next");
    cursors.push(cursor);
    if (!cursor) {
      return response({
        nfts: [
          { contract: CHOG_CONTRACT, identifier: "561" },
          { contract: CHOG_CONTRACT, identifier: "973" },
        ],
        next: "cursor-next",
      });
    }
    assert.equal(cursor, "cursor-next");
    return response({
      nfts: [
        { contract: CHOG_CONTRACT, identifier: "973" },
        { contract: CHOG_CONTRACT, identifier: "1053" },
      ],
      next: null,
    });
  };

  const tokenIds = await findOwnedChogTokenIds({ owner, apiKey: "test-only-key", fetchImpl });
  assert.deepEqual(tokenIds, ["561", "973", "1053"]);
  assert.deepEqual(cursors, [null, "cursor-next"]);
});

test("rejects invalid wallet addresses before making an API request", async () => {
  let calls = 0;
  await assert.rejects(
    findOwnedChogTokenIds({ owner: "not-a-wallet", apiKey: "test-only-key", fetchImpl: async () => { calls += 1; } }),
    (error) => error instanceof OpenSeaLookupError && error.status === 400 && error.code === "INVALID_OWNER"
  );
  assert.equal(calls, 0);
});

test("fails clearly when the server-side API key is missing", async () => {
  await assert.rejects(
    findOwnedChogTokenIds({ owner, apiKey: "", fetchImpl: async () => response({ nfts: [] }) }),
    (error) => error instanceof OpenSeaLookupError && error.status === 503 && error.code === "OPENSEA_NOT_CONFIGURED"
  );
});

test("turns upstream rate limits into a retryable service error", async () => {
  await assert.rejects(
    findOwnedChogTokenIds({
      owner,
      apiKey: "test-only-key",
      fetchImpl: async () => response({ error: "too many requests" }, {
        status: 429,
        headers: { "retry-after": "3" },
      }),
    }),
    (error) => error instanceof OpenSeaLookupError
      && error.status === 503
      && error.code === "OPENSEA_RATE_LIMIT"
      && error.retryAfter === "3"
  );
});

test("fails closed if pagination exceeds the safety cap", async () => {
  let calls = 0;
  await assert.rejects(
    findOwnedChogTokenIds({
      owner,
      apiKey: "test-only-key",
      fetchImpl: async () => {
        calls += 1;
        return response({ nfts: [{ contract: CHOG_CONTRACT, identifier: String(calls) }], next: `cursor-${calls}` });
      },
    }),
    (error) => error instanceof OpenSeaLookupError && error.code === "OPENSEA_PAGINATION_LIMIT"
  );
  assert.equal(calls, 10);
});
