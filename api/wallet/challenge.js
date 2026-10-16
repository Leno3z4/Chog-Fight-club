import { startWalletLink, DiscordAuthError } from "../../server/discordAuth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const origin = `${proto}://${req.headers.host}`;
  try {
    const result = await startWalletLink({
      cookieHeader: req.headers.cookie || "",
      env: process.env,
      origin,
      secure: proto === "https",
    });
    if (result.cookies?.length) res.setHeader("Set-Cookie", result.cookies);
    res.setHeader("Cache-Control", "no-store");
    return res.status(result.status).json(result.body);
  } catch (error) {
    const status = error instanceof DiscordAuthError ? error.status : 500;
    return res.status(status).json({
      error: error instanceof Error ? error.message : "Could not create a wallet-link challenge.",
      code: error?.code || "WALLET_CHALLENGE_FAILED",
    });
  }
}
