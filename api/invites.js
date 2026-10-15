import { handleInviteRequest, InviteApiError } from "../server/invites.js";

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed." });
  }
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const origin = `${proto}://${req.headers.host}`;
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  try {
    const result = await handleInviteRequest({
      method: req.method,
      url: req.url,
      cookieHeader: req.headers.cookie || "",
      env: process.env,
      body: body || {},
      origin,
    });
    res.setHeader("Cache-Control", result.headers?.["Cache-Control"] || "private, no-store");
    return res.status(result.status).json(result.body);
  } catch (error) {
    const status = error instanceof InviteApiError ? error.status : 500;
    if (status >= 500) console.error("Invite API failed", error?.code || error?.name || "Error");
    return res.status(status).json({
      error: error instanceof Error ? error.message : "The invitation request failed.",
      code: error?.code || "INVITE_REQUEST_FAILED",
    });
  }
}
