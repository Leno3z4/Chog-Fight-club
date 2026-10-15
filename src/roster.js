import "./roster.css";
import { buildBattleDNA } from "./game/battleDNA.js";
import { connectWallet, getOwnedChogs, saveSelectedFighter } from "./nft/chogNft.js";

const $ = (selector) => document.querySelector(selector);
const connectButton = $("#connect-wallet");
const refreshButton = $("#refresh-chogs");
const statusNode = $("#wallet-status");
const emptyNode = $("#roster-empty");
const countNode = $("#roster-count");
const gridNode = $("#chog-grid");
const prototypeGrid = $("#prototype-grid");

const state = { account: null, chogs: [], loading: false };

const PROTOTYPE_METADATA = {
  tokenId: "prototype-7",
  name: "Training Chog #7",
  Tier: "Rare",
  Base: "Origin",
  Form: "Chog",
  Skin: "Purple",
  Body: "Stripes",
  Eyes: "Angry",
  Head: "Wizard Hat",
  Aura: "Purple",
  Background: "Deep Purple",
  Mouth: "Smile",
  Side: "None",
  Naked: "No",
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function statValue(stats, key) {
  return Math.round(Number(stats?.[key] ?? 0));
}

function renderChogCard(chog, { prototype = false } = {}) {
  const metadata = chog.metadata;
  const dna = buildBattleDNA(metadata);
  const title = metadata.name ?? (prototype ? "Training Chog #7" : `Chog #${chog.tokenId}`);
  const tier = metadata.Tier ?? "Common";
  const tokenId = prototype ? "Local demo profile" : `Token ID #${chog.tokenId}`;
  const image = metadata.image
    ? `<img src="${escapeHtml(metadata.image)}" alt="${escapeHtml(title)}" loading="lazy" referrerpolicy="no-referrer" />`
    : `<div class="no-art" aria-label="Artwork unavailable">C</div>`;
  const traitKeys = ["Skin", "Base", "Form", "Body", "Eyes", "Head", "Aura", "Background", "Mouth", "Side"];
  const chips = traitKeys
    .filter((key) => metadata[key] !== undefined && metadata[key] !== null && String(metadata[key]).trim() !== "")
    .slice(0, 6)
    .map((key) => `<span class="trait-chip">${escapeHtml(key)}: ${escapeHtml(metadata[key])}</span>`)
    .join("");
  const ability = dna.abilitySet?.base?.name ?? "Focused Strike";
  const special = dna.abilitySet?.special?.name ?? "Special ability";
  const warning = chog.metadataError
    ? `<p class="metadata-warning">${escapeHtml(chog.metadataMessage || "Some metadata could not be loaded. Stats use safe defaults.")}</p>`
    : "";

  return `
    <article class="chog-card">
      <div class="chog-card-image">${image}</div>
      <div class="chog-card-body">
        <div class="chog-card-title-row">
          <div><h3>${escapeHtml(title)}</h3><div class="chog-token">${escapeHtml(tokenId)}</div></div>
          <span class="tier-chip">${escapeHtml(tier)}</span>
        </div>
        <div class="dna-stats" aria-label="Current Battle DNA preview stats">
          <div class="dna-stat"><b>${statValue(dna.stats, "hp")}</b><span>HP DNA</span></div>
          <div class="dna-stat"><b>${statValue(dna.stats, "attack")}</b><span>ATK</span></div>
          <div class="dna-stat"><b>${statValue(dna.stats, "defense")}</b><span>DEF</span></div>
          <div class="dna-stat"><b>${statValue(dna.stats, "speed")}</b><span>SPD</span></div>
        </div>
        <div class="card-traits">${chips || '<span class="trait-chip">No traits found</span>'}</div>
        <div class="ability-line"><strong>${escapeHtml(ability)} · ${escapeHtml(special)}</strong>Ability preview based on the metadata currently returned for this Chog.</div>
        ${warning}
        <button class="select-chog" data-select="${escapeHtml(prototype ? "prototype" : chog.tokenId)}" data-prototype="${prototype ? "true" : "false"}">${prototype ? "Use training fighter" : "Choose this Chog"}</button>
      </div>
    </article>
  `;
}

function setStatus(message, kind = "info") {
  statusNode.textContent = message;
  statusNode.dataset.kind = kind;
}

function renderRealChogs() {
  gridNode.innerHTML = state.chogs.map((chog) => renderChogCard(chog)).join("");
  countNode.textContent = state.chogs.length ? `${state.chogs.length} FOUND` : state.account ? "0 FOUND" : "—";
  emptyNode.hidden = state.chogs.length > 0;
  if (!state.chogs.length && state.account) {
    emptyNode.textContent = "No Chog Genesis NFTs were found for this wallet. You can still use the training fighter below.";
  }
}

function renderPrototype() {
  prototypeGrid.innerHTML = renderChogCard({ tokenId: "prototype-7", metadata: PROTOTYPE_METADATA }, { prototype: true });
}

function selectFighter(button) {
  const prototype = button.dataset.prototype === "true";
  if (prototype) {
    saveSelectedFighter({
      source: "prototype",
      wallet: state.account,
      contract: null,
      tokenId: null,
      metadata: PROTOTYPE_METADATA,
    });
  } else {
    const chog = state.chogs.find((item) => String(item.tokenId) === button.dataset.select);
    if (!chog || !state.account) {
      setStatus("Connect your wallet and reload the roster before selecting a real Chog.", "error");
      return;
    }
    saveSelectedFighter({
      source: "real",
      wallet: state.account.toLowerCase(),
      contract: "0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763",
      tokenId: String(chog.tokenId),
      metadata: chog.metadata,
    });
  }
  window.location.assign("/battle.html?mode=practice");
}

async function loadRoster() {
  if (!state.account || state.loading) return;
  state.loading = true;
  refreshButton.disabled = true;
  connectButton.disabled = true;
  setStatus("Reading Chog ownership and metadata from Monad…");
  emptyNode.hidden = false;
  emptyNode.textContent = "Loading your Chogs…";
  try {
    state.chogs = await getOwnedChogs(state.account);
    renderRealChogs();
    setStatus(`Connected ${state.account.slice(0, 6)}…${state.account.slice(-4)} · ${state.chogs.length} Chog(s) loaded.`, "success");
  } catch (error) {
    state.chogs = [];
    renderRealChogs();
    emptyNode.textContent = error?.message ?? "Could not load this wallet's Chogs. Try again or configure a server-side NFT indexer endpoint.";
    setStatus(error?.message ?? "Chog loading failed.", "error");
  } finally {
    state.loading = false;
    refreshButton.disabled = false;
    connectButton.disabled = false;
  }
}

connectButton.addEventListener("click", async () => {
  connectButton.disabled = true;
  try {
    state.account = await connectWallet();
    connectButton.textContent = `${state.account.slice(0, 6)}…${state.account.slice(-4)}`;
    refreshButton.disabled = false;
    await loadRoster();
  } catch (error) {
    setStatus(error?.message ?? "Wallet connection failed.", "error");
  } finally {
    connectButton.disabled = false;
  }
});

refreshButton.addEventListener("click", loadRoster);

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-select]");
  if (button) selectFighter(button);
});

if (window.ethereum?.on) {
  window.ethereum.on("accountsChanged", (accounts) => {
    state.account = accounts?.[0] ?? null;
    state.chogs = [];
    connectButton.textContent = state.account ? `${state.account.slice(0, 6)}…${state.account.slice(-4)}` : "Connect wallet";
    refreshButton.disabled = !state.account;
    renderRealChogs();
    if (state.account) loadRoster();
    else setStatus("Wallet disconnected.");
  });
  window.ethereum.on("chainChanged", () => {
    state.chogs = [];
    if (state.account) loadRoster();
  });
}

renderPrototype();
