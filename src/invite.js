import "./auth.css";
import { buildRosterPreview } from "./nft/rosterPreview.js";
import { getOwnedChogs } from "./nft/chogNft.js";
import { connectAndLinkWallet } from "./walletLink.js";
import { confirmPactFulfillment, mintPactAgreement, signPactAgreement } from "./pact.js";

const $ = (selector) => document.querySelector(selector);
const state = {
  id: new URLSearchParams(window.location.search).get("id"),
  session: null,
  wallet: null,
  chogs: [],
  selectedTokenId: null,
  invite: null,
  busy: false,
  battle: null,
  battleBusy: false,
  pact: null,
  pactBusy: false,
  realtimeSocket: null,
  realtimeState: null,
  realtimeTimer: null,
  realtimeConnecting: false,
  realtimeLastSync: 0,
  realtimeConfigAlertShown: false,
  keys: new Set(),
  pendingAction: null,
  basicTapPendingAt: null,
  basicTapWindowMs: 260,
};
let liveArena = null;
let liveArenaPromise = null;
let liveArenaFailed = false;
let latestLiveSnapshot = null;
const alertNode = $("#invite-page-alert");
const isBattleLobbyPage = window.location.pathname.endsWith("/battle-lobby.html");
const acceptedStatuses = ["TERMS_ACCEPTED", "READY", "IN_BATTLE", "ROUND_OVER", "RESULT_PENDING", "DISPUTED", "SETTLED", "CONDITION_PENDING", "CONDITION_FULFILLED"];
const PROTOTYPE_FIGHTERS = [
  { tokenId: "prototype:ember", metadata: { name: "Ember", Tier: "Rare", Aura: "Fire", Skin: "Red", Body: "Toad", Eyes: "Angry" } },
  { tokenId: "prototype:tide", metadata: { name: "Tide", Tier: "Uncommon", Aura: "Water", Skin: "Blue", Body: "Toad", Eyes: "Happy" } },
  { tokenId: "prototype:volt", metadata: { name: "Volt", Tier: "Epic", Aura: "Electric", Skin: "Yellow", Body: "Tuxedo", Eyes: "Angry" } },
];

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
  const roomUrl = new URL(`/battle-lobby.html?id=${encodeURIComponent(invite.id)}`, window.location.origin).toString();
  const roomPath = $("#battle-room-url");
  const roomCode = $("#battle-room-id");
  if (roomPath) roomPath.textContent = roomUrl;
  if (roomCode) roomCode.textContent = invite.id.slice(0, 8).toUpperCase();
  $("#invite-status-chip").textContent = statusText(invite.status);
  const practiceMode = invite.gameMode === "PRACTICE";
  const conditionNode = $("#invite-condition");
  if (conditionNode) conditionNode.textContent = practiceMode
    ? `${invite.condition} - PROTOTYPE PRACTICE: no Pact NFT or official result.`
    : invite.condition;
  const conditionNote = $("#invite-condition-note");
  if (conditionNote && practiceMode) conditionNote.textContent = "Prototype practice only. No NFT is transferred or minted and no official result is recorded. Both players still agree to voluntary, harmless demands.";
  const readyFooterNote = $("#ready-card-footer-note");
  if (readyFooterNote && practiceMode) readyFooterNote.textContent = "Prototype practice only: no Pact NFT will be minted and this match is not an official result.";
  const fighterPrompt = $("#fighter-prompt");
  if (fighterPrompt && practiceMode) fighterPrompt.textContent = "Choose Ember, Tide, or Volt. This practice room does not require a Chog NFT.";
  const walletButton = $("#link-wallet");
  if (walletButton && practiceMode && !state.wallet) walletButton.innerHTML = "Connect wallet to join practice <b>↗</b>";
  const pactCard = $("#pact-card");
  if (pactCard && practiceMode) pactCard.hidden = true;
  const conditionHashNode = $("#condition-hash");
  if (conditionHashNode) conditionHashNode.textContent = invite.termsHash || "Not available";
  const bilateralCard = $("#bilateral-terms-card");
  if (bilateralCard) {
    bilateralCard.hidden = !["TERMS_ACCEPTED", "READY"].includes(invite.status);
    $("#challenger-demand-text").textContent = invite.challengerDemand || invite.challenger?.demand || "Waiting for the challenger to write a demand…";
    $("#opponent-demand-text").textContent = invite.opponentDemand || invite.opponent?.demand || "Waiting for the opponent to write a demand…";
    $("#challenger-demand-acceptance").textContent = invite.challenger?.termsAccepted ? "Accepted ✓" : "Not accepted";
    $("#opponent-demand-acceptance").textContent = invite.opponent?.termsAccepted ? "Accepted ✓" : "Not accepted";
    $("#challenger-demand-acceptance").classList.toggle("accepted", Boolean(invite.challenger?.termsAccepted));
    $("#opponent-demand-acceptance").classList.toggle("accepted", Boolean(invite.opponent?.termsAccepted));
    const ownDemand = invite.viewerRole === "challenger" ? invite.challengerDemand : invite.opponentDemand;
    const ownDemandNode = $("#own-demand-text");
    if (ownDemandNode && document.activeElement !== ownDemandNode) ownDemandNode.value = ownDemand || "";
    updateBilateralControls();
  }
  const presenceNode = $("#room-presence-message");
  if (presenceNode) {
    presenceNode.textContent = invite.status === "PENDING_ACCEPTANCE"
      ? `Waiting for @${invite.opponent?.username || "your rival"} to join. Keep this lobby open; you'll be notified when they accept the invitation.`
      : invite.status === "TERMS_ACCEPTED"
        ? (practiceMode ? "Your rival joined. Write and accept both demands, then confirm readiness for prototype practice." : "Your rival joined the lobby. Write your demand and agree on both demands before minting the Pact NFT.")
        : ["READY", "IN_BATTLE", "RESULT_PENDING", "CONDITION_PENDING", "CONDITION_FULFILLED"].includes(invite.status)
          ? (practiceMode ? "Both players have joined. Confirm readiness and enter prototype practice." : "Both players have joined. Finish the agreement, mint the Pact, and enter the real-time arena.")
          : "This room stays available while you wait for the other player.";
  }
  const waitingCopy = $("#room-waiting-copy");
  if (waitingCopy) waitingCopy.textContent = invite.status === "PENDING_ACCEPTANCE"
    ? "You're in the room early. The invite stays open until the other player joins."
    : invite.status === "TERMS_ACCEPTED"
      ? (practiceMode ? "Your opponent is here. Save and accept both demands before confirming readiness." : "Your opponent is here. Your two demands must be saved and accepted before the match starts.")
      : (practiceMode ? "Once both players are ready, you will enter the same prototype arena." : "Once the Pact is minted and both players are ready, you will enter the same live arena.");
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
      ? `${invite.challenger.username || "A player"} challenged you. Join the lobby and choose a Chog; you will both write and accept the final demands there.`
      : `Challenge between ${invite.challenger.username || "the challenger"} and ${invite.opponent.username || "the opponent"}. Review the condition and status here.`;

  $("#accept-card").hidden = !(isRecipient && pending);
  $("#ready-card").hidden = invite.status !== "READY" || (!practiceMode && !state.pact?.minted);
  $("#cancel-invite").hidden = !(invite.viewerRole === "challenger" && pending);
  $("#accept-invite").disabled = !state.selectedTokenId || !$("#accept-condition-check").checked || !state.wallet;
  $("#ready-status-chip").textContent = invite.challenger.ready && invite.opponent.ready ? "BOTH READY" : "READY CHECK";
  $("#ready-button").disabled = invite.status !== "READY" || Boolean(viewer(invite).ready);
  $("#ready-button").textContent = viewer(invite).ready ? "You're ready ✓" : "I'm ready ↗";
  $("#ready-explanation").textContent = invite.challenger.ready && invite.opponent.ready
    ? "Both players are ready. Enter the live arena when your opponent is there."
    : `Your readiness: ${viewer(invite).ready ? "confirmed" : "not confirmed"}. Opponent readiness: ${opponent(invite).ready ? "confirmed" : "waiting"}.`;
  updateTimeline(invite);
}
function renderBattle(room, viewerRole = state.invite?.viewerRole) {
  if (!isBattleLobbyPage) return;
  state.realtimeState = room || null;
  const card = $("#combat-card");
  if (!card) return;
  const invite = state.invite;
  const phase = room?.phase || "LOBBY";
  const matchStatus = room?.status || "LOBBY";
  const players = room?.players || {};
  const relevant = Boolean(invite);
  const inviteAccepted = acceptedStatuses.includes(invite?.status);
  card.hidden = !relevant || !inviteAccepted;
  if (!relevant || !inviteAccepted) {
    drawRealtimeArena(room, viewerRole);
    return;
  }

  const bothReady = Boolean(invite.challenger?.ready && invite.opponent?.ready);
  const bothConnected = Boolean(players.challenger?.connected && players.opponent?.connected);
  const startButton = $("#combat-start");
  const pactSatisfied = invite.gameMode === "PRACTICE" || Boolean(state.pact?.minted);
  startButton.hidden = !(invite.status === "READY" && bothReady && bothConnected && pactSatisfied && !["IN_BATTLE", "ROUND_OVER"].includes(phase) && matchStatus !== "FINISHED");
  startButton.disabled = state.battleBusy || state.realtimeConnecting;
  startButton.textContent = state.battleBusy ? "Entering arena…" : "Enter live arena ↗";

  if (matchStatus === "FINISHED") {
    const won = room?.winnerRole === invite.viewerRole;
    const draw = Boolean(room?.matchDraw || !room?.winnerRole);
    $("#combat-status").textContent = draw ? "MATCH DRAW" : won ? "VICTORY" : "DEFEAT";
    $("#combat-message").textContent = room?.forfeitRole
      ? (room.forfeitRole === invite.viewerRole
        ? "You forfeited because you did not reconnect within 30 seconds."
        : `You won by forfeit because @${players[room.forfeitRole]?.username || "your opponent"} did not reconnect within 30 seconds.`)
      : draw
        ? "All three rounds are complete and the round score is tied. No winner was declared."
        : won
          ? "You won the three-round match. You can now settle the result and later confirm fulfilment of the agreement."
          : "You lost the three-round match. The declared winner can settle the result before the condition is fulfilled.";
  } else if (phase === "ROUND_OVER") {
    const wins = room?.roundWins || { challenger: 0, opponent: 0 };
    const result = room?.roundWinnerRole
      ? (room.roundWinnerRole === invite.viewerRole ? "YOU WIN" : "OPPONENT WINS")
      : "ROUND DRAW";
    $("#combat-status").textContent = room?.koRole ? "K.O.!" : "ROUND OVER";
    $("#combat-message").textContent = result + " · ROUND " + room.round + "/3 · SCORE "
      + (wins.challenger || 0) + "-" + (wins.opponent || 0) + " · NEXT ROUND IN A MOMENT";
  } else if (phase === "IN_BATTLE") {
    $("#combat-status").textContent = state.realtimeSocket?.readyState === WebSocket.OPEN ? "LIVE" : "RECONNECTING";
    const wins = room?.roundWins || { challenger: 0, opponent: 0 };
    const seconds = Math.ceil(Math.max(0, Number(room?.timeRemainingMs ?? 60000)) / 1000);
    $("#combat-message").textContent = "ROUND " + (room?.round || 1) + "/3 · "
      + String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0")
      + " · SCORE " + (wins.challenger || 0) + "-" + (wins.opponent || 0)
      + " · Punch: double-tap Space · Q: base projectile · E: special projectile · J: jump";
  } else if (invite.status === "PENDING_ACCEPTANCE") {
    $("#combat-status").textContent = "WAITING FOR RIVAL";
    $("#combat-message").textContent = `You are in the lobby. Waiting for @${invite.opponent?.username || "your rival"} to join.`;
  } else if (invite.status === "TERMS_ACCEPTED") {
    $("#combat-status").textContent = "AGREEMENT ROOM";
    $("#combat-message").textContent = "Your rival joined. Write a demand each, then both accept the exact pair before minting the Pact.";
  } else if (invite.status === "READY" && !state.pact?.minted && invite.gameMode !== "PRACTICE") {
    $("#combat-status").textContent = "PACT REQUIRED";
    $("#combat-message").textContent = "Both demands are accepted. Sign and mint the soulbound Pact NFT before entering combat.";
  } else if (invite.status === "READY" && !bothReady) {
    $("#combat-status").textContent = "READY CHECK";
    $("#combat-message").textContent = invite.gameMode === "PRACTICE"
      ? "Both demands are accepted. Both players need to confirm readiness before practice combat."
      : "The agreement is minted. Both players need to confirm readiness before entering the live arena.";
  } else if (invite.status === "READY" && bothReady && pactSatisfied && !bothConnected) {
    $("#combat-status").textContent = "WAITING FOR RIVAL";
    $("#combat-message").textContent = "Both players are ready, but one is not connected to the room yet. Keep this lobby open until both are online.";
  } else {
    $("#combat-status").textContent = "LOBBY";
    $("#combat-message").textContent = "Waiting for both players.";
  }

  const renderFighter = (role) => {
    const fighter = players[role] || {};
    const inviteFighter = role === "challenger" ? invite.challenger : invite.opponent;
    const tokenId = fighter.tokenId || inviteFighter?.tokenId;
    const hp = Math.max(0, Number(fighter.hp || 0));
    const maxHp = Math.max(1, Number(fighter.maxHp || 100));
    const percent = Math.max(0, Math.min(100, Math.round((hp / maxHp) * 100)));
    const username = fighter.username || inviteFighter?.username || (role === "challenger" ? "Challenger" : "Opponent");
    $(`#combat-${role}-name`).textContent = `${username}${tokenId ? ` · Chog #${tokenId}` : ""}`;
    $(`#combat-${role}-hp-text`).textContent = fighter.hp == null ? "Waiting" : `${hp} / ${maxHp} HP`;
    $(`#combat-${role}-hp-bar`).style.width = `${fighter.hp == null ? 0 : percent}%`;
    const energyValue = Math.max(0, Math.round(Number(fighter.energy ?? 0)));
    const maxEnergy = Math.max(1, Math.round(Number(fighter.maxEnergy ?? 100)));
    const energyPercent = Math.max(0, Math.min(100, Math.round((energyValue / maxEnergy) * 100)));
    const mpBar = document.getElementById("combat-" + role + "-mp-bar");
    if (mpBar) mpBar.style.width = (fighter.energy == null ? 0 : energyPercent) + "%";
    $(`#combat-${role}-dna`).textContent = fighter.tier
      ? `${fighter.fighterName || "Chog"} · ${fighter.tier} · ${fighter.ability || "Fighter"} · ATK ${fighter.attack || "n/a"} · DEF ${fighter.defense || "n/a"} · SPD ${fighter.speed || "n/a"}`
      : "Fighter stats load when the match begins";
    const connectionStatus = fighter.connected ? "Connected" : (phase === "IN_BATTLE" || phase === "ROUND_OVER" ? "Reconnecting…" : "In lobby");
    const energyText = fighter.energy == null ? connectionStatus : "MP " + energyValue + "/" + maxEnergy + " · " + connectionStatus;
    document.getElementById("combat-" + role + "-energy").textContent = energyText;
  };
  renderFighter("challenger");
  renderFighter("opponent");

  const activity = $("#combat-log");
  activity.innerHTML = (room?.log || []).slice(-18).map((entry) => `<li>${escapeHtml(entry.text || "Arena update")}</li>`).join("")
    || "<li>You're in the lobby. The match activity will appear here.</li>";
  drawRealtimeArena(room, viewerRole);

  if (room) {
    const invite = state.invite;
    state.battle = {
      status: matchStatus === "FINISHED" ? "FINISHED" : phase === "ROUND_OVER" ? "ROUND_OVER" : phase === "IN_BATTLE" ? "IN_BATTLE" : "WAITING_FOR_READY",
      inviteStatus: invite.status,
      youWon: room.winnerRole === invite.viewerRole,
      winnerDiscordId: room.winnerDiscordId || (room.winnerRole === "challenger" ? invite.challenger?.discordId : room.winnerRole === "opponent" ? invite.opponent?.discordId : null),
      forfeitRole: room.forfeitRole || null,
      challenger: {
        username: players.challenger?.username || invite.challenger?.username,
        tokenId: invite.challenger?.tokenId,
        hp: players.challenger?.hp,
        dna: players.challenger ? { name: invite.challenger?.username, tier: players.challenger.tier, ability: players.challenger.ability, stats: { maxHp: players.challenger.maxHp } } : null,
      },
      opponent: {
        username: players.opponent?.username || invite.opponent?.username,
        tokenId: invite.opponent?.tokenId,
        hp: players.opponent?.hp,
        dna: players.opponent ? { name: invite.opponent?.username, tier: players.opponent.tier, ability: players.opponent.ability, stats: { maxHp: players.opponent.maxHp } } : null,
      },
      log: room.log || [],
    };
    if (state.pact) renderPact(state.pact);
  }
}
function drawRealtimeArena(room, viewerRole) {
  const playfield = $("#arena-playfield");
  const container = $("#realtime-arena");
  if (!playfield || !container) return;
  const live = acceptedStatuses.includes(state.invite?.status)
    && (room?.status === "FINISHED" || (["IN_BATTLE", "ROUND_OVER"].includes(room?.phase) && room?.status === "IN_BATTLE"));
  if (!live) {
    latestLiveSnapshot = null;
    liveArenaFailed = false;
    playfield.hidden = true;
    if (liveArena) {
      liveArena.destroy();
      liveArena = null;
    }
    return;
  }
  playfield.hidden = false;
  latestLiveSnapshot = { room, viewerRole };
  if (liveArena) {
    liveArena.setState(room, viewerRole);
    return;
  }
  if (liveArenaPromise || liveArenaFailed) return;
  liveArenaPromise = import("./liveArena.js")
    .then(({ createLiveArena }) => {
      if (!latestLiveSnapshot) return null;
      liveArena = createLiveArena(container);
      liveArena.setState(latestLiveSnapshot.room, latestLiveSnapshot.viewerRole);
      return liveArena;
    })
    .catch(() => {
      liveArenaFailed = true;
      showAlert("The live arena could not load. Refresh this room after restoring the connection.");
    })
    .finally(() => { liveArenaPromise = null; });
}
function registerBasicTap(now = Date.now()) {
  if (state.basicTapPendingAt != null && now - state.basicTapPendingAt <= state.basicTapWindowMs) {
    state.basicTapPendingAt = null;
    state.pendingAction = "doubleAttack";
    return;
  }
  state.basicTapPendingAt = now;
}

function flushBasicTap(now = Date.now()) {
  if (state.basicTapPendingAt == null || now - state.basicTapPendingAt <= state.basicTapWindowMs) return;
  state.basicTapPendingAt = null;
  if (!state.pendingAction) state.pendingAction = "attack";
}

function paintInputFrame() {
  const socket = state.realtimeSocket;
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  const room = state.realtimeState;
  const inBattle = room?.status === "IN_BATTLE" && ["IN_BATTLE", "ROUND_OVER"].includes(room?.phase);
  if (!inBattle) {
    state.basicTapPendingAt = null;
    if (Date.now() - state.realtimeLastSync >= 500) {
      state.realtimeLastSync = Date.now();
      socket.send(JSON.stringify({ type: "sync" }));
    }
    return;
  }
  flushBasicTap();
  let x = 0; let y = 0;
  if (state.keys.has("a") || state.keys.has("arrowleft") || state.keys.has("left")) x -= 1;
  if (state.keys.has("d") || state.keys.has("arrowright") || state.keys.has("right")) x += 1;
  if (state.keys.has("w") || state.keys.has("arrowup") || state.keys.has("up")) y -= 1;
  if (state.keys.has("s") || state.keys.has("arrowdown") || state.keys.has("down")) y += 1;
  socket.send(JSON.stringify({ type: "input", x, y, action: state.pendingAction || undefined }));
  state.pendingAction = null;
}
async function connectRealtime() {
  if (!acceptedStatuses.includes(state.invite?.status)) {
    if (state.realtimeSocket) {
      try { state.realtimeSocket.close(1000, "Invitation not accepted"); } catch { /* connection already closed */ }
      state.realtimeSocket = null;
    }
    if (state.realtimeTimer) clearInterval(state.realtimeTimer);
    state.realtimeTimer = null;
    drawRealtimeArena(state.realtimeState, state.invite?.viewerRole);
    return;
  }
  if (!isBattleLobbyPage || !state.session || !state.id || state.realtimeConnecting
    || (state.realtimeSocket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(state.realtimeSocket.readyState))) return;
  const wsBase = String(import.meta.env.VITE_ARENA_REALTIME_URL || "").trim();
  if (!wsBase) {
    if (!state.realtimeConfigAlertShown) {
      showAlert("Realtime service URL is not configured yet. Deploy the Cloudflare realtime service and set VITE_ARENA_REALTIME_URL on the Vercel frontend.");
      state.realtimeConfigAlertShown = true;
    }
    renderBattle(state.realtimeState || { phase: "LOBBY", status: "LOBBY", players: {}, log: [] });
    return;
  }
  state.realtimeConnecting = true;
  try {
    const ticketPayload = await requestJson(`/api/realtime-ticket?id=${encodeURIComponent(state.id)}`);
    const websocketUrl = new URL("/room", wsBase.replace(/\/$/, "") + "/");
    websocketUrl.protocol = websocketUrl.protocol === "https:" ? "wss:" : "ws:";
    websocketUrl.searchParams.set("ticket", ticketPayload.ticket);
    const socket = new WebSocket(websocketUrl.toString());
    state.realtimeSocket = socket;
    socket.addEventListener("open", () => {
      state.realtimeConnecting = false;
      state.realtimeConfigAlertShown = false;
      clearAlert();
      if (state.realtimeTimer) clearInterval(state.realtimeTimer);
      state.realtimeTimer = setInterval(paintInputFrame, 50);
      socket.send(JSON.stringify({ type: "sync" }));
    });
    socket.addEventListener("message", (event) => {
      let payload;
      try { payload = JSON.parse(event.data); } catch { return; }
      if (payload.type === "state") renderBattle(payload.state, payload.viewerRole);
    });
    socket.addEventListener("error", () => {
      if (!state.realtimeConfigAlertShown) {
        showAlert("The realtime connection failed. Check the Cloudflare worker deployment and allowed frontend origin.");
        state.realtimeConfigAlertShown = true;
      }
    });
    socket.addEventListener("close", () => {
      state.realtimeConnecting = false;
      state.realtimeSocket = null;
      if (state.realtimeTimer) clearInterval(state.realtimeTimer);
      state.realtimeTimer = null;
    });
  } catch (error) {
    state.realtimeConnecting = false;
    if (!state.realtimeConfigAlertShown) showAlert(error?.message || "Could not connect to the realtime room.");
    state.realtimeConfigAlertShown = true;
  }
}

function renderPact(pact) {
  const card = $("#pact-card");
  if (state.invite?.gameMode === "PRACTICE") {
    state.pact = null;
    if (card) card.hidden = true;
    const readyCard = $("#ready-card");
    if (readyCard) readyCard.hidden = state.invite.status !== "READY";
    return;
  }
  state.pact = pact;
  if (!card || !isBattleLobbyPage) return;
  const status = state.invite?.status;
  const relevant = ["READY", "IN_BATTLE", "RESULT_PENDING", "DISPUTED", "SETTLED", "CONDITION_PENDING", "CONDITION_FULFILLED"].includes(status);
  card.hidden = !relevant;
  if (!relevant) return;
  const dealNode = $("#pact-deal-text");
  if (dealNode) {
    const agreedDeal = pact?.agreement?.condition
      || [
        state.invite?.challengerDemand ? `Challenger demand: ${state.invite.challengerDemand}` : "",
        state.invite?.opponentDemand ? `Opponent demand: ${state.invite.opponentDemand}` : "",
      ].filter(Boolean).join("\n");
    dealNode.textContent = agreedDeal || "Waiting for both players to agree on the terms.";
  }
  const winnerNode = $("#pact-winner-text");
  const loserNode = $("#pact-loser-text");
  const conditionStatusNode = $("#pact-condition-status");
  const battleFinishedNow = state.battle?.status === "FINISHED";
  const hasWinner = battleFinishedNow && Boolean(state.battle?.winnerDiscordId || state.realtimeState?.winnerRole);
  const authoritativeWinnerId = state.battle?.winnerDiscordId || (state.realtimeState?.winnerRole === "challenger" ? state.invite?.challenger?.discordId : state.realtimeState?.winnerRole === "opponent" ? state.invite?.opponent?.discordId : "");
  const winnerIsChallenger = hasWinner && String(authoritativeWinnerId || "") === String(state.invite?.challenger?.discordId || "");
  const winnerPlayer = hasWinner ? (winnerIsChallenger ? state.invite.challenger : state.invite.opponent) : null;
  const loserPlayer = hasWinner ? (winnerIsChallenger ? state.invite.opponent : state.invite.challenger) : null;
  if (winnerNode) winnerNode.textContent = winnerPlayer?.username || (hasWinner ? "Winner confirmed" : "Not decided yet");
  if (loserNode) loserNode.textContent = loserPlayer?.username || (hasWinner ? "Loser confirmed" : "Not decided yet");
  if (conditionStatusNode) {
    conditionStatusNode.textContent = pact?.fulfilledOnchain ? "Fulfilled on Monad"
      : pact?.settledOnchain ? "Winner must confirm completion"
        : hasWinner && pact?.minted ? "Match finished: settlement pending"
          : pact?.minted ? "Agreement minted: awaiting battle"
            : "Awaiting Pact mint";
  }
  const configured = Boolean(pact?.configured);
  const minted = Boolean(pact?.minted);
  const readyCard = $("#ready-card");
  if (readyCard) readyCard.hidden = state.invite?.status !== "READY" || !minted;
  $("#pact-state-chip").textContent = minted ? `MINTED #${pact.pactId}` : configured ? "SIGNATURES REQUIRED" : "NOT CONFIGURED";
  $("#pact-sign-status").textContent = !configured
    ? (pact?.reason || "Pact factory address has not been configured.")
    : minted
      ? `Pact #${pact.pactId} is minted. Receipt #${pact.challengerReceiptId} belongs to the challenger and #${pact.opponentReceiptId} belongs to the opponent.`
      : pact.yourSignatureStored
        ? (pact.challengerSigned && pact.opponentSigned ? "Both players signed. Either player can mint the paired soulbound receipts." : "Your signature is saved. Waiting for the other player to sign.")
        : (pact.challengerSigned || pact.opponentSigned ? "One player has signed. Sign the exact same agreement to continue." : "Both players must sign the same public condition and Chog selections.");
  const signButton = $("#pact-sign-button");
  signButton.hidden = !configured || minted || Boolean(pact.yourSignatureStored);
  signButton.disabled = state.pactBusy || !state.wallet || state.invite?.status !== "READY";
  signButton.textContent = state.pactBusy ? "Working…" : "Sign agreement ↗";
  const mintButton = $("#pact-mint-button");
  mintButton.hidden = !configured || minted || !(pact.challengerSigned && pact.opponentSigned);
  mintButton.disabled = state.pactBusy || !state.wallet || state.invite?.status !== "READY";
  const battleFinished = state.battle?.status === "FINISHED";
  const isWinner = Boolean(state.battle?.youWon);
  const resultDisputed = Boolean(pact?.resultDisputed || status === "DISPUTED");
  const resultReviewPanel = $("#result-review-panel");
  const resultReviewNote = $("#result-review-note");
  const disputeDetail = $("#result-dispute-detail");
  const disputeLabel = $("#result-dispute-label");
  const disputeReason = $("#result-dispute-reason");
  const disputeButton = $("#pact-dispute-button");
  const resolveDisputeButton = $("#pact-resolve-dispute-button");
  const availableAt = Date.parse(pact?.resultSettlementAvailableAt || "");
  const reviewRemaining = Number.isFinite(availableAt)
    ? Math.max(0, availableAt - Date.now())
    : Math.max(0, Number(pact?.resultReviewRemainingMs || 0));
  const reviewOpen = !resultDisputed && reviewRemaining > 0;
  const canReviewResult = battleFinished && minted && !pact.settledOnchain && !pact.settlementPending;
  if (resultReviewPanel) resultReviewPanel.hidden = !canReviewResult;
  if (resultReviewNote) {
    resultReviewNote.textContent = resultDisputed
      ? "Settlement is paused because a participant flagged the result. An authorized moderator must review it."
      : reviewOpen
        ? "Settlement is locked during the five-minute review window. Time remaining: " + Math.ceil(reviewRemaining / 1000) + " seconds."
        : "The review window is closed. Either participant can still flag an issue until the winner submits settlement.";
  }
  if (disputeDetail) {
    disputeDetail.hidden = !resultDisputed;
    disputeDetail.textContent = resultDisputed
      ? "Dispute from " + (pact?.resultDispute?.byUsername || "a participant") + ": " + (pact?.resultDispute?.reason || "Reason not available.")
      : "";
  }
  if (disputeLabel) disputeLabel.hidden = resultDisputed;
  if (disputeReason) {
    disputeReason.hidden = resultDisputed;
    disputeReason.disabled = state.pactBusy || !canReviewResult || resultDisputed;
  }
  if (disputeButton) {
    disputeButton.hidden = !canReviewResult || resultDisputed;
    disputeButton.disabled = state.pactBusy;
  }
  if (resolveDisputeButton) {
    resolveDisputeButton.hidden = !resultDisputed || !pact?.canModerateResult;
    resolveDisputeButton.disabled = state.pactBusy;
  }
  const settleButton = $("#pact-settle-button");
  settleButton.hidden = !(battleFinished && isWinner && minted && !pact.settledOnchain && !pact.settlementPending);
  settleButton.disabled = state.pactBusy || resultDisputed || reviewOpen;
  settleButton.textContent = resultDisputed ? "Settlement paused — dispute open"
    : reviewOpen ? "Result review · " + Math.ceil(reviewRemaining / 1000) + "s"
      : "Settle match result ↗";
  const fulfillButton = $("#pact-fulfill-button");
  fulfillButton.hidden = !(battleFinished && isWinner && pact.settledOnchain && !pact.fulfilledOnchain);
  fulfillButton.disabled = state.pactBusy;
  if (!configured) {
    $("#pact-sign-status").textContent = pact?.reason || "Pact factory address has not been configured.";
  } else if (minted && pact.settlementPending) {
    $("#pact-sign-status").textContent = "The match result is being submitted on-chain. Refresh shortly.";
  } else if (minted && battleFinished && !pact.settledOnchain) {
    $("#pact-sign-status").textContent = isWinner
      ? "You won. Settle the verified match result on-chain before the condition can be marked fulfilled."
      : "The match is finished. Waiting for the winner to settle the result on-chain.";
  } else if (pact.settledOnchain && !pact.fulfilledOnchain) {
    $("#pact-sign-status").textContent = isWinner
      ? "The result is settled. Once the agreed condition is completed, confirm fulfilment here; the loser's NFT metadata will update."
      : "The result is settled. Your Pact receipt will remain marked Unfulfilled Challenge until the winner confirms completion.";
  } else if (pact.fulfilledOnchain) {
    $("#pact-sign-status").textContent = "Condition fulfilled on-chain. Both soulbound receipts now show the final outcome.";
  }
  if (resultDisputed) {
    $("#pact-sign-status").textContent = "This result is disputed. Settlement remains blocked until an authorized moderator reviews the dispute. The recorded winner cannot be rewritten by the deployed factory.";
  } else if (reviewOpen && minted && battleFinished) {
    $("#pact-sign-status").textContent = "The match result is recorded. A five-minute review window must finish before the winner can settle it on-chain.";
  }
  updateBilateralControls();
  const tx = $("#pact-tx-status");
  tx.hidden = !minted;
  tx.textContent = minted
    ? `Mint: ${pact.transactionHash || "confirmed"}${pact.settlementTxHash ? ` · Settlement: ${pact.settlementTxHash}` : ""}${pact.fulfillmentTxHash ? ` · Fulfilment: ${pact.fulfillmentTxHash}` : ""}`
    : "";
}
async function loadPact() {
  if (!isBattleLobbyPage || !state.session || !state.id || !state.invite) return;
  if (state.invite.gameMode === "PRACTICE") {
    state.pact = null;
    const card = $("#pact-card");
    if (card) card.hidden = true;
    if (state.realtimeState) renderBattle(state.realtimeState);
    return;
  }
  if (!["READY", "IN_BATTLE", "RESULT_PENDING", "DISPUTED", "SETTLED", "CONDITION_PENDING", "CONDITION_FULFILLED"].includes(state.invite.status)) return;
  const payload = await requestJson(`/api/pacts?id=${encodeURIComponent(state.id)}`);
  renderPact(payload.pact);
  if (state.realtimeState) renderBattle(state.realtimeState);
}
async function postPactAction(action, extra = {}) {
  if (state.pactBusy) return;
  state.pactBusy = true;
  clearAlert();
  if (state.pact) renderPact(state.pact);
  try {
    const payload = await requestJson("/api/pacts", {
      method: "POST",
      body: JSON.stringify({ action, id: state.id, ...extra }),
    });
    renderPact(payload.pact);
    if (payload.pact?.minted) showAlert("The paired soulbound Pact NFTs are confirmed on-chain.", "success");
    return payload.pact;
  } catch (error) {
    showAlert(error?.message || "The Pact NFT action failed.");
    throw error;
  } finally {
    state.pactBusy = false;
    if (state.pact) renderPact(state.pact);
  }
}
async function signCurrentPact() {
  if (!state.wallet || !state.session?.walletAddress || state.wallet.toLowerCase() !== state.session.walletAddress.toLowerCase()) {
    throw new Error("Connect and verify the wallet linked to your Discord account first.");
  }
  const pact = state.pact;
  const signature = await signPactAgreement(state.wallet, pact);
  await postPactAction("sign", { signature });
}
async function mintCurrentPact() {
  if (!state.wallet || !state.pact?.challengerSignature || !state.pact?.opponentSignature) {
    throw new Error("Both players must sign before minting.");
  }
  state.pactBusy = true;
  renderPact(state.pact);
  try {
    const transactionHash = await mintPactAgreement(state.wallet, state.pact);
    state.pactBusy = false;
    await postPactAction("confirmMint", { transactionHash });
    await loadPact();
  } catch (error) {
    showAlert(error?.message || "Could not mint the Pact NFTs.");
  } finally {
    state.pactBusy = false;
    if (state.pact) renderPact(state.pact);
  }
}
async function loadBattle() {
  if (!isBattleLobbyPage || !state.session || !state.id) return;
  await connectRealtime();
}
async function postBattleAction(action, extra = {}) {
  if (state.battleBusy) return;
  state.battleBusy = true;
  clearAlert();
  try {
    if (action !== "start") throw new Error("Unsupported battle action.");
    if (state.invite?.gameMode !== "PRACTICE" && !state.pact?.minted) throw new Error("Both players must mint the Pact NFT before combat can begin.");
    if (!state.invite?.challenger?.ready || !state.invite?.opponent?.ready) throw new Error("Both players must confirm readiness first.");
    await requestJson("/api/battle", {
      method: "POST",
      body: JSON.stringify({ action: "start", id: state.id }),
    });
    await loadInvite();
    await connectRealtime();
  } catch (error) {
    showAlert(error?.message || "Could not enter the live arena.");
  } finally {
    state.battleBusy = false;
    renderBattle(state.realtimeState || { phase: "LOBBY", status: "LOBBY", players: {}, log: [] });
  }
}

function updateBilateralControls() {
  const own = $("#own-demand-text");
  const save = $("#save-demand-button");
  const accept = $("#accept-bilateral-terms");
  if (!own || !save || !accept || !state.invite) return;
  const invite = state.invite;
  const isChallenger = invite.viewerRole === "challenger";
  const saved = isChallenger ? (invite.challengerDemand || "") : (invite.opponentDemand || "");
  const otherDemand = isChallenger ? (invite.opponentDemand || "") : (invite.challengerDemand || "");
  const ownAccepted = Boolean(isChallenger ? invite.challenger?.termsAccepted : invite.opponent?.termsAccepted);
  const signaturesStarted = Boolean(state.pact?.challengerSigned || state.pact?.opponentSigned);
  const locked = Boolean(state.pact?.minted || signaturesStarted || invite.pactMinted || !["TERMS_ACCEPTED", "READY"].includes(invite.status));
  own.disabled = locked;
  save.disabled = locked || state.busy || own.value.trim().length < 5 || own.value.trim() === saved.trim();
  accept.disabled = locked || state.busy || state.pactBusy || own.value.trim().length < 5
    || own.value.trim() !== saved.trim() || otherDemand.trim().length < 5 || ownAccepted;
  accept.textContent = ownAccepted ? "You accepted both demands ✓" : "I accept both demands ↗";
}
async function saveOwnDemand() {
  const own = $("#own-demand-text");
  const demand = own?.value?.trim() || "";
  if (demand.length < 5) throw new Error("Write a demand of at least five characters.");
  await postAction("saveDemand", { demand });
  $("#demand-status").textContent = "Your demand is saved. Both players must accept the exact pair of demands.";
  $("#demand-status").dataset.kind = "success";
}
async function acceptBilateralTerms() {
  const invite = state.invite;
  if (!invite) throw new Error("The lobby is still loading.");
  const isChallenger = invite.viewerRole === "challenger";
  const saved = isChallenger ? invite.challengerDemand : invite.opponentDemand;
  const own = $("#own-demand-text").value.trim();
  const other = isChallenger ? invite.opponentDemand : invite.challengerDemand;
  if (own.length < 5 || own !== String(saved || "").trim()) throw new Error("Save your demand before accepting.");
  if (String(other || "").trim().length < 5) throw new Error("Wait for the other player to write and save their demand.");
  await postAction("acceptTerms");
  $("#demand-status").textContent = state.invite?.status === "READY"
    ? "Both players accepted both demands. The Pact NFT can now be signed and minted."
    : "Your acceptance is recorded. Waiting for the other player to accept both demands.";
  $("#demand-status").dataset.kind = "success";
}
function renderChogs() {
  const target = $("#lobby-chog-grid");
  const practiceMode = state.invite?.gameMode === "PRACTICE";
  const fighters = practiceMode ? PROTOTYPE_FIGHTERS : state.chogs;
  $("#fighter-count").textContent = practiceMode ? "PROTOTYPE FIGHTERS" : (state.chogs.length ? `${state.chogs.length} CHOG(S)` : "NO CHOGS");
  if (!state.wallet) {
    target.innerHTML = '<div class="roster-empty">Connect and verify a wallet to load the fighter selector.</div>';
    updateAcceptButton();
    return;
  }
  if (!fighters.length) {
    target.innerHTML = '<div class="roster-empty">No Chog Genesis NFTs were found in this wallet. You cannot accept an official challenge without one.</div>';
    updateAcceptButton();
    return;
  }
  target.innerHTML = fighters.map((chog) => {
    const meta = chog.metadata || {};
    const dna = buildRosterPreview(meta);
    const picked = String(state.selectedTokenId) === String(chog.tokenId);
    const image = meta.image
      ? `<img src="${escapeHtml(meta.image)}" alt="${escapeHtml(meta.name || (practiceMode ? meta.name : `Chog #${chog.tokenId}`))}" loading="lazy" referrerpolicy="no-referrer">`
      : '<div class="no-art">C</div>';
    return `<button type="button" class="lobby-chog-card ${picked ? "selected" : ""}" data-select-fighter="${escapeHtml(chog.tokenId)}">
      <div class="lobby-chog-art">${image}</div>
      <div class="lobby-chog-card-copy">
        <div class="lobby-chog-title"><strong>${escapeHtml(meta.name || `Chog #${chog.tokenId}`)}</strong><span class="tier-chip">${escapeHtml(meta.Tier || "Common")}</span></div>
        <small>${practiceMode ? "PROTOTYPE · NO NFT" : `Chog Genesis · #${escapeHtml(chog.tokenId)}`}</small>
        <div class="lobby-chog-stats"><span>HP <b>${Math.round(dna.stats.hp)}</b></span><span>ATK <b>${Math.round(dna.stats.attack)}</b></span><span>DEF <b>${Math.round(dna.stats.defense)}</b></span><span>SPD <b>${Math.round(dna.stats.speed)}</b></span></div>
        <span class="lobby-pick-label">${picked ? "✓ SELECTED" : (practiceMode ? "SELECT PROTOTYPE" : "SELECT THIS CHOG")}</span>
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
    const returnTo = `${isBattleLobbyPage ? "/battle-lobby.html" : "/invite.html"}?id=${encodeURIComponent(state.id || "")}`;
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
  if (isBattleLobbyPage) {
    const finishedPactStatuses = ["RESULT_PENDING", "DISPUTED", "SETTLED", "CONDITION_PENDING", "CONDITION_FULFILLED"];
    if (finishedPactStatuses.includes(payload.invite.status)) {
      // Finished/disputed matches no longer need a realtime ticket. Close any
      // existing socket so the room does not keep a needless live connection.
      if (state.realtimeSocket) {
        try { state.realtimeSocket.close(1000, "Match result review"); } catch { /* already closed */ }
        state.realtimeSocket = null;
      }
      if (state.realtimeTimer) clearInterval(state.realtimeTimer);
      state.realtimeTimer = null;
      const battlePayload = await requestJson("/api/battle?id=" + encodeURIComponent(state.id));
      state.battle = battlePayload.battle;
    } else {
      await connectRealtime();
    }
    if (acceptedStatuses.includes(payload.invite.status) && payload.invite.gameMode !== "PRACTICE") await loadPact();
    if (state.realtimeState) renderBattle(state.realtimeState);
  }
}
async function loadChogs() {
  if (!state.wallet) return;
  if (state.invite?.gameMode === "PRACTICE") {
    state.chogs = [];
    state.selectedTokenId = null;
    $("#fighter-prompt").textContent = "Choose a prototype fighter. No Chog Genesis NFT is needed for practice.";
    renderChogs();
    return;
  }
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
    if (state.pact) renderPact(state.pact);
    if (state.battle) renderBattle(state.battle);
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
      showAlert("You joined the lobby. Write your demand there and accept both demands before minting the Pact NFT.", "success");
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
$("#combat-start").addEventListener("click", () => postBattleAction("start"));
$("#pact-sign-button").addEventListener("click", async () => {
  try { await signCurrentPact(); } catch (error) { showAlert(error?.message || "Could not sign the agreement."); }
});
$("#pact-mint-button").addEventListener("click", mintCurrentPact);
$("#pact-settle-button").addEventListener("click", async () => {
  try { await postPactAction("settle"); } catch (error) { showAlert(error?.message || "Could not settle the match result."); }
});
$("#pact-dispute-button")?.addEventListener("click", async () => {
  const reason = $("#result-dispute-reason")?.value || "";
  try {
    await postPactAction("disputeResult", { reason });
    if ($("#result-dispute-reason")) $("#result-dispute-reason").value = "";
    await loadInvite();
    showAlert("Settlement is paused while the result dispute is reviewed.", "success");
  } catch (error) {
    showAlert(error?.message || "Could not flag the match result.");
  }
});
$("#pact-resolve-dispute-button")?.addEventListener("click", async () => {
  const confirmed = window.confirm("Dismiss this dispute and uphold the existing server-recorded winner? This restarts the five-minute review window; it does not change the on-chain winner.");
  if (!confirmed) return;
  try {
    const updatedPact = await postPactAction("resolveDispute", { resolution: "uphold" });
    if (state.invite) {
      state.invite = { ...state.invite, status: "RESULT_PENDING", updatedAt: new Date().toISOString() };
      renderSummary(state.invite);
    }
    if (updatedPact) renderPact(updatedPact);
    showAlert("Dispute dismissed. The review window has restarted.", "success");
  } catch (error) {
    showAlert(error?.message || "Could not resolve the result dispute.");
  }
});
$("#pact-fulfill-button").addEventListener("click", async () => {
  if (!state.wallet || !state.pact?.pactId) return showAlert("Connect your linked winner wallet first.");
  state.pactBusy = true;
  renderPact(state.pact);
  try {
    const transactionHash = await confirmPactFulfillment(state.wallet, state.pact);
    state.pactBusy = false;
    await postPactAction("recordFulfillment", { transactionHash });
    await loadInvite();
  } catch (error) {
    showAlert(error?.message || "Could not confirm condition fulfilment.");
  } finally {
    state.pactBusy = false;
    if (state.pact) renderPact(state.pact);
  }
});

$("#accept-condition-check").addEventListener("change", updateAcceptButton);
$("#save-demand-button")?.addEventListener("click", async () => {
  if (state.busy) return;
  try { await saveOwnDemand(); } catch (error) { showAlert(error?.message || "Could not save your demand."); }
});
$("#own-demand-text")?.addEventListener("input", updateBilateralControls);
$("#accept-bilateral-terms")?.addEventListener("click", async () => {
  if (state.busy) return;
  try { await acceptBilateralTerms(); } catch (error) { showAlert(error?.message || "Could not accept the demands."); }
});
$("#accept-invite").addEventListener("click", async () => {
  if (state.busy) return;
  if (!state.wallet) return showAlert("Connect and verify the wallet belonging to your Discord account first.");
  if (!state.selectedTokenId) return showAlert("Choose one of your Chogs first.");
  if (!$("#accept-condition-check").checked) return showAlert("Confirm that you want to join this challenge lobby.");
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
  const practiceMode = state.invite?.gameMode === "PRACTICE";
  const chog = (practiceMode ? PROTOTYPE_FIGHTERS : state.chogs).find((item) => String(item.tokenId) === button.dataset.selectFighter);
  if (!chog) return;
  state.selectedTokenId = chog.tokenId;
  $("#selected-fighter-status").textContent = `${chog.metadata.name || `Chog #${chog.tokenId}`} ${practiceMode ? "prototype" : "Chog"} selected.`;
  renderChogs();
});

function isTextEntryTarget(target) {
  return target instanceof HTMLElement && (
    target.isContentEditable
    || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
}
document.addEventListener("keydown", (event) => {
  if (isTextEntryTarget(event.target)) return;
  const key = event.key.toLowerCase();
  const controlKeys = ["w", "a", "s", "d", "q", "j", "arrowup", "arrowdown", "arrowleft", "arrowright", " ", "shift", "e"];
  if (!controlKeys.includes(key)) return;
  event.preventDefault();
  const wasDown = state.keys.has(key);
  state.keys.add(key);
  if (wasDown || state.realtimeState?.phase !== "IN_BATTLE" || state.realtimeState?.status !== "IN_BATTLE") return;
  if (key === " ") registerBasicTap();
  if (key === "q") state.pendingAction = "base";
  if (key === "e") state.pendingAction = "special";
  if (key === "j") state.pendingAction = "jump";
  if (key === "shift") state.pendingAction = "dash";
});
document.addEventListener("keyup", (event) => state.keys.delete(event.key.toLowerCase()));
window.addEventListener("blur", () => state.keys.clear());
const realtimeCanvas = $("#realtime-arena");
if (realtimeCanvas) realtimeCanvas.addEventListener("pointerdown", () => realtimeCanvas.focus());
document.querySelectorAll("[data-arena-key]").forEach((button) => {
  const key = button.dataset.arenaKey;
  const press = (event) => { event.preventDefault(); state.keys.add(key); };
  const release = (event) => { event.preventDefault(); state.keys.delete(key); };
  button.addEventListener("pointerdown", press);
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("pointerleave", release);
});
document.querySelectorAll("[data-arena-action]").forEach((button) => {
  button.addEventListener("click", () => {
    if (state.realtimeState?.phase !== "IN_BATTLE" || state.realtimeState?.status !== "IN_BATTLE") return;
    if (button.dataset.arenaAction === "attack") registerBasicTap();
    else state.pendingAction = button.dataset.arenaAction;
  });
});
async function init() {
  try {
    const sessionResponse = await fetch("/api/discord/session", { credentials: "same-origin", headers: { accept: "application/json" } });
    const sessionPayload = await sessionResponse.json().catch(() => ({}));
    if (!sessionPayload?.authenticated) {
      const returnTo = `${isBattleLobbyPage ? "/battle-lobby.html" : "/invite.html"}?id=${encodeURIComponent(state.id || "")}`;
      window.location.replace("/?returnTo=" + encodeURIComponent(returnTo));
      return;
    }
    state.session = sessionPayload.user;
    state.wallet = null;
    await loadInvite();
    await fetch("/api/players", { method: "POST", credentials: "same-origin", headers: { accept: "application/json" } }).catch(() => {});
    if (window.ethereum?.request) {
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
          if (state.pact) renderPact(state.pact);
          if (state.battle) renderBattle(state.battle);
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
  if (document.hidden || state.busy || state.battleBusy || !state.session || !state.id) return;
  try {
    await loadInvite();
  } catch {
    // Keep the latest visible invite status; the manual refresh button exposes errors.
  }
}, 5000);
