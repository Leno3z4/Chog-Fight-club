import "./auth.css";
import { buildRosterPreview } from "./nft/rosterPreview.js";
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
const state = { session: null, account: null, chogs: [], loading: false, selectedTokenId: null, selectedOpponent: null };
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
  const dna = buildRosterPreview(metadata);
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
        <div class="ability-line"><strong>${escapeHtml(dna.abilitySet?.base?.name ?? "Focused Strike")} · ${escapeHtml(dna.abilitySet?.special?.name ?? "Special")}</strong>Website preview only. Final combat balance is being developed separately.</div>
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
  state.account = null;
  state.selectedTokenId = localStorage.getItem(`chog-main:${state.session.discordId}`);
  $("#member-name").textContent = state.session.username;
  const accessLabel = state.session.isAdmin ? "OWNER ACCESS" : "HOLDER ACCESS";
  const accessBadge = $("#member-access-label");
  const accessStatus = $("#member-access-status");
  if (accessBadge) accessBadge.textContent = accessLabel;
  if (accessStatus) accessStatus.textContent = state.session.isAdmin ? "Owner access" : "Holder verified";
  const avatar = $("#member-avatar");
  if (state.session.avatar) avatar.innerHTML = `<img src="${escapeHtml(state.session.avatar)}" alt="" />`;
  else avatar.textContent = (state.session.username || "C").slice(0, 1).toUpperCase();
  if (state.session.walletAddress) {
    walletButton.textContent = `Verify wallet ${state.session.walletAddress.slice(0,6)}…${state.session.walletAddress.slice(-4)}`;
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
      const status = invite.status;
      const accepted = ["TERMS_ACCEPTED", "READY", "IN_BATTLE", "RESULT_PENDING", "SETTLED", "CONDITION_PENDING", "CONDITION_FULFILLED"].includes(status);
      const url = `${accepted || !incoming ? "/battle-lobby.html" : "/invite.html"}?id=${encodeURIComponent(invite.id)}`;
      const canRespond = incoming && status === "PENDING_ACCEPTANCE";
      const canCancel = !incoming && status === "PENDING_ACCEPTANCE";
      return `<article class="invite-list-item">
        <div>
          <h3>${incoming ? "Challenge from" : "Challenge to"} ${escapeHtml(other?.username || "Discord player")}</h3>
          <p>${escapeHtml(other?.tokenId ? `Chog #${other.tokenId}` : "Fighter not selected")} · ${escapeHtml(invite.condition)}</p>
          <div class="invite-list-meta"><span class="invite-state">${escapeHtml(status.replaceAll("_"," "))}</span><span class="invite-state">Expires ${escapeHtml(invite.expiresAt ? new Date(invite.expiresAt).toLocaleDateString() : "No expiry")}</span></div>
        </div>
        <div class="invite-item-actions">
          <a class="invite-open-button" href="${url}">${canRespond ? "Join lobby" : accepted ? "Join lobby" : incoming ? "Review challenge" : "Wait in lobby"}</a>
          ${canCancel ? `<button class="copy-invite-link" data-cancel-invite="${escapeHtml(invite.id)}" type="button">Cancel</button><button class="copy-invite-link" data-copy-invite="${escapeHtml(invite.id)}" type="button">Copy invite link</button>` : ""}
        </div>
      </article>`;
    }).join("");
  } catch (error) {
    target.innerHTML = `<div class="roster-empty">${escapeHtml(error?.message || "Could not load invitations.")}</div>`;
  }
}

const opponentSearch = $("#opponent-search");
const opponentIdInput = $("#opponent-discord-id");
const opponentUsernameTarget = $("#opponent-username-target");
const opponentResults = $("#opponent-search-results");
const opponentSelected = $("#opponent-selected");
let playerSearchTimer = null;
let playerSearchSequence = 0;

function chooseOpponent(player) {
  state.selectedOpponent = player;
  opponentIdInput.value = player.discordId || "";
  opponentUsernameTarget.value = player.username;
  opponentSearch.value = `@${player.username}`;
  opponentResults.hidden = true;
  opponentSelected.textContent = player.unregistered
    ? `Invite @${player.username}. They can claim it after signing in with that exact Discord username.`
    : `Selected: ${player.displayName} (@${player.username})`;
  opponentSelected.dataset.kind = "success";
}

async function searchArenaPlayers(query, sequence) {
  if (!opponentResults) return;
  if (query.length < 2) {
    opponentResults.hidden = true;
    opponentResults.innerHTML = "";
    return;
  }
  opponentResults.hidden = false;
  opponentResults.innerHTML = '<div class="player-search-empty">Searching players…</div>';
  try {
    const response = await fetch(`/api/players?q=${encodeURIComponent(query)}`, {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    const payload = await response.json().catch(() => ({}));
    if (sequence !== playerSearchSequence) return;
    if (!response.ok) throw new Error(payload.error || "Player search failed.");
    const players = Array.isArray(payload.players) ? payload.players : [];
    if (!players.length) {
      const handle = query.replace(/^@/, "").toLowerCase();
      const validHandle = /^[a-z0-9][a-z0-9._]{0,30}[a-z0-9_]$/.test(handle);
      opponentResults.innerHTML = '<div class="player-search-empty">No matching Arena account found.</div>' + (validHandle
        ? `<button type="button" class="player-search-option player-search-invite-handle" data-invite-username="${escapeHtml(handle)}"><span class="player-search-avatar">@</span><span class="player-search-name"><strong>Invite @${escapeHtml(handle)}</strong><small>They can claim this invite after signing in with that username.</small></span><span class="player-search-select">Invite</span></button>`
        : '<div class="player-search-empty">To invite someone who has not joined yet, enter their exact Discord username (not their display name).</div>');
      return;
    }
    opponentResults.innerHTML = players.map((player) => `
      <button type="button" role="option" class="player-search-option" data-select-player="true"
        data-player-id="${escapeHtml(player.discordId)}"
        data-player-username="${escapeHtml(player.username)}"
        data-player-display="${escapeHtml(player.displayName)}"
        data-player-avatar="${escapeHtml(player.avatar || "")}">
        <span class="player-search-avatar">${player.avatar ? `<img src="${escapeHtml(player.avatar)}" alt="" />` : escapeHtml((player.displayName || player.username || "P").slice(0,1).toUpperCase())}</span>
        <span class="player-search-name"><strong>${escapeHtml(player.displayName || player.username)}</strong><small>@${escapeHtml(player.username)}</small></span>
        <span class="player-search-select">Select</span>
      </button>`).join("");
  } catch (error) {
    if (sequence !== playerSearchSequence) return;
    opponentResults.innerHTML = `<div class="player-search-empty">${escapeHtml(error?.message || "Player search failed.")}</div>`;
  }
}

opponentSearch.addEventListener("input", () => {
  state.selectedOpponent = null;
  opponentIdInput.value = "";
  opponentUsernameTarget.value = "";
  opponentSelected.textContent = "Choose a player from the results.";
  opponentSelected.dataset.kind = "";
  if (playerSearchTimer) window.clearTimeout(playerSearchTimer);
  const query = opponentSearch.value.trim().replace(/^@/, "");
  const sequence = ++playerSearchSequence;
  playerSearchTimer = window.setTimeout(() => searchArenaPlayers(query, sequence), 250);
});

opponentResults.addEventListener("click", (event) => {
  const inviteHandle = event.target.closest("[data-invite-username]");
  if (inviteHandle) {
    chooseOpponent({
      discordId: "",
      username: inviteHandle.dataset.inviteUsername,
      displayName: `@${inviteHandle.dataset.inviteUsername}`,
      unregistered: true,
    });
    return;
  }
  const option = event.target.closest("[data-select-player]");
  if (!option) return;
  chooseOpponent({
    discordId: option.dataset.playerId,
    username: option.dataset.playerUsername,
    displayName: option.dataset.playerDisplay,
    avatar: option.dataset.playerAvatar || null,
  });
});

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
    if (!state.selectedOpponent || !opponentUsernameTarget.value || (!opponentIdInput.value && !state.selectedOpponent.unregistered)) {
      throw new Error("Search for a player and select them from the results first.");
    }
    const response = await fetch("/api/invites", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        action: "create",
        opponentDiscordId: opponentIdInput.value,
        opponentUsername: opponentUsernameTarget.value,
        challengerTokenId: String(state.selectedTokenId),
        condition: $("#invite-condition").value,
        agreeToCondition: $("#invite-condition-agree").checked,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.inviteUrl) throw new Error(payload.error || "Invitation could not be created.");
    status.textContent = `Invitation saved for @${state.selectedOpponent?.username || "your opponent"}.`;
    status.dataset.kind = "success";
    resultNode.innerHTML = `<strong>Challenge created · ${escapeHtml(payload.invite.status.replaceAll("_"," "))}</strong><a href="${escapeHtml(payload.inviteUrl)}">${escapeHtml(payload.inviteUrl)}</a><br /><button type="button" class="copy-invite-link" id="copy-created-invite">Copy invitation link</button> <a class="copy-invite-link" href="/battle-lobby.html?id=${encodeURIComponent(payload.invite.id)}">Wait in lobby</a>`;
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
    opponentSearch.value = "";
    opponentIdInput.value = "";
    opponentUsernameTarget.value = "";
    opponentResults.hidden = true;
    state.selectedOpponent = null;
    opponentSelected.textContent = "Choose another player to send a challenge.";
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

const joinNotice = $("#lobby-join-notice");
const notifiedJoinIds = new Set();
function showLobbyJoinNotice(invite) {
  if (!joinNotice || !invite?.id) return;
  const link = `/battle-lobby.html?id=${encodeURIComponent(invite.id)}`;
  $("#lobby-join-title").textContent = `@${invite.opponent?.username || "Your rival"} joined your lobby`;
  $("#lobby-join-copy").textContent = "They accepted the challenge. Open the shared room to agree on both demands.";
  $("#lobby-join-link").href = link;
  joinNotice.hidden = false;
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      const notification = new Notification("Chog Battle Arena", {
        body: `@${invite.opponent?.username || "Your rival"} joined your challenge lobby.`,
        tag: `chog-join-${invite.id}`,
      });
      notification.onclick = () => window.location.assign(link);
    } catch { /* the in-page notification remains available */ }
  }
}
async function pollLobbyJoins(initial = false) {
  try {
    const response = await fetch("/api/invites?view=outgoing", { credentials: "same-origin", headers: { accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return;
    const rows = Array.isArray(payload.invites) ? payload.invites : [];
    let changed = false;
    for (const invite of rows) {
      const joined = ["TERMS_ACCEPTED", "READY", "IN_BATTLE", "RESULT_PENDING", "SETTLED", "CONDITION_PENDING", "CONDITION_FULFILLED"].includes(invite.status);
      const previous = window.sessionStorage.getItem(`chog-invite-status-${invite.id}`);
      if (joined && !notifiedJoinIds.has(invite.id)) {
        const alreadySeen = window.sessionStorage.getItem(`chog-join-seen-${invite.id}`) === "1";
        if (!alreadySeen && (initial || previous === "PENDING_ACCEPTANCE")) showLobbyJoinNotice(invite);
        notifiedJoinIds.add(invite.id);
      }
      if (previous && previous !== invite.status) changed = true;
      window.sessionStorage.setItem(`chog-invite-status-${invite.id}`, invite.status);
    }
    if (changed) loadInvites("outgoing");
  } catch {
    // The notification poll is best-effort; manual refresh remains available.
  }
}
$("#dismiss-lobby-notice")?.addEventListener("click", () => {
  const link = $("#lobby-join-link")?.href || "";
  const id = new URL(link).searchParams.get("id");
  if (id) window.sessionStorage.setItem(`chog-join-seen-${id}`, "1");
  if (joinNotice) joinNotice.hidden = true;
});
$("#lobby-join-link")?.addEventListener("click", () => {
  try {
    const id = new URL($("#lobby-join-link").href).searchParams.get("id");
    if (id) window.sessionStorage.setItem(`chog-join-seen-${id}`, "1");
  } catch {}
});

requireDiscordSession().then(async (ok) => {
  if (!ok) return;
  const requestedPanel = new URLSearchParams(window.location.search).get("panel");
  if (panels.includes(requestedPanel)) setPanel(requestedPanel);
  await fetch("/api/players", { method: "POST", credentials: "same-origin", headers: { accept: "application/json" } }).catch(() => {});
  const linked = state.session?.walletAddress;
  let walletReady = false;
  if (linked && window.ethereum?.request) {
    try {
      const [accounts, chainId] = await Promise.all([
        window.ethereum.request({ method: "eth_accounts" }),
        window.ethereum.request({ method: "eth_chainId" }),
      ]);
      if (accounts?.[0]?.toLowerCase() === linked.toLowerCase() && String(chainId).toLowerCase() === "0x8f") {
        state.account = linked;
        walletButton.textContent = `${linked.slice(0,6)}…${linked.slice(-4)} ✓`;
        refreshButton.disabled = false;
        walletReady = true;
      }
    } catch {
      walletReady = false;
    }
  }
  if (walletReady) refreshChogs();
  else subtitle.textContent = linked
    ? "Discord verified. Reconnect the linked wallet on Monad to load your fighters."
    : "Discord verified. Connect and sign your wallet to load your fighters.";
  loadInvites("incoming");
  await pollLobbyJoins(true);
  window.setInterval(() => pollLobbyJoins(false), 3500);
}).catch(() => window.location.replace("/"));
