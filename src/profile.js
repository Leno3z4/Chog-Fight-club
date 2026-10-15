import "./auth.css";
import { buildBattleDNA } from "./game/battleDNA.js";
import { connectWallet, getOwnedChogs, saveSelectedFighter } from "./nft/chogNft.js";

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
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}
function stat(stats, key) { return Math.round(Number(stats?.[key] ?? 0)); }

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
    if (!stillOwnedSelection) state.selectedTokenId = null;
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
  $("#member-name").textContent = state.session.username;
  const avatar = $("#member-avatar");
  if (state.session.avatar) avatar.innerHTML = `<img src="${escapeHtml(state.session.avatar)}" alt="" />`;
  else avatar.textContent = (state.session.username || "C").slice(0, 1).toUpperCase();
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
    saveSelectedFighter({
      source: "real",
      wallet: state.account?.toLowerCase(),
      contract: "0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763",
      tokenId: String(chog.tokenId),
      metadata: chog.metadata,
    });
    renderChogs();
    alertMessage(`${chog.metadata.name ?? `Chog #${chog.tokenId}`} is selected as your main practice fighter. Official challenges will recheck ownership when the lobby is implemented.`);
  }
});
walletButton.addEventListener("click", async () => {
  try {
    state.account = await connectWallet();
    walletButton.textContent = `${state.account.slice(0,6)}…${state.account.slice(-4)}`;
    walletButton.disabled = true;
    await refreshChogs();
  } catch (error) {
    alertMessage(error?.message ?? "Wallet connection failed.");
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
    state.account = accounts?.[0] ?? null;
    state.chogs = [];
    state.selectedTokenId = null;
    walletButton.textContent = state.account ? `${state.account.slice(0,6)}…${state.account.slice(-4)}` : "Connect wallet";
    refreshButton.disabled = !state.account;
    renderChogs();
    if (state.account) refreshChogs();
  });
  window.ethereum.on("chainChanged", () => {
    if (state.account) refreshChogs();
  });
}

document.querySelectorAll("[data-panel]").forEach((button) => button.addEventListener("click", () => setPanel(button.dataset.panel)));
walletButton.textContent = "Connect wallet";
refreshButton.disabled = true;
renderChogs();
requireDiscordSession().then((ok) => {
  if (ok) {
    // Keep wallet optional until the member chooses to view their fighters.
    subtitle.textContent = "Discord verified. Connect a wallet to load your fighters.";
  }
}).catch(() => window.location.replace("/"));
