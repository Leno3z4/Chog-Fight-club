import "./auth.css";

const button = document.querySelector("#discord-connect");
const status = document.querySelector("#auth-status");
const params = new URLSearchParams(window.location.search);
const returnTo = params.get("returnTo") || "/profile.html";
let isAlreadyAuthenticated = false;
const errors = {
  discord_configuration: "Discord access is not configured yet.",
  DISCORD_CONFIG_MISSING: "Discord access is not configured yet.",
  discord_state_invalid: "Discord sign-in expired or could not be verified. Please try again.",
  discord_consent_cancelled: "Discord connection was cancelled.",
  discord_token_exchange_failed: "Discord could not complete sign-in. Please retry.",
  discord_token_missing: "Discord did not return a valid access token.",
  discord_not_in_server: "You must join the required Discord server before entering.",
  discord_role_check_failed: "We could not verify your server membership. Please try again.",
  holder_role_required: "You need the Chog holder role to enter the club.",
  discord_configuration: "Discord access is not configured yet. Please try again later.",
};
function setStatus(message, kind = "info") {
  status.textContent = message;
  status.dataset.kind = kind;
}
const code = params.get("error");
if (code) setStatus(errors[code] || "Discord sign-in did not complete. Please try again.", "error");

async function checkSession() {
  try {
    const response = await fetch("/api/discord/session", { headers: { accept: "application/json" }, credentials: "same-origin" });
    if (!response.ok) return;
    const session = await response.json();
    if (session?.authenticated) {
      isAlreadyAuthenticated = true;
      button.innerHTML = "<span class='discord-mark'>✓</span><span>Continue to profile</span><b>↗</b>";
      setStatus(`Signed in as ${session.user?.username ?? "Discord member"}.`, "success");
    }
  } catch {
    // The login screen remains usable; the server may not be configured yet.
  }
}
button.addEventListener("click", () => {
  if (isAlreadyAuthenticated) {
    window.location.assign(returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/profile.html");
    return;
  }
  button.disabled = true;
  setStatus("Taking you to Discord to verify your holder role…");
  window.location.assign("/api/discord/login?returnTo=" + encodeURIComponent(returnTo));
});
checkSession();
