export const CHOG_COLLECTION = "chog-genesis";
export const CHOG_CONTRACT = "0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763";
const OPENSEA_BASE = "https://api.opensea.io/api/v2";
const PAGE_LIMIT = 200;
const MAX_PAGES = 10;

export class OpenSeaLookupError extends Error {
  constructor(message, { status = 502, code = "OPENSEA_REQUEST_FAILED", retryAfter = null } = {}) {
    super(message);
    this.name = "OpenSeaLookupError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export async function findOwnedChogTokenIds({ owner, apiKey, fetchImpl = fetch }) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(String(owner ?? ""))) {
    throw new OpenSeaLookupError("A valid wallet address is required.", {
      status: 400,
      code: "INVALID_OWNER",
    });
  }
  if (!apiKey) {
    throw new OpenSeaLookupError(
      "OpenSea ownership lookup is not configured. Add OPENSEA_API_KEY as a server-side deployment secret.",
      { status: 503, code: "OPENSEA_NOT_CONFIGURED" }
    );
  }

  const tokenIds = new Set();
  let cursor = null;
  let completed = false;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(`${OPENSEA_BASE}/chain/monad/account/${owner}/nfts`);
    url.searchParams.set("collection", CHOG_COLLECTION);
    url.searchParams.set("include_auto_hidden", "true");
    url.searchParams.set("limit", String(PAGE_LIMIT));
    if (cursor) url.searchParams.set("next", cursor);

    let response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers: { accept: "application/json", "X-API-KEY": apiKey },
      });
    } catch {
      throw new OpenSeaLookupError("OpenSea could not be reached.", {
        status: 502,
        code: "OPENSEA_NETWORK_ERROR",
      });
    }

    if (!response.ok) {
      if (response.status === 429) {
        throw new OpenSeaLookupError("OpenSea rate limit reached. Wait briefly and retry.", {
          status: 503,
          code: "OPENSEA_RATE_LIMIT",
          retryAfter: response.headers.get("retry-after"),
        });
      }
      throw new OpenSeaLookupError("OpenSea could not return the Chog roster right now.", {
        status: 502,
        code: "OPENSEA_UPSTREAM_ERROR",
      });
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new OpenSeaLookupError("OpenSea returned an invalid response.", {
        status: 502,
        code: "OPENSEA_INVALID_RESPONSE",
      });
    }

    const nfts = Array.isArray(payload?.nfts) ? payload.nfts : [];
    for (const nft of nfts) {
      const contract = String(nft?.contract ?? "").toLowerCase();
      const identifier = nft?.identifier;
      // Filter to the canonical contract even though the collection slug is also supplied.
      if (contract === CHOG_CONTRACT && identifier !== undefined && identifier !== null && /^\d+$/.test(String(identifier))) {
        tokenIds.add(String(identifier));
      }
    }

    cursor = payload?.next || null;
    if (!cursor) {
      completed = true;
      break;
    }
  }

  if (!completed) {
    throw new OpenSeaLookupError("OpenSea returned too many pages to enumerate in one request.", {
      status: 502,
      code: "OPENSEA_PAGINATION_LIMIT",
    });
  }

  return [...tokenIds];
}
