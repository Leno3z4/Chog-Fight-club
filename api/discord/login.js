import { startDiscordOAuth } from "../../server/discordAuth.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end();
  }
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const origin = `${proto}://${req.headers.host}`;
  const requestedReturnTo = new URL(req.url || "/", origin).searchParams.get("returnTo") || "/profile.html";
  try {
    const result = await startDiscordOAuth({
      origin,
      env: process.env,
      secure: proto === "https",
      returnTo: requestedReturnTo,
    });
    res.statusCode = result.status;
    if (result.cookies?.length) res.setHeader("Set-Cookie", result.cookies);
    res.setHeader("Location", result.location);
    res.setHeader("Cache-Control", "no-store");
    return res.end();
  } catch (error) {
    const url = new URL("/", origin);
    url.searchParams.set("error", error?.code || "DISCORD_CONFIG_MISSING");
    res.statusCode = 302;
    res.setHeader("Location", url.toString());
    res.setHeader("Cache-Control", "no-store");
    return res.end();
  }
}
