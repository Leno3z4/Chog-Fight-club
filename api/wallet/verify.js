import { finishWalletLink, DiscordAuthError } from "../../server/discordAuth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  try {
    const result = await finishWalletLink({
      cookieHeader: req.headers.cookie || "",
      env: process.env,
      message: body?.message,
      signature: body?.signature,
      secure: proto === "https",
    });
    res.setHeader("Set-Cookie", result.cookies);
    res.setHeader("Cache-Control", "no-store");
    return res.status(result.status).json(result.body);
  } catch (error) {
    const status = error instanceof DiscordAuthError ? error.status : 500;
    return res.status(status).json({
      error: error instanceof Error ? error.message : "Could not verify the wallet signature.",
      code: error?.code || "WALLET_VERIFY_FAILED",
    });
  }
}
