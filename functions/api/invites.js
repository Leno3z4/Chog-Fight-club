import { handleInviteRequest, InviteApiError } from "../../server/invites.js";

export async function onRequest({ request, env }) {
  if (!["GET", "POST"].includes(request.method)) {
    return Response.json({ error: "Method not allowed." }, { status: 405, headers: { Allow: "GET, POST" } });
  }
  const url = new URL(request.url);
  const configuredOrigin = String(env.DISCORD_APP_ORIGIN || "").trim();
  let appOrigin = url.origin;
  if (configuredOrigin) {
    try {
      const configuredUrl = new URL(configuredOrigin);
      if (configuredUrl.protocol === "https:" && !configuredUrl.username && !configuredUrl.password) {
        appOrigin = configuredUrl.origin;
      }
    } catch { /* Fall back to the request origin if configuration is invalid. */ }
  }
  const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
  try {
    const result = await handleInviteRequest({
      method: request.method,
      url: url.toString(),
      cookieHeader: request.headers.get("Cookie") || "",
      env,
      body,
      origin: appOrigin,
    });
    return Response.json(result.body, {
      status: result.status,
      headers: { "Cache-Control": result.headers?.["Cache-Control"] || "private, no-store" },
    });
  } catch (error) {
    const status = error instanceof InviteApiError ? error.status : 500;
    if (status >= 500) console.error("Invite API failed", error?.code || error?.name || "Error");
    return Response.json({
      error: error instanceof Error ? error.message : "The invitation request failed.",
      code: error?.code || "INVITE_REQUEST_FAILED",
    }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
