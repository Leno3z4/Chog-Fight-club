import { endDiscordSession } from "../../../server/discordAuth.js";

export async function onRequest({ request }) {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405, headers: { Allow: "POST" } });
  const url = new URL(request.url);
  const result = endDiscordSession({ secure: url.protocol === "https:" });
  const headers = new Headers({ "Cache-Control": "no-store" });
  for (const value of result.cookies ?? []) headers.append("Set-Cookie", value);
  return Response.json(result.body, { headers });
}
