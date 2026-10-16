import { finishDiscordOAuth } from "../../server/discordAuth.js";

export default async function handler(req, res) {
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const origin = `${proto}://${req.headers.host}`;
  const requestUrl = new URL(req.url || "/api/discord/callback", origin);
  const result = await finishDiscordOAuth({
    requestUrl: requestUrl.toString(),
    cookieHeader: req.headers.cookie || "",
    env: process.env,
    secure: proto === "https",
  });
  res.statusCode = result.status;
  if (result.cookies?.length) res.setHeader("Set-Cookie", result.cookies);
  res.setHeader("Location", result.location);
  res.setHeader("Cache-Control", "no-store");
  return res.end();
}
