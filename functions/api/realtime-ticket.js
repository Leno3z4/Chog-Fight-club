import { handleRealtimeTicketRequest, RealtimeTicketError } from "../../server/realtimeTicket.js";

export async function onRequest({ request, env }) {
  try {
    const result = await handleRealtimeTicketRequest({
      method: request.method,
      url: request.url,
      cookieHeader: request.headers.get("Cookie") || "",
      env,
    });
    return Response.json(result.body, { status: result.status, headers: result.headers || { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof RealtimeTicketError ? error.status : 500;
    if (status >= 500) console.error("Realtime ticket API failed", error?.code || error?.name || "Error");
    return Response.json({ error: error instanceof Error ? error.message : "Could not authorize the realtime room.", code: error?.code || "REALTIME_TICKET_FAILED" }, {
      status, headers: { "Cache-Control": "no-store" },
    });
  }
}
