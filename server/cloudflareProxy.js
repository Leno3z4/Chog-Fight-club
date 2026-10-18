export async function proxyToCloudflare(req, res, { path, methods = ["GET"] }) {
  const method = String(req.method || "GET").toUpperCase();
  if (!methods.includes(method)) {
    res.setHeader("Allow", methods.join(", "));
    return res.status(405).json({ error: "Method not allowed.", code: "METHOD_NOT_ALLOWED" });
  }

  try {
    const configured = String(process.env.CLOUDFLARE_BACKEND_URL || "").trim();
    if (!configured) {
      const error = new Error("Cloudflare backend is not configured. Set CLOUDFLARE_BACKEND_URL in Vercel.");
      error.statusCode = 503;
      throw error;
    }

    const base = new URL(configured);
    if (base.protocol !== "https:" || base.username || base.password) {
      const error = new Error("CLOUDFLARE_BACKEND_URL must be an HTTPS URL without credentials.");
      error.statusCode = 500;
      throw error;
    }

    const incoming = new URL(req.url || path, "https://vercel.invalid");
    const target = new URL(path, base);
    target.search = incoming.search;

    const headers = { accept: "application/json" };
    if (req.headers?.cookie) headers.Cookie = req.headers.cookie;

    let body;
    if (method !== "GET" && method !== "HEAD") {
      headers["Content-Type"] = "application/json";
      const incomingBody = req.body;
      body = typeof incomingBody === "string"
        ? incomingBody
        : JSON.stringify(incomingBody ?? {});
    }

    const upstream = await fetch(target.toString(), {
      method,
      headers,
      body,
      redirect: "manual",
    });

    res.statusCode = upstream.status;
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
    res.setHeader("Cache-Control", upstream.headers.get("cache-control") || "private, no-store");

    for (const name of ["location", "retry-after", "www-authenticate"]) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }

    const cookies = typeof upstream.headers.getSetCookie === "function"
      ? upstream.headers.getSetCookie()
      : (upstream.headers.get("set-cookie") ? [upstream.headers.get("set-cookie")] : []);
    if (cookies.length) res.setHeader("Set-Cookie", cookies);

    return res.end(await upstream.text());
  } catch (error) {
    const status = Number(error?.statusCode) || 502;
    if (status >= 500) console.error("Cloudflare backend proxy failed", error?.message || "unknown");
    return res.status(status).json({
      error: error instanceof Error ? error.message : "Cloudflare backend could not be reached.",
      code: status === 503 ? "CLOUDFLARE_BACKEND_NOT_CONFIGURED" : "CLOUDFLARE_BACKEND_UNAVAILABLE",
    });
  }
}
