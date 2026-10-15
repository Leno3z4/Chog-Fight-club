import { startDiscordOAuth } from "../../server/discordAuth.js";

export default async function handler(req, res) {
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const origin = `${proto}://${req.headers.host}`;
  try {
    const result = await startDiscordOAuth({ origin, env: process.env, secure: proto === "https" });
    res.statusCode = result.status;
    if (result.cookies?.length) res.setHeader("Set-Cookie", result.cookies);
    res.setHeader("Location", result.location);
    return res.end();
  } catch (error) {
    const url = new URL("/", origin);
    url.searchParams.set("error", error?.code || "DISCORD_CONFIG_MISSING");
    res.statusCode = 302;
    res.setHeader("Location", url.toString());
    return res.end();
  }
}
