import "./auth.css";
import { buildRosterPreview } from "./nft/rosterPreview.js";
import { getOwnedChogs } from "./nft/chogNft.js";
import { connectAndLinkWallet } from "./walletLink.js";

const $ = (selector) => document.querySelector(selector);
const state = {
  id: new URLSearchParams(window.location.search).get("id"),
  session: null,
  wallet: null,
  chogs: [],
  selectedTokenId: null,
  invite: null,
  busy: false,
};
const alertNode = $("#invite-page-alert");
const isBattleLobbyPage = window.location.pathname.endsWith("/battle-lobby.html");
const acceptedStatuses = ["TERMS_ACCEPTED", "READY", "IN_BATTLE", "RESULT_PENDING", "SETTLED", "CONDITION_PENDING", "CONDITION_FULFILLED"];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}
function showAlert(message, kind = "error") {
  alertNode.hidden = false;
  alertNode.textContent = message;
  alertNode.dataset.kind = kind;
}
function clearAlert() {
  alertNode.hidden = true;
  alertNode.textContent = "";
}
function statusText(value) {
  return String(value ?? "UNKNOWN").replaceAll("_", " ");
}
function isActive(invite) {
  return ["PENDING_ACCEPTANCE", "TERMS_ACCEPTED", "READY"].includes(invite?.status);
}
function viewer(invite) {
  return invite?.viewerRole === "challenger" ? invite.challenger : invite?.opponent;
}
function opponent(invite) {
  return invite?.viewerRole === "challenger" ? invite.opponent : invite.challenger;
}
function updateTimeline(invite) {
  const steps = [...$("#lobby-timeline").querySelectorAll("li")];
  const status = invite.status;
  const stage = status === "PENDING_ACCEPTANCE" ? 0
    : status === "TERMS_ACCEPTED" ? 2
      : status === "READY" ? 3
        : ["IN_BATTLE", "RESULT_PENDING", "SETTLED", "CONDITION_PENDING", "CONDITION_FULFILLED"].includes(status) ? 4
          : -1;
  steps.forEach((item, index) => {
    item.classList.toggle("current", index === stage);
    item.classList.toggle("done", stage >= 0 && index < stage);
    item.classList.toggle("failed", ["DECLINED", "CANCELLED", "EXPIRED", "DISPUTED", "ABANDONED"].includes(status));
  });
}
function renderSummary(invite) {
  state.invite = invite;
  $("#invite-short-id").textContent = invite.id.slice(0, 8).toUpperCase();
  const roomUrl = new URL(`/battle-lobby.html?id=${encodeURIComponent(invite.id)}`, window.location.origin).toString();
  const roomPath = $("#battle-room-url");
  const roomCode = $("#battle-room-id");
  if (roomPath) roomPath.textContent = roomUrl;
  if (roomCode) roomCode.textContent = invite.id.slice(0, 8).toUpperCase();
  $("#invite-status-chip").textContent = statusText(invite.status);
  $("#invite-condition").textContent = invite.condition;
  $("#condition-hash").textContent = invite.termsHash || "—";
  $("#challenger-name").textContent = invite.challenger.username || "Challenger";
  $("#challenger-chog").textContent = invite.challenger.tokenId ? `Chog #${invite.challenger.tokenId}` : "Chog not selected";
  $("#challenger-terms").textContent = `Terms accepted: ${invite.challenger.termsAccepted ? "Yes" : "No"}`;
  $("#challenger-ready").textContent = `Ready: ${invite.challenger.ready ? "Yes" : "No"}`;
  $("#opponent-name").textContent = invite.opponent.username || "Opponent";
  $("#opponent-chog").textContent = invite.opponent.tokenId ? `Chog #${invite.opponent.tokenId}` : "Chog not selected";
  $("#opponent-terms").textContent = `Terms accepted: ${invite.opponent.termsAccepted ? "Yes" : "No"}`;
  $("#opponent-ready").textContent = `Ready: ${invite.opponent.ready ? "Yes" : "No"}`;

  const isRecipient = invite.viewerRole === "opponent";
  const pending = invite.status === "PENDING_ACCEPTANCE";
  $("#invite-headline").innerHTML = isBattleLobbyPage
    ? "BATTLE<br /><span>LOBBY.</span>"
    : isRecipient && pending
      ? "YOUR RIVAL<br /><span>HAS CALLED.</span>"
      : "THE CHALLENGE<br /><span>IS ON.</span>";
  $("#invite-intro").textContent = isBattleLobbyPage && acceptedStatuses.includes(invite.status)
    ? `This is the shared room for ${invite.challenger.username || "the challenger"} and ${invite.opponent.username || "the opponent"}. Both players return here to confirm readiness and find the next match step.`
    : isRecipient && pending
      ? `${invite.challenger.username || "A player"} challenged you. Review the condition, pick one of your Chogs, and decide whether to accept.`
      : `Challenge between ${invite.challenger.username || "the challenger"} and ${invite.opponent.username || "the opponent"}. Review the condition and status here.`;

  $("#accept-card").hidden = !(isRecipient && pending);
  $("#ready-card").hidden = !["TERMS_ACCEPTED", "READY"].includes(invite.status);
  $("#cancel-invite").hidden = !(invite.viewerRole === "challenger" && pending);
  $("#accept-invite").disabled = !state.selectedTokenId || !$("#accept-condition-check").checked || !state.wallet;
  $("#ready-status-chip").textContent = invite.status === "READY" ? "BOTH READY" : "WAITING";
  $("#ready-button").disabled = invite.status === "READY" || Boolean(viewer(invite).ready);
  $("#ready-button").textContent = viewer(invite).ready ? "You're ready ✓" : "I'm ready ↗";
  $("#ready-explanation").textContent = invite.status === "READY"
    ? "Both players have confirmed readiness. The shared lobby is synchronized; the live PvP match relay is not enabled yet."
    : `Your readiness: ${viewer(invite).ready ? "confirmed" : "not confirmed"}. Opponent readiness: ${opponent(invite).ready ? "confirmed" : "waiting"}.`;
  updateTimeline(invite);
}
function renderChogs() {
  const target = $("#lobby-chog-grid");
  $("#fighter-count").textContent = state.chogs.length ? `${state.chogs.length} CHOG(S)` : "NO CHOGS";
  if (!state.chogs.length) {
    target.innerHTML = '<div class="roster-empty">Connect and verify a wallet to load your owned Chogs.</div>';
    updateAcceptButton();
    return;
  }
  target.innerHTML = state.chogs.map((chog) => {
    const meta = chog.metadata || {};
    const dna = buildRosterPreview(meta);
    const picked = String(state.selectedTokenId) === String(chog.tokenId);
    const image = meta.image
      ? `<img src="${escapeHtml(meta.image)}" alt="${escapeHtml(meta.name || `Chog #${chog.tokenId}`)}" loading="lazy" referrerpolicy="no-referrer">`
      : '<div class="no-art">C</div>';
    return `<button type="button" class="lobby-chog-card ${picked ? "selected" : ""}" data-select-fighter="${escapeHtml(chog.tokenId)}">
      <div class="lobby-chog-art">${image}</div>
      <div class="lobby-chog-card-copy">
        <div class="lobby-chog-title"><strong>${escapeHtml(meta.name || `Chog #${chog.tokenId}`)}</strong><span class="tier-chip">${escapeHtml(meta.Tier || "Common")}</span></div>
        <small>Chog Genesis · #${escapeHtml(chog.tokenId)}</small>
        <div class="lobby-chog-stats"><span>HP <b>${Math.round(dna.stats.hp)}</b></span><span>ATK <b>${Math.round(dna.stats.attack)}</b></span><span>DEF <b>${Math.round(dna.stats.defense)}</b></span><span>SPD <b>${Math.round(dna.stats.speed)}</b></span></div>
        <span class="lobby-pick-label">${picked ? "✓ SELECTED" : "SELECT THIS CHOG"}</span>
      </div>
    </button>`;
  }).join("");
  updateAcceptButton();
}
function updateAcceptButton() {
  const button = $("#accept-invite");
  if (button) button.disabled = !state.selectedTokenId || !$("#accept-condition-check").checked || !state.wallet;
}
async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401 || payload.code === "DISCORD_SESSION_REQUIRED") {
    const returnTo = `/invite.html?id=${encodeURIComponent(state.id || "")}`;
    window.location.replace("/?returnTo=" + encodeURIComponent(returnTo));
    throw new Error("Redirecting to Discord verification…");
  }
  if (!response.ok) throw new Error(payload.error || "The request failed.");
  return payload;
}
async function loadInvite() {
  if (!state.id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(state.id)) {
    throw new Error("This invitation link is invalid. Ask the challenger to send a fresh link.");
  }
  const payload = await requestJson(`/api/invites?id=${encodeURIComponent(state.id)}`);
  renderSummary(payload.invite);
  if (acceptedStatuses.includes(payload.invite.status) && !isBattleLobbyPage) {
    window.location.replace(`/battle-lobby.html?id=${encodeURIComponent(state.id)}`);
    return;
  }
}
async function loadChogs() {
  if (!state.wallet) return;
  $("#fighter-prompt").textContent = "Reading Chog ownership and metadata from Monad…";
  try {
    state.chogs = await getOwnedChogs(state.wallet);
    const oldSelection = state.chogs.find((item) => String(item.tokenId) === String(state.selectedTokenId));
    if (!oldSelection) state.selectedTokenId = null;
    $("#fighter-prompt").textContent = state.chogs.length
      ? "Select the Chog you want to enter into this challenge."
      : "No Chog Genesis NFTs were found in this wallet. You cannot accept an official challenge without one.";
    renderChogs();
  } catch (error) {
    $("#fighter-prompt").textContent = error?.message || "Could not load the Chog roster.";
    state.chogs = [];
    renderChogs();
  }
}
async function connectAndLoadWallet() {
  const button = $("#link-wallet");
  button.disabled = true;
  button.textContent = "Verify wallet signature…";
  try {
    state.wallet = await connectAndLinkWallet();
    if (state.session) state.session.walletAddress = state.wallet;
    button.textContent = `${state.wallet.slice(0,6)}…${state.wallet.slice(-4)} ✓`;
    $("#fighter-prompt").textContent = "Wallet linked to your Discord identity. Loading your Chogs…";
    await loadChogs();
    updateAcceptButton();
    if (state.invite?.viewerRole === "opponent" && state.invite.status === "PENDING_ACCEPTANCE") $("#accept-card").hidden = false;
  } catch (error) {
    if (error?.code === 4001) showAlert("Wallet signature cancelled. You have not accepted the challenge.");
    else showAlert(error?.message || "Wallet verification failed.");
    button.textContent = "Connect and verify wallet ↗";
  } finally {
    button.disabled = false;
  }
}
async function postAction(action, extra = {}) {
  state.busy = true;
  clearAlert();
  try {
    const payload = await requestJson("/api/invites", {
      method: "POST",
      body: JSON.stringify({ action, id: state.id, ...extra }),
    });
    if (payload.invite) renderSummary(payload.invite);
    if (payload.notice) showAlert(payload.notice, "success");
    if (action === "accept") {
      showAlert("Challenge accepted. Both players have acknowledged the condition. Pact NFT minting and live PvP are not enabled yet.", "success");
    }
    return payload;
  } catch (error) {
    showAlert(error?.message || "Could not update this invitation.");
    throw error;
  } finally {
    state.busy = false;
  }
}

$("#link-wallet").addEventListener("click", connectAndLoadWallet);
$("#accept-condition-check").addEventListener("change", updateAcceptButton);
$("#accept-invite").addEventListener("click", async () => {
  if (state.busy) return;
  if (!state.wallet) return showAlert("Connect and verify the wallet belonging to your Discord account first.");
  if (!state.selectedTokenId) return showAlert("Choose one of your Chogs first.");
  if (!$("#accept-condition-check").checked) return showAlert("Confirm that you accept the exact proposed condition.");
  $("#accept-invite").disabled = true;
  try {
    await postAction("accept", {
      opponentTokenId: String(state.selectedTokenId),
      agreeToCondition: true,
    });
    window.location.replace(`/battle-lobby.html?id=${encodeURIComponent(state.id)}`);
  } catch {
    // postAction already renders a visible error.
  } finally {
    updateAcceptButton();
  }
});
$("#decline-invite").addEventListener("click", async () => {
  if (state.busy) return;
  if (!window.confirm("Decline this challenge? The sender will see that it was declined.")) return;
  $("#decline-invite").disabled = true;
  try {
    await postAction("decline");
  } catch {
    // postAction already renders a visible error.
  } finally {
    $("#decline-invite").disabled = false;
  }
});
$("#cancel-invite").addEventListener("click", async () => {
  if (state.busy) return;
  if (!window.confirm("Cancel this pending challenge?")) return;
  $("#cancel-invite").disabled = true;
  try {
    await postAction("cancel");
  } catch {
    // postAction already renders a visible error.
  } finally {
    $("#cancel-invite").disabled = false;
  }
});
$("#ready-button").addEventListener("click", async () => {
  if (state.busy) return;
  if (!state.wallet || !state.session?.walletAddress || state.wallet.toLowerCase() !== state.session.walletAddress.toLowerCase()) {
    return showAlert("Connect and verify the linked wallet on Monad before confirming readiness.");
  }
  $("#ready-button").disabled = true;
  try {
    await postAction("ready");
  } catch {
    // postAction already renders a visible error.
  } finally {
    if (state.invite) renderSummary(state.invite);
    else $("#ready-button").disabled = false;
  }
});
const copyRoomButton = $("#copy-battle-room");
if (copyRoomButton) {
  copyRoomButton.addEventListener("click", async () => {
    const roomUrl = new URL(`/battle-lobby.html?id=${encodeURIComponent(state.id || "")}`, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(roomUrl);
      copyRoomButton.textContent = "Copied room link";
    } catch {
      showAlert("Copy was blocked. Copy the room link shown above.");
    }
  });
}
$("#refresh-invite").addEventListener("click", async () => {
  try {
    await loadInvite();
    clearAlert();
  } catch (error) {
    showAlert(error?.message || "Could not refresh this invitation.");
  }
});
$("#lobby-chog-grid").addEventListener("click", (event) => {
  const button = event.target.closest("[data-select-fighter]");
  if (!button) return;
  const chog = state.chogs.find((item) => String(item.tokenId) === button.dataset.selectFighter);
  if (!chog) return;
  state.selectedTokenId = chog.tokenId;
  $("#selected-fighter-status").textContent = `${chog.metadata.name || `Chog #${chog.tokenId}`} selected.`;
  renderChogs();
});

async function init() {
  try {
    const sessionResponse = await fetch("/api/discord/session", { credentials: "same-origin", headers: { accept: "application/json" } });
    const sessionPayload = await sessionResponse.json().catch(() => ({}));
    if (!sessionPayload?.authenticated) {
      const returnTo = `/invite.html?id=${encodeURIComponent(state.id || "")}`;
      window.location.replace("/?returnTo=" + encodeURIComponent(returnTo));
      return;
    }
    state.session = sessionPayload.user;
    state.wallet = null;
    await loadInvite();
    await fetch("/api/players", { method: "POST", credentials: "same-origin", headers: { accept: "application/json" } }).catch(() => {});
    if (state.wallet && window.ethereum?.request) {
      try {
        const [accounts, chainId] = await Promise.all([
          window.ethereum.request({ method: "eth_accounts" }),
          window.ethereum.request({ method: "eth_chainId" }),
        ]);
        const linkedWallet = state.session.walletAddress;
        if (linkedWallet && accounts?.[0]?.toLowerCase() === linkedWallet.toLowerCase() && String(chainId).toLowerCase() === "0x8f") {
          state.wallet = linkedWallet;
          $("#link-wallet").textContent = `${state.wallet.slice(0,6)}…${state.wallet.slice(-4)} ✓`;
          await loadChogs();
        } else {
          state.wallet = null;
          $("#link-wallet").textContent = "Connect and verify wallet ↗";
        }
      } catch {
        state.wallet = null;
      }
    }
  } catch (error) {
    showAlert(error?.message || "Could not load the invitation.");
  }
}

init();
window.setInterval(async () => {
  if (document.hidden || state.busy || !state.session || !state.id) return;
  try {
    await loadInvite();
  } catch {
    // Keep the latest visible invite status; the manual refresh button exposes errors.
  }
}, 5000);
