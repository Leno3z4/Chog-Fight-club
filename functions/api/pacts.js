import { handlePactRequest, PactApiError } from "../../server/pacts.js";

export async function onRequest({ request, env }) {
  if (!["GET", "POST"].includes(request.method)) {
    return Response.json({ error: "Method not allowed." }, { status: 405, headers: { Allow: "GET, POST" } });
  }
  const url = new URL(request.url);
  const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
  try {
    const result = await handlePactRequest({
      method: request.method,
      url: url.toString(),
      cookieHeader: request.headers.get("Cookie") || "",
      env,
      body,
    });
    return Response.json(result.body, { status: result.status, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const status = error instanceof PactApiError ? error.status : 500;
    if (status >= 500) console.error("Pact API failed", error?.code || error?.name || "Error");
    return Response.json({
      error: error instanceof Error ? error.message : "The Pact request failed.",
      code: error?.code || "PACT_REQUEST_FAILED",
    }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
