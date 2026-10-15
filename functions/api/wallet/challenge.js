import { startWalletLink, DiscordAuthError } from "../../../server/discordAuth.js";

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405, headers: { Allow: "POST" } });
  const url = new URL(request.url);
  try {
    const result = await startWalletLink({
      cookieHeader: request.headers.get("Cookie") || "",
      env,
      origin: url.origin,
      secure: url.protocol === "https:",
    });
    const headers = new Headers({ "Cache-Control": "no-store" });
    for (const value of result.cookies ?? []) headers.append("Set-Cookie", value);
    return Response.json(result.body, { status: result.status, headers });
  } catch (error) {
    const status = error instanceof DiscordAuthError ? error.status : 500;
    return Response.json({
      error: error instanceof Error ? error.message : "Could not create a wallet-link challenge.",
      code: error?.code || "WALLET_CHALLENGE_FAILED",
    }, { status });
  }
}
