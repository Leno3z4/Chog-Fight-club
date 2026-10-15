import "./auth.css";
import { buildBattleDNA } from "./game/battleDNA.js";
import { getOwnedChogs, saveSelectedFighter } from "./nft/chogNft.js";
import { connectAndLinkWallet } from "./walletLink.js";

const $ = (selector) => document.querySelector(selector);
const panels = ["chogs", "invites", "incoming", "outgoing", "history"];
const titles = {
  chogs: ["My Chogs", "YOUR COLLECTION"],
  invites: ["Invite to battle", "CHALLENGE DESK"],
  incoming: ["Incoming invites", "YOUR LOBBY"],
  outgoing: ["Sent invites", "CHALLENGE TRACKER"],
  history: ["Battle history", "YOUR RECORD"],
};
const state = { session: null, account: null, chogs: [], loading: false, selectedTokenId: null };
const walletButton = $("#connect-wallet");
const refreshButton = $("#refresh-chogs");
const grid = $("#chog-grid");
const empty = $("#roster-empty");
const subtitle = $("#roster-subtitle");
const count = $("#nav-chog-count");
const alertNode = $("#profile-alert");

function alertMessage(message) {
  alertNode.textContent = message;
  alertNode.hidden = false;
}
function clearAlert() { alertNode.hidden = true; alertNode.textContent = ""; }
function setPanel(name) {
  if (!panels.includes(name)) return;
  for (const panel of panels) {
    $(`#panel-${panel}`).classList.toggle("active", panel === name);
    document.querySelector(`[data-panel="${panel}"]`).classList.toggle("active", panel === name);
  }
  $("#panel-title").textContent = titles[name][0];
  $("#panel-overline").textContent = titles[name][1];
  if (name === "incoming" || name === "outgoing") loadInvites(name);
  if (name === "invites") updateSelectedMain();
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}
function stat(stats, key) { return Math.round(Number(stats?.[key] ?? 0)); }

function updateSelectedMain() {
  const chog = state.chogs.find((item) => String(item.tokenId) === String(state.selectedTokenId));
  const name = $("#selected-main-name");
  const details = $("#selected-main-details");
  if (!name || !details) return;
  name.textContent = chog ? (chog.metadata.name ?? `Chog #${chog.tokenId}`) : "No main Chog selected";
  details.textContent = chog
    ? `#${chog.tokenId} · ${chog.metadata.Tier ?? "Common"} · ${chog.metadata.Skin ?? "Unknown"} skin`
    : "Select a Chog in My Chogs first.";
}

function renderCard(chog) {
  const metadata = chog.metadata;
  const dna = buildBattleDNA(metadata);
  const title = metadata.name ?? `Chog #${chog.tokenId}`;
  const image = metadata.image
    ? `<img src="${escapeHtml(metadata.image)}" alt="${escapeHtml(title)}" loading="lazy" referrerpolicy="no-referrer" />`
    : `<div class="no-art">C</div>`;
  const traitKeys = ["Skin", "Base", "Form", "Body", "Eyes", "Head", "Aura", "Background", "Mouth", "Side"];
  const traits = traitKeys
    .filter((key) => metadata[key] !== undefined && metadata[key] !== null && String(metadata[key]).trim())
    .slice(0, 6)
    .map((key) => `<span class="trait-chip">${escapeHtml(key)}: ${escapeHtml(metadata[key])}</span>`)
    .join("");
  const picked = String(state.selectedTokenId) === String(chog.tokenId);
  return `
    <article class="chog-card">
      <div class="chog-card-image">${image}</div>
      <div class="chog-card-body">
        <div class="chog-card-title-row"><div><h3>${escapeHtml(title)}</h3><div class="chog-token">Chog Genesis · #${escapeHtml(chog.tokenId)}</div></div><span class="tier-chip">${escapeHtml(metadata.Tier ?? "Common")}</span></div>
        <div class="dna-stats">
          <div class="dna-stat"><b>${stat(dna.stats,"hp")}</b><span>HP DNA</span></div>
          <div class="dna-stat"><b>${stat(dna.stats,"attack")}</b><span>ATK</span></div>
          <div class="dna-stat"><b>${stat(dna.stats,"defense")}</b><span>DEF</span></div>
          <div class="dna-stat"><b>${stat(dna.stats,"speed")}</b><span>SPD</span></div>
        </div>
        <div class="card-traits">${traits || '<span class="trait-chip">No traits returned</span>'}</div>
        <div class="ability-line"><strong>${escapeHtml(dna.abilitySet?.base?.name ?? "Focused Strike")} · ${escapeHtml(dna.abilitySet?.special?.name ?? "Special")}</strong>Battle kit derived from this Chog's current metadata.</div>
        <button class="select-chog" data-pick="${escapeHtml(chog.tokenId)}">${picked ? "✓ Selected as main Chog" : "Select as main Chog"}</button>
      </div>
    </article>`;
}
function renderChogs() {
  count.textContent = state.chogs.length ? String(state.chogs.length) : "0";
  grid.innerHTML = state.chogs.map(renderCard).join("");
  updateSelectedMain();
  if (!state.account) {
    empty.hidden = false;
    empty.textContent = "Connect your Monad wallet to load your Chog fighters.";
    subtitle.textContent = "Your wallet is not connected.";
  } else if (!state.chogs.length) {
    empty.hidden = false;
    empty.textContent = "No Chog Genesis NFTs were found. You can still browse your profile, but you'll need a real Chog to enter an official challenge.";
    subtitle.textContent = "No Chogs found for this wallet.";
  } else {
    empty.hidden = true;
    subtitle.textContent = `${state.chogs.length} Chog(s) found. Select your main fighter for challenges.`;
  }
}
async function refreshChogs() {
  if (!state.account || state.loading) return;
  state.loading = true;
  clearAlert();
  refreshButton.disabled = true;
  walletButton.disabled = true;
  empty.hidden = false;
  empty.textContent = "Reading your Chogs from Monad…";
  try {
    state.chogs = await getOwnedChogs(state.account);
    const stillOwnedSelection = state.chogs.find((chog) => String(chog.tokenId) === String(state.selectedTokenId));
    if (!stillOwnedSelection) {
      state.selectedTokenId = null;
      if (state.session?.discordId) localStorage.removeItem(`chog-main:${state.session.discordId}`);
    }
    renderChogs();
  } catch (error) {
    state.chogs = [];
    renderChogs();
    alertMessage(error?.message ?? "Could not load Chogs. Try refreshing.");
  } finally {
    state.loading = false;
    refreshButton.disabled = false;
    walletButton.disabled = false;
  }
}
async function requireDiscordSession() {
  const response = await fetch("/api/discord/session", { credentials: "same-origin", headers: { accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.authenticated) {
    window.location.replace("/");
    return false;
  }
  state.session = payload.user;
  state.account = state.session.walletAddress ?? null;
  state.selectedTokenId = localStorage.getItem(`chog-main:${state.session.discordId}`);
  $("#member-name").textContent = state.session.username;
  const avatar = $("#member-avatar");
  if (state.session.avatar) avatar.innerHTML = `<img src="${escapeHtml(state.session.avatar)}" alt="" />`;
  else avatar.textContent = (state.session.username || "C").slice(0, 1).toUpperCase();
  if (state.account) {
    walletButton.textContent = `${state.account.slice(0,6)}…${state.account.slice(-4)} ✓`;
    refreshButton.disabled = false;
  }
  return true;
}

document.addEventListener("click", async (event) => {
  const nav = event.target.closest("[data-panel]");
  if (nav) setPanel(nav.dataset.panel);
  const pick = event.target.closest("[data-pick]");
  if (pick) {
    const chog = state.chogs.find((item) => String(item.tokenId) === pick.dataset.pick);
    if (!chog) return;
    state.selectedTokenId = chog.tokenId;
    if (state.session?.discordId) localStorage.setItem(`chog-main:${state.session.discordId}`, String(chog.tokenId));
    saveSelectedFighter({
      source: "real",
      wallet: state.account?.toLowerCase(),
      contract: "0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763",
      tokenId: String(chog.tokenId),
      metadata: chog.metadata,
    });
    renderChogs();
    alertMessage(`${chog.metadata.name ?? `Chog #${chog.tokenId}`} is selected as your main Chog for challenges and practice.`);
  }
});
walletButton.addEventListener("click", async () => {
  walletButton.disabled = true;
  clearAlert();
  try {
    const address = await connectAndLinkWallet();
    state.account = address;
    if (state.session) state.session.walletAddress = address;
    walletButton.textContent = `${address.slice(0,6)}…${address.slice(-4)} ✓`;
    refreshButton.disabled = false;
    subtitle.textContent = "Wallet linked to your verified Discord identity. Loading your Chogs…";
    await refreshChogs();
  } catch (error) {
    if (error?.code === 4001) alertMessage("Wallet signature cancelled. Your wallet was not linked.");
    else alertMessage(error?.message ?? "Wallet linking failed. Please try again.");
  } finally {
    walletButton.disabled = false;
  }
});
refreshButton.addEventListener("click", refreshChogs);
$("#disconnect-discord").addEventListener("click", async () => {
  await fetch("/api/discord/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
  window.location.assign("/");
});

if (window.ethereum?.on) {
  window.ethereum.on("accountsChanged", (accounts) => {
    const nextAccount = accounts?.[0] ?? null;
    const linkedAccount = state.session?.walletAddress ?? null;
    if (linkedAccount && linkedAccount.toLowerCase() !== String(nextAccount || "").toLowerCase()) {
      state.account = null;
      alertMessage("Wallet account changed. Click Connect wallet and sign the wallet-link message before creating challenges.");
    } else {
      state.account = nextAccount;
    }
    state.chogs = [];
    renderChogs();
    walletButton.textContent = state.account ? `${state.account.slice(0,6)}…${state.account.slice(-4)} ✓` : "Connect wallet";
    refreshButton.disabled = !state.account;
    if (state.account) refreshChogs();
  });
  window.ethereum.on("chainChanged", () => {
    if (state.account) refreshChogs();
  });
}

walletButton.textContent = "Connect wallet";
refreshButton.disabled = true;
renderChogs();

async function loadInvites(view) {
  const target = view === "incoming" ? $("#incoming-invite-list") : $("#outgoing-invite-list");
  if (!target) return;
  target.innerHTML = '<div class="roster-empty">Loading invitations…</div>';
  try {
    const response = await fetch(`/api/invites?view=${encodeURIComponent(view)}`, {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Could not load invitations.");
    const invites = Array.isArray(payload.invites) ? payload.invites : [];
    if (view === "incoming") {
      $("#incoming-count").textContent = String(invites.filter((invite) => invite.status === "PENDING_ACCEPTANCE").length);
    }
    if (!invites.length) {
      target.innerHTML = '<div class="roster-empty">No invitations here yet.</div>';
      return;
    }
    target.innerHTML = invites.map((invite) => {
      const incoming = view === "incoming";
      const other = incoming ? invite.challenger : invite.opponent;
      const url = `/invite.html?id=${encodeURIComponent(invite.id)}`;
      const status = invite.status;
      const canRespond = incoming && status === "PENDING_ACCEPTANCE";
      const canCancel = !incoming && status === "PENDING_ACCEPTANCE";
      return `<article class="invite-list-item">
        <div>
          <h3>${incoming ? "Challenge from" : "Challenge to"} ${escapeHtml(other?.username || "Discord player")}</h3>
          <p>${escapeHtml(other?.tokenId ? `Chog #${other.tokenId}` : "Fighter not selected")} · ${escapeHtml(invite.condition)}</p>
          <div class="invite-list-meta"><span class="invite-state">${escapeHtml(status.replaceAll("_"," "))}</span><span class="invite-state">Expires ${escapeHtml(new Date(invite.expiresAt).toLocaleDateString())}</span></div>
        </div>
        <div class="invite-item-actions">
          <a class="invite-open-button" href="${url}">${canRespond ? "Review challenge" : "Open lobby"}</a>
          ${canCancel ? `<button class="copy-invite-link" data-cancel-invite="${escapeHtml(invite.id)}" type="button">Cancel</button><button class="copy-invite-link" data-copy-invite="${escapeHtml(invite.id)}" type="button">Copy invite link</button>` : ""}
        </div>
      </article>`;
    }).join("");
  } catch (error) {
    target.innerHTML = `<div class="roster-empty">${escapeHtml(error?.message || "Could not load invitations.")}</div>`;
  }
}

$("#go-to-chogs").addEventListener("click", () => setPanel("chogs"));
$("#create-invite-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = $("#create-invite-status");
  const resultNode = $("#created-invite-result");
  const button = $("#create-invite-button");
  resultNode.hidden = true;
  button.disabled = true;
  status.textContent = "Verifying your Chog and saving the invitation…";
  status.dataset.kind = "info";
  try {
    if (!state.account || !state.session?.walletAddress || state.account.toLowerCase() !== state.session.walletAddress.toLowerCase()) {
      throw new Error("Connect and sign your wallet-link message before creating a challenge.");
    }
    if (!state.selectedTokenId) throw new Error("Choose your main Chog in My Chogs first.");
    const response = await fetch("/api/invites", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        action: "create",
        opponentDiscordId: $("#opponent-discord-id").value.trim(),
        challengerTokenId: String(state.selectedTokenId),
        condition: $("#invite-condition").value,
        agreeToCondition: $("#invite-condition-agree").checked,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.inviteUrl) throw new Error(payload.error || "Invitation could not be created.");
    status.textContent = "Invitation saved. Send this link to the intended Discord user.";
    status.dataset.kind = "success";
    resultNode.innerHTML = `<strong>Challenge created · ${escapeHtml(payload.invite.status.replaceAll("_"," "))}</strong><a href="${escapeHtml(payload.inviteUrl)}">${escapeHtml(payload.inviteUrl)}</a><br /><button type="button" class="copy-invite-link" id="copy-created-invite">Copy invitation link</button> <a class="copy-invite-link" href="/invite.html?id=${encodeURIComponent(payload.invite.id)}">Open lobby</a>`;
    resultNode.hidden = false;
    $("#copy-created-invite").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(payload.inviteUrl);
        $("#copy-created-invite").textContent = "Copied";
      } catch {
        status.textContent = "Copy was blocked. Select the invitation URL above and copy it manually.";
        status.dataset.kind = "error";
      }
    });
    loadInvites("outgoing");
  } catch (error) {
    status.textContent = error?.message || "Invitation could not be created.";
    status.dataset.kind = "error";
  } finally {
    button.disabled = false;
  }
});

document.addEventListener("click", async (event) => {
  const cancelButton = event.target.closest("[data-cancel-invite]");
  if (cancelButton) {
    cancelButton.disabled = true;
    try {
      const response = await fetch("/api/invites", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", accept: "application/json" },
        body: JSON.stringify({ action: "cancel", id: cancelButton.dataset.cancelInvite }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not cancel invitation.");
      loadInvites("outgoing");
    } catch (error) {
      alertMessage(error?.message || "Could not cancel invitation.");
      cancelButton.disabled = false;
    }
  }
  const copyButton = event.target.closest("[data-copy-invite]");
  if (copyButton) {
    const url = new URL(`/invite.html?id=${encodeURIComponent(copyButton.dataset.copyInvite)}`, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(url);
      copyButton.textContent = "Copied";
    } catch {
      alertMessage("Copy was blocked. Open the lobby link and copy it from the address bar.");
    }
  }
});

requireDiscordSession().then((ok) => {
  if (!ok) return;
  if (state.account) {
    refreshChogs();
  } else {
    subtitle.textContent = "Discord verified. Connect and sign your wallet to load your fighters.";
  }
  loadInvites("incoming");
}).catch(() => window.location.replace("/"));
