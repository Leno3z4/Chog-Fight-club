import { readDiscordSession } from "../../../server/discordAuth.js";

export async function onRequest({ request, env }) {
  if (request.method !== "GET") return Response.json({ error: "Method not allowed." }, { status: 405, headers: { Allow: "GET" } });
  const result = await readDiscordSession({ cookieHeader: request.headers.get("Cookie") || "", env });
  return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
}
