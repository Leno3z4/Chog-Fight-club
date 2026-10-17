import { handlePlayerDirectoryRequest, PlayerDirectoryError } from "../../server/players.js";

export async function onRequest({ request, env }) {
  if (!["GET", "POST"].includes(request.method)) {
    return Response.json({ error: "Method not allowed." }, { status: 405, headers: { Allow: "GET, POST" } });
  }
  const url = new URL(request.url);
  try {
    const result = await handlePlayerDirectoryRequest({
      method: request.method,
      url: url.toString(),
      cookieHeader: request.headers.get("Cookie") || "",
      env,
    });
    return Response.json(result.body, {
      status: result.status,
      headers: { "Cache-Control": result.headers?.["Cache-Control"] || "private, no-store" },
    });
  } catch (error) {
    const status = error instanceof PlayerDirectoryError ? error.status : 500;
    if (status >= 500) console.error("Player directory error", error?.code || error?.name || "Error");
    return Response.json({
      error: error instanceof Error ? error.message : "Player directory request failed.",
      code: error?.code || "PLAYER_DIRECTORY_FAILED",
    }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
