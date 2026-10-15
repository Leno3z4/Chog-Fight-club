import { findOwnedChogTokenIds, OpenSeaLookupError, CHOG_COLLECTION, CHOG_CONTRACT } from "../server/openSeaChogs.js";

function json(res, status, payload) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return json(res, 405, { error: "Method not allowed." });
  }

  try {
    const tokenIds = await findOwnedChogTokenIds({
      owner: req.query?.owner,
      apiKey: process.env.OPENSEA_API_KEY,
    });
    res.setHeader("Cache-Control", "private, max-age=15, stale-while-revalidate=30");
    return json(res, 200, {
      source: "opensea",
      collection: CHOG_COLLECTION,
      contract: CHOG_CONTRACT,
      tokenIds,
      count: tokenIds.length,
    });
  } catch (error) {
    if (error instanceof OpenSeaLookupError && error.retryAfter) {
      res.setHeader("Retry-After", error.retryAfter);
    }
    if (error?.status >= 500) res.setHeader("Cache-Control", "private, no-store");
    const status = error instanceof OpenSeaLookupError ? error.status : 502;
    const message = error instanceof OpenSeaLookupError ? error.message : "OpenSea could not return the Chog roster right now.";
    const code = error instanceof OpenSeaLookupError ? error.code : "OPENSEA_REQUEST_FAILED";
    if (status >= 500) console.error("OpenSea Chog lookup failed", code);
    return json(res, status, { error: message, code });
  }
}
