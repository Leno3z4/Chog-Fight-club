import "./auth.css";

async function verifySession() {
  try {
    const response = await fetch("/api/discord/session", { credentials: "same-origin", headers: { accept: "application/json" } });
    const payload = await response.json();
    if (payload.authenticated) return;
  } catch { /* redirect if auth cannot be verified */ }
  window.location.replace("/");
}
verifySession();
