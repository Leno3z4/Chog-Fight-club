function backendBaseUrl() {
  const value = String(process.env.CLOUDFLARE_BACKEND_URL || "").trim();
  if (!value) {
    const error = new Error("Cloudflare Pact backend is not configured. Set CLOUDFLARE_BACKEND_URL in Vercel.");
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
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed." });
  }
  try {
    const base = backendBaseUrl();
    const incomingUrl = new URL(req.url || "/api/pacts", "https://vercel.invalid");
    const target = new URL("/api/pacts", base);
    target.search = incomingUrl.search;
    const headers = { accept: "application/json" };
    if (req.headers.cookie) headers.Cookie = req.headers.cookie;
    let body;
    if (req.method === "POST") {
      headers["Content-Type"] = "application/json";
      body = typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
    }
    const upstream = await fetch(target.toString(), { method: req.method, headers, body, redirect: "manual" });
    const raw = await upstream.text();
    res.statusCode = upstream.status;
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
    res.setHeader("Cache-Control", upstream.headers.get("cache-control") || "private, no-store");
    return res.end(raw);
  } catch (error) {
    const status = Number(error?.statusCode) || 502;
    if (status >= 500) console.error("Cloudflare Pact proxy error", error?.message || "unknown");
    return res.status(status).json({
      error: error instanceof Error ? error.message : "Cloudflare Pact backend could not be reached.",
      code: status === 503 ? "CLOUDFLARE_BACKEND_NOT_CONFIGURED" : "CLOUDFLARE_BACKEND_UNAVAILABLE",
    });
  }
}
