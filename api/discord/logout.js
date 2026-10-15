import { endDiscordSession } from "../../../server/discordAuth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const result = endDiscordSession({ secure: proto === "https" });
  res.setHeader("Set-Cookie", result.cookies);
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json(result.body);
}
