import { finishDiscordOAuth } from "../../../server/discordAuth.js";

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const result = await finishDiscordOAuth({
    requestUrl: url.toString(),
    cookieHeader: request.headers.get("Cookie") || "",
    env,
    secure: url.protocol === "https:",
  });
  const headers = new Headers({ Location: result.location, "Cache-Control": "no-store" });
  for (const value of result.cookies ?? []) headers.append("Set-Cookie", value);
  return new Response(null, { status: result.status, headers });
}
