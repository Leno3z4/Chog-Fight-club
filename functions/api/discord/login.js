import { startDiscordOAuth } from "../../../server/discordAuth.js";

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  try {
    const returnTo = url.searchParams.get("returnTo") || "/profile.html";
    const result = await startDiscordOAuth({ origin: url.origin, env, secure: url.protocol === "https:", returnTo });
    const headers = new Headers({ Location: result.location, "Cache-Control": "no-store" });
    for (const value of result.cookies ?? []) headers.append("Set-Cookie", value);
    return new Response(null, { status: result.status, headers });
  } catch (error) {
    const target = new URL("/", url.origin);
    target.searchParams.set("error", error?.code || "DISCORD_CONFIG_MISSING");
    return Response.redirect(target.toString(), 302);
  }
}
