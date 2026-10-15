import { findOwnedChogTokenIds, OpenSeaLookupError, CHOG_COLLECTION, CHOG_CONTRACT } from "../../server/openSeaChogs.js";

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  if (request.method !== "GET") {
    return Response.json({ error: "Method not allowed." }, { status: 405, headers: { Allow: "GET" } });
  }

  try {
    const tokenIds = await findOwnedChogTokenIds({
      owner: url.searchParams.get("owner"),
      apiKey: env.OPENSEA_API_KEY,
    });
    return Response.json({
      source: "opensea",
      collection: CHOG_COLLECTION,
      contract: CHOG_CONTRACT,
      tokenIds,
      count: tokenIds.length,
    }, {
      status: 200,
      headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=30" },
    });
  } catch (error) {
    const headers = new Headers();
    headers.set("Content-Type", "application/json; charset=utf-8");
    if (error instanceof OpenSeaLookupError && error.retryAfter) headers.set("Retry-After", error.retryAfter);
    if (!(error instanceof OpenSeaLookupError) || error.status >= 500) headers.set("Cache-Control", "private, no-store");
    const status = error instanceof OpenSeaLookupError ? error.status : 502;
    const message = error instanceof OpenSeaLookupError ? error.message : "OpenSea could not return the Chog roster right now.";
    const code = error instanceof OpenSeaLookupError ? error.code : "OPENSEA_REQUEST_FAILED";
    if (status >= 500) console.error("OpenSea Chog lookup failed", code);
    return Response.json({ error: message, code }, { status, headers });
  }
}
