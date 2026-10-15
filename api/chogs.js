const CHOG_COLLECTION = "chog-genesis";
const CHOG_CONTRACT = "0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763";
const OPENSEA_BASE = "https://api.opensea.io/api/v2";
const PAGE_LIMIT = 200;
const MAX_PAGES = 10;

function json(res, status, payload) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return json(res, 405, { error: "Method not allowed." });
  }

  const owner = String(req.query?.owner ?? "");
  if (!/^0x[a-fA-F0-9]{40}$/.test(owner)) {
    return json(res, 400, { error: "A valid wallet address is required in the owner query parameter." });
  }

  const apiKey = process.env.OPENSEA_API_KEY;
  if (!apiKey) {
    return json(res, 503, {
      error: "OpenSea ownership lookup is not configured. Add OPENSEA_API_KEY as a server-side deployment secret.",
      code: "OPENSEA_NOT_CONFIGURED",
    });
  }

  const tokenIds = new Set();
  let cursor;
  let completed = false;

  try {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const url = new URL(`${OPENSEA_BASE}/chain/monad/account/${owner}/nfts`);
      url.searchParams.set("collection", CHOG_COLLECTION);
      url.searchParams.set("include_auto_hidden", "true");
      url.searchParams.set("limit", String(PAGE_LIMIT));
      if (cursor) url.searchParams.set("next", cursor);

      const response = await fetch(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          "X-API-KEY": apiKey,
        },
      });

      if (!response.ok) {
        if (response.status === 429) {
          const retryAfter = response.headers.get("retry-after");
          if (retryAfter) res.setHeader("Retry-After", retryAfter);
          res.setHeader("Cache-Control", "private, no-store");
          return json(res, 503, {
            error: "OpenSea rate limit reached. Wait briefly and retry.",
            code: "OPENSEA_RATE_LIMIT",
          });
        }
        // Do not forward upstream bodies or headers that may contain sensitive/debug data.
        console.error("OpenSea Chog lookup failed with status", response.status);
        return json(res, 502, {
          error: "OpenSea could not return the Chog roster right now.",
          code: "OPENSEA_UPSTREAM_ERROR",
        });
      }

      const payload = await response.json();
      const nfts = Array.isArray(payload?.nfts) ? payload.nfts : [];

      for (const nft of nfts) {
        const contract = String(nft?.contract ?? "").toLowerCase();
        const identifier = nft?.identifier;
        // Collection-slug filtering is helpful, but contract-address filtering is the hard boundary.
        if (contract === CHOG_CONTRACT && identifier !== undefined && identifier !== null) {
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
      return json(res, 502, {
        error: "OpenSea returned too many pages to safely enumerate this roster in one request.",
        code: "OPENSEA_PAGINATION_LIMIT",
      });
    }

    res.setHeader("Cache-Control", "private, max-age=15, stale-while-revalidate=30");
    return json(res, 200, {
      source: "opensea",
      collection: CHOG_COLLECTION,
      contract: CHOG_CONTRACT,
      tokenIds: [...tokenIds],
      count: tokenIds.size,
    });
  } catch (error) {
    console.error("OpenSea Chog lookup threw", error?.name ?? "Error");
    return json(res, 502, {
      error: "OpenSea could not return the Chog roster right now.",
      code: "OPENSEA_REQUEST_FAILED",
    });
  }
}
