import { readDiscordSession } from "../../server/discordAuth.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }
  const result = await readDiscordSession({ cookieHeader: req.headers.cookie || "", env: process.env });
  res.setHeader("Cache-Control", "private, no-store");
  return res.status(200).json(result);
}
