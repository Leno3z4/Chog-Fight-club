import "./auth.css";
import { buildRosterPreview } from "./nft/rosterPreview.js";
import { getOwnedChogs } from "./nft/chogNft.js";
import { connectAndLinkWallet } from "./walletLink.js";

const $ = (selector) => document.querySelector(selector);
const canvas = $("#solo-arena");
const ctx = canvas.getContext("2d");
const prototypes = {
  ember: { name: "Ember", metadata: { name: "Ember", Tier: "Rare", Aura: "Fire", Skin: "Red", Body: "Toad", Eyes: "Angry" }, color: "#ff8a35" },
  tide: { name: "Tide", metadata: { name: "Tide", Tier: "Uncommon", Aura: "Water", Skin: "Blue", Body: "Toad", Eyes: "Happy" }, color: "#49b9ff" },
  volt: { name: "Volt", metadata: { name: "Volt", Tier: "Epic", Aura: "Electric", Skin: "Yellow", Body: "Tuxedo", Eyes: "Angry" }, color: "#e8d84f" },
};
const botMetadata = { name: "Arena Bot", Tier: "Rare", Aura: "Shadow", Skin: "Purple", Body: "Toad", Eyes: "Angry" };
const botDNA = buildRosterPreview(botMetadata);
const state = {
  session: null,
  selected: null,
  isOwned: false,
  wallet: null,
  chogs: [],
  gameStatus: "IDLE",
  running: false,
  lastFrame: 0,
  keys: new Set(),
  pendingAction: null,
  log: [],
  player: null,
  bot: null,
  playerColor: "#ff8a35",
};
function statsFor(metadata) {
  const dna = buildRosterPreview(metadata || {});
  return {
    name: String(metadata?.name || metadata?.Name || "Chog"),
    tier: String(metadata?.Tier || "Common"),
    ability: dna.abilitySet.base.name,
    special: dna.abilitySet.special.name,
    hp: dna.stats.hp,
    maxHp: dna.stats.hp,
    attack: dna.stats.attack,
    defense: dna.stats.defense,
    speed: dna.stats.speed,
    x: 160, y: canvas.height / 2, flashUntil: 0,
    nextAttackAt: 0, nextSpecialAt: 0, nextDashAt: 0,
    color: "#a78bfa",
  };
}
function pushLog(text) {
  state.log.push({ text, at: Date.now() });
  if (state.log.length > 14) state.log.shift();
  $("#solo-battle-log").innerHTML = state.log.slice(-8).map((entry) => `<li>${escapeHtml(entry.text)}</li>`).join("");
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}
function setSelected(name, metadata, color, owned = false, tokenId = null) {
  const dna = statsFor(metadata);
  dna.name = name || dna.name;
  dna.color = color || "#a78bfa";
  dna.tokenId = tokenId;
  state.selected = { name: dna.name, metadata: metadata || {}, dna };
  state.isOwned = owned;
  state.playerColor = dna.color;
  document.querySelectorAll("[data-prototype]").forEach((button) => button.classList.toggle("selected", !owned && button.dataset.prototype === Object.keys(prototypes).find((key) => prototypes[key].name === dna.name)));
  document.querySelectorAll("[data-owned-chog]").forEach((button) => button.classList.toggle("selected", owned && button.dataset.ownedChog === String(tokenId)));
  renderStats();
  if (state.running) startGame();
  draw();
}
function renderStats() {
  const dna = state.selected?.dna;
  if (!dna) return;
  $("#player-label").textContent = state.selected.name;
  $("#solo-stats").innerHTML = `
    <div><span>HP</span><strong>${Math.round(dna.hp)}</strong></div>
    <div><span>ATK</span><strong>${Math.round(dna.attack)}</strong></div>
    <div><span>DEF</span><strong>${Math.round(dna.defense)}</strong></div>
    <div><span>SPD</span><strong>${Math.round(dna.speed)}</strong></div>
    <p>${escapeHtml(dna.tier)} · ${escapeHtml(dna.ability)} · Special: ${escapeHtml(dna.special)}</p>`;
}
function startGame() {
  if (!state.selected) return;
  state.player = { ...structuredClone(state.selected.dna), x: 165, y: canvas.height / 2, color: state.playerColor, flashUntil: 0, nextAttackAt: 0, nextSpecialAt: 0, nextDashAt: 0 };
  state.bot = {
    ...statsFor(botMetadata), x: canvas.width - 165, y: canvas.height / 2,
    color: "#ff9c5c", nextAttackAt: Date.now() + 800, nextSpecialAt: Date.now() + 2400,
  };
  state.log = [];
  state.gameStatus = "LIVE";
  state.running = true;
  state.lastFrame = performance.now();
  pushLog(`Practice started. ${state.player.name} vs Arena Bot.`);
  $("#solo-status").textContent = "FIGHT!";
  $("#solo-substatus").textContent = "Real-time practice · no NFT or Pact is minted";
  $("#start-practice").textContent = "Restart practice ↗";
  draw();
}
function normalize(x, y) {
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}
function distance(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function moveCharacter(person, x, y, dt) {
  const direction = normalize(x, y);
  const speed = 155 + Number(person.speed || 14) * 2.5;
  person.x = clamp(person.x + direction.x * speed * dt, 48, canvas.width - 48);
  person.y = clamp(person.y + direction.y * speed * dt, 76, canvas.height - 48);
}
function damage(attacker, target, special = false) {
  const now = Date.now();
  const dist = distance(attacker, target);
  if (special) {
    if (now < attacker.nextSpecialAt) return;
    attacker.nextSpecialAt = now + 1650;
  } else {
    if (now < attacker.nextAttackAt) return;
    attacker.nextAttackAt = now + 420;
  }
  attacker.flashUntil = now + 140;
  const range = special ? 130 : 88;
  if (dist > range) {
    if (attacker === state.player) pushLog(special ? "Your special missed." : "Your attack missed.");
    return;
  }
  const raw = special ? Number(attacker.attack) * 1.08 : Number(attacker.attack) * 0.62;
  const strike = Math.floor(Math.random() * 6) - 2;
  const dealt = Math.max(4, Math.round(raw - Number(target.defense) * 0.16 + strike));
  target.hp = Math.max(0, target.hp - dealt);
  target.flashUntil = now + 220;
  if (attacker === state.player) pushLog(`${special ? attacker.special : "Strike"} hit for ${dealt} damage.`);
  else pushLog(`Arena Bot hit you for ${dealt} damage.`);
  if (target.hp === 0) {
    state.running = false;
    state.gameStatus = attacker === state.player ? "WON" : "LOST";
    $("#solo-status").textContent = state.gameStatus === "WON" ? "VICTORY" : "DEFEAT";
    $("#solo-substatus").textContent = state.gameStatus === "WON" ? "You beat the bot. Run it back or test another fighter." : "The bot won this time. Change your timing or try another fighter.";
    pushLog(state.gameStatus === "WON" ? "You won the practice match." : "Arena Bot won the practice match.");
  }
}
function dash(person, x, y) {
  const now = Date.now();
  if (now < person.nextDashAt) return;
  person.nextDashAt = now + 1100;
  let dx = x; let dy = y;
  if (!dx && !dy) dx = person === state.player ? 1 : -1;
  const d = normalize(dx, dy);
  person.x = clamp(person.x + d.x * 80, 48, canvas.width - 48);
  person.y = clamp(person.y + d.y * 80, 76, canvas.height - 48);
  person.flashUntil = now + 160;
}
function update(dt) {
  if (!state.running || !state.player || !state.bot) return;
  let x = 0; let y = 0;
  if (state.keys.has("a") || state.keys.has("arrowleft") || state.keys.has("left")) x -= 1;
  if (state.keys.has("d") || state.keys.has("arrowright") || state.keys.has("right")) x += 1;
  if (state.keys.has("w") || state.keys.has("arrowup") || state.keys.has("up")) y -= 1;
  if (state.keys.has("s") || state.keys.has("arrowdown") || state.keys.has("down")) y += 1;
  if (x || y) moveCharacter(state.player, x, y, dt);
  if (state.pendingAction === "attack") damage(state.player, state.bot);
  else if (state.pendingAction === "special") damage(state.player, state.bot, true);
  else if (state.pendingAction === "dash") dash(state.player, x, y);
  state.pendingAction = null;

  if (!state.running) return;
  const dx = state.player.x - state.bot.x;
  const dy = state.player.y - state.bot.y;
  const dist = Math.hypot(dx, dy);
  if (dist > 72) moveCharacter(state.bot, dx, dy, dt);
  if (dist < 100 && Date.now() >= state.bot.nextAttackAt) damage(state.bot, state.player);
  if (dist < 128 && dist > 84 && Date.now() >= state.bot.nextSpecialAt) damage(state.bot, state.player, true);
}
function drawFighter(person, color) {
  if (!person) return;
  const p = person;
  ctx.save();
  const now = Date.now();
  ctx.fillStyle = p.flashUntil > now ? "#fff0a4" : color;
  ctx.shadowColor = color;
  ctx.shadowBlur = p.flashUntil > now ? 26 : 12;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 23, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#160e22";
  ctx.beginPath(); ctx.arc(p.x - 7, p.y - 4, 4, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(p.x + 7, p.y - 4, 4, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.78)"; ctx.lineWidth = 2; ctx.stroke();
  ctx.restore();
  ctx.textAlign = "center";
  ctx.fillStyle = "#fff";
  ctx.font = "800 13px system-ui";
  ctx.fillText(p.name, p.x, p.y - 37);
  const hpWidth = 80;
  ctx.fillStyle = "rgba(0,0,0,.5)";
  ctx.fillRect(p.x - hpWidth / 2, p.y + 32, hpWidth, 7);
  ctx.fillStyle = p.hp / Math.max(1, p.maxHp) < .3 ? "#ff655e" : color;
  ctx.fillRect(p.x - hpWidth / 2, p.y + 32, hpWidth * (p.hp / Math.max(1, p.maxHp)), 7);
}
function draw() {
  const width = canvas.width;
  const height = canvas.height;
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, "#160c2d");
  bg.addColorStop(1, "#091b2b");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(179,156,255,.12)";
  ctx.lineWidth = 1;
  for (let x = 20; x < width; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
  for (let y = 20; y < height; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
  ctx.strokeStyle = "rgba(255,214,75,.55)";
  ctx.lineWidth = 3;
  ctx.strokeRect(18, 18, width - 36, height - 36);
  ctx.setLineDash([8, 10]);
  ctx.beginPath(); ctx.moveTo(width / 2, 30); ctx.lineTo(width / 2, height - 30); ctx.stroke();
  ctx.setLineDash([]);
  if (!state.player || !state.bot) {
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffe58a";
    ctx.font = "900 30px system-ui";
    ctx.fillText("CHOOSE YOUR FIGHTER", width / 2, height / 2 - 6);
    ctx.fillStyle = "#d1c3ed";
    ctx.font = "16px system-ui";
    ctx.fillText("Prototype mode is ready. No Chog NFT is required.", width / 2, height / 2 + 26);
  } else {
    drawFighter(state.player, state.player.color || state.playerColor);
    drawFighter(state.bot, "#ff9c5c");
    if (!state.running) {
      ctx.fillStyle = "rgba(4,7,17,.8)";
      ctx.fillRect(0, height / 2 - 42, width, 84);
      ctx.textAlign = "center";
      ctx.fillStyle = "#ffe58a";
      ctx.font = "900 32px system-ui";
      ctx.fillText(state.gameStatus === "WON" ? "VICTORY" : state.gameStatus === "LOST" ? "DEFEAT" : "READY", width / 2, height / 2 + 10);
    }
  }
  if (state.player) {
    $("#player-hp-text").textContent = `${Math.ceil(state.player.hp)} / ${Math.ceil(state.player.maxHp)} HP`;
    $("#player-hp-bar").style.width = `${Math.max(0, state.player.hp / state.player.maxHp * 100)}%`;
  }
  if (state.bot) {
    $("#bot-hp-text").textContent = `${Math.ceil(state.bot.hp)} / ${Math.ceil(state.bot.maxHp)} HP`;
    $("#bot-hp-bar").style.width = `${Math.max(0, state.bot.hp / state.bot.maxHp * 100)}%`;
  }
}
function frame(now) {
  const dt = clamp((now - (state.lastFrame || now)) / 1000, 0, 0.035);
  state.lastFrame = now;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}
function isTextTarget(target) {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}
document.addEventListener("keydown", (event) => {
  if (isTextTarget(event.target)) return;
  const key = event.key.toLowerCase();
  if (!["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " ", "shift", "e"].includes(key)) return;
  event.preventDefault();
  const wasDown = state.keys.has(key);
  state.keys.add(key);
  if (wasDown || !state.running) return;
  if (key === " ") state.pendingAction = "attack";
  if (key === "e") state.pendingAction = "special";
  if (key === "shift") state.pendingAction = "dash";
});
document.addEventListener("keyup", (event) => state.keys.delete(event.key.toLowerCase()));
window.addEventListener("blur", () => state.keys.clear());

document.querySelectorAll("[data-prototype]").forEach((button) => {
  button.addEventListener("click", () => {
    const proto = prototypes[button.dataset.prototype];
    if (proto) setSelected(proto.name, proto.metadata, proto.color, false, null);
  });
});
$("#start-practice").addEventListener("click", startGame);
$("#restart-practice").addEventListener("click", startGame);

$("#load-owned-chogs").addEventListener("click", async () => {
  const button = $("#load-owned-chogs");
  button.disabled = true;
  button.textContent = "Loading Chogs…";
  try {
    state.wallet = await connectAndLinkWallet();
    if (state.session) state.session.walletAddress = state.wallet;
    state.chogs = await getOwnedChogs(state.wallet);
    const target = $("#owned-chog-roster");
    if (!state.chogs.length) {
      target.hidden = false;
      target.innerHTML = '<p class="lobby-note">No Chog Genesis NFTs found in this wallet. Choose a prototype instead.</p>';
      return;
    }
    target.hidden = false;
    target.innerHTML = state.chogs.map((chog) => {
      const meta = chog.metadata || {};
      const preview = buildRosterPreview(meta);
      return `<button class="prototype-card" type="button" data-owned-chog="${escapeHtml(chog.tokenId)}">
        <span class="prototype-swatch owned"></span>
        <span><strong>${escapeHtml(meta.name || `Chog #${chog.tokenId}`)}</strong><small>${escapeHtml(meta.Tier || "Common")} · Chog #${escapeHtml(chog.tokenId)} · ATK ${Math.round(preview.stats.attack)}</small></span>
        <b>SELECT</b>
      </button>`;
    }).join("");
    target.querySelectorAll("[data-owned-chog]").forEach((item) => item.addEventListener("click", () => {
      const chog = state.chogs.find((value) => String(value.tokenId) === item.dataset.ownedChog);
      if (!chog) return;
      const colorBySkin = { Red: "#ff8a35", Blue: "#49b9ff", Green: "#70df91", Pink: "#ff8db7", Yellow: "#e8d84f" };
      setSelected(chog.metadata?.name || `Chog #${chog.tokenId}`, chog.metadata || {}, colorBySkin[chog.metadata?.Skin] || "#a78bfa", true, chog.tokenId);
    }));
  } catch (error) {
    $("#solo-status").textContent = error?.message || "Could not load your Chogs.";
  } finally {
    button.disabled = false;
    button.textContent = "Load my Chogs";
  }
});

function setMobileKey(button, key) {
  const press = (event) => { event.preventDefault(); state.keys.add(key); };
  const release = (event) => { event.preventDefault(); state.keys.delete(key); };
  button.addEventListener("pointerdown", press);
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("pointerleave", release);
}
document.querySelectorAll("[data-solo-key]").forEach((button) => setMobileKey(button, button.dataset.soloKey));
document.querySelectorAll("[data-solo-action]").forEach((button) => {
  button.addEventListener("click", () => { if (state.running) state.pendingAction = button.dataset.soloAction; });
});
async function init() {
  try {
    const response = await fetch("/api/discord/session", { credentials: "same-origin", headers: { accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (!payload.authenticated) {
      window.location.replace("/");
      return;
    }
    state.session = payload.user;
  } catch {
    window.location.replace("/");
    return;
  }
  setSelected(prototypes.ember.name, prototypes.ember.metadata, prototypes.ember.color, false, null);
  requestAnimationFrame(frame);
}
init();
