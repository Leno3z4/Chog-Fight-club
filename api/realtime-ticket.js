function backendBaseUrl() {
  const value = String(process.env.CLOUDFLARE_BACKEND_URL || "").trim();
  if (!value) {
    const error = new Error("Cloudflare realtime ticket backend is not configured. Set CLOUDFLARE_BACKEND_URL in Vercel.");
    error.statusCode = 503;
    throw error;
  }
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) {
    const error = new Error("CLOUDFLARE_BACKEND_URL must be an HTTPS base URL without credentials.");
    error.statusCode = 500;
    throw error;
  }
  return url;
}
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }
  try {
    const base = backendBaseUrl();
    const incomingUrl = new URL(req.url || "/api/realtime-ticket", "https://vercel.invalid");
    const target = new URL("/api/realtime-ticket", base);
    target.search = incomingUrl.search;
    const headers = { accept: "application/json" };
    if (req.headers.cookie) headers.Cookie = req.headers.cookie;
    const upstream = await fetch(target.toString(), { method: "GET", headers, redirect: "manual" });
    const raw = await upstream.text();
    res.statusCode = upstream.status;
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "private, no-store");
    return res.end(raw);
  } catch (error) {
    const status = Number(error?.statusCode) || 502;
    return res.status(status).json({
      error: error instanceof Error ? error.message : "Realtime authorization could not be reached.",
      code: status === 503 ? "CLOUDFLARE_BACKEND_NOT_CONFIGURED" : "CLOUDFLARE_BACKEND_UNAVAILABLE",
    });
  }
}
