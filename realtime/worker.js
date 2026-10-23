import { DISCONNECT_GRACE_MS, getDisconnectedForfeitRole } from "../server/launchPolicy.js";
import {
  isTargetInFront,
  isWithinPunchHitbox,
  projectileOverlapsFighter,
  projectileIsDodgedByJump,
} from "./combatRules.js";
import { updateHeldDefense, getGuardBlockPercent } from "./defenseRules.js";
const LIVE_ARENA_GROUND_Y = 324;

function base64UrlToBytes(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
function base64UrlToText(value) {
  return new TextDecoder().decode(base64UrlToBytes(value));
}
function base64UrlEncode(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
}
async function verifyTicket(ticket, secret) {
  if (!secret || typeof ticket !== "string") return null;
  const parts = ticket.split(".");
  if (parts.length !== 2) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), base64UrlToBytes(parts[1]), new TextEncoder().encode(parts[0]));
    if (!ok) return null;
    const claims = JSON.parse(base64UrlToText(parts[0]));
    if (claims.v !== 1 || !/^[0-9a-f-]{36}$/i.test(claims.inviteId || "") || !/^\d{17,20}$/.test(claims.discordId || "")
      || !/^0x[a-f0-9]{40}$/i.test(claims.walletAddress || "") || !["challenger", "opponent"].includes(claims.role)
      || !Number.isFinite(claims.expiresAt) || claims.expiresAt <= Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}
function json(payload, status = 200) {
  return Response.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}
function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = String(env.ARENA_FRONTEND_ORIGIN || "").split(",").map((value) => value.trim()).filter(Boolean);
  return allowed.includes(origin);
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return json({ ok: true, service: "chog-battle-arena-realtime" });
    if (url.pathname !== "/room" || request.method !== "GET") return json({ error: "Not found." }, 404);
    if (!allowedOrigin(request, env)) return json({ error: "This frontend origin is not authorized." }, 403);
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return json({ error: "A WebSocket connection is required." }, 426);
    const claims = await verifyTicket(url.searchParams.get("ticket"), String(env.SESSION_SECRET || ""));
    if (!claims) return json({ error: "Realtime ticket is invalid or expired." }, 401);
    if (!env.ARENA_ROOMS) return json({ error: "Realtime room binding is not configured." }, 503);
    const id = env.ARENA_ROOMS.idFromName(claims.inviteId);
    const stub = env.ARENA_ROOMS.get(id);
    // Forward the original WebSocket request so the platform preserves its 101 upgrade.
    // The Durable Object verifies the signed ticket again before accepting the socket.
    return stub.fetch(request);
  },
};

const MAP_W = 960;
const MAP_H = 540;
const ARENA_MARGIN = 42;
const MIN_FIGHTER_DISTANCE = 150;
const MAX_LOG = 60;
const TOTAL_ROUNDS = 3;
const ROUND_TIME_MS = 60_000;
const ROUND_INTERMISSION_MS = 2_200;
const BASIC_DOUBLE_TAP_MS = 260;
const BASIC_COOLDOWN_MS = 1_000;
const BASE_COOLDOWN_MS = 5_000;
const SPECIAL_COOLDOWN_MS = 30_000;
const DASH_COOLDOWN_MS = 1_100;
const JUMP_COOLDOWN_MS = 850;
const ARENA_LEFT = 100;
const ARENA_RIGHT = MAP_W - 100;
const ARENA_TOP = 192;
const ARENA_BOTTOM = LIVE_ARENA_GROUND_Y;

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function parseJSON(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}
function randomInt(min, max) {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return min + (values[0] % (max - min + 1));
}
function fighterFromDna({ id, username, role, dna, hp, connected, x, y, tokenId }) {
  const parsed = typeof dna === "string" ? parseJSON(dna, {}) : (dna || {});
  const stats = parsed.stats || {};
  const maxHp = Math.max(1, Number(stats.maxHp || hp || 100));
  return {
    discordId: id,
    username: username || (role === "challenger" ? "Challenger" : "Opponent"),
    tokenId: String(tokenId || ""),
    fighterName: String(parsed.name || "Chog"),
    role,
    connected: Boolean(connected),
    x: x ?? (role === "challenger" ? 280 : 680),
    y: LIVE_ARENA_GROUND_Y,
    vx: 0,
    vy: 0,
    hp: clamp(Number(hp ?? maxHp), 0, maxHp),
    maxHp,
    energy: 100,
    maxEnergy: 100,
    attack: clamp(Number(stats.attack || 20), 5, 45),
    defense: clamp(Number(stats.defense || 14), 0, 40),
    speed: clamp(Number(stats.speed || 14), 8, 28),
    tier: String(parsed.tier || "Common"),
    ability: String(parsed.ability || "Focused Strike"),
    action: "idle",
    actionStartedAt: 0,
    actionUntil: 0,
    pendingAttack: null,
    input: { x: 0, y: 0 },
    guarding: false,
    defendRequested: false,
    guardStartedAt: 0,
    guardCooldownUntil: 0,
    defenseRequiresRelease: false,
    facing: role === "challenger" ? 1 : -1,
    nextAttackAt: 0,
    nextBaseAt: 0,
    nextSpecialAt: 0,
    nextDashAt: 0,
    nextJumpAt: 0,
    jumpStartedAt: 0,
    jumpUntil: 0,
    jumpHeight: 0,
    landedPunchWindows: [],
    flashUntil: 0,
  };
}
export class ArenaRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.cachedState = null;
    this.lastPersist = 0;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== "/room" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json({ error: "Not found." }, 404);
    }
    const claims = await verifyTicket(url.searchParams.get("ticket"), String(this.env.SESSION_SECRET || ""));
    if (!claims || claims.inviteId !== String(this.ctx.id.name || claims.inviteId)) {
      return json({ error: "Room ticket is invalid or expired." }, 401);
    }
    const invite = await this.env.CHOG_DB.prepare("SELECT * FROM chog_challenge_invites WHERE id = ?1 LIMIT 1").bind(claims.inviteId).first();
    if (!invite) return json({ error: "Challenge not found." }, 404);
    const isChallenger = claims.role === "challenger" && invite.challenger_discord_id === claims.discordId;
    const isOpponent = claims.role === "opponent" && invite.opponent_discord_id === claims.discordId;
    const wallet = isChallenger ? invite.challenger_wallet : isOpponent ? invite.opponent_wallet : null;
    if ((!isChallenger && !isOpponent) || !wallet || wallet.toLowerCase() !== String(claims.walletAddress).toLowerCase()) {
      return json({ error: "This Discord wallet is not a participant in this lobby." }, 403);
    }
    if (invite.status === "PENDING_ACCEPTANCE") return json({ error: "The invited player must accept before anyone can join the realtime room." }, 409);
    if (!["TERMS_ACCEPTED", "READY", "IN_BATTLE", "RESULT_PENDING", "SETTLED", "CONDITION_PENDING", "CONDITION_FULFILLED"].includes(invite.status)) {
      return json({ error: "This lobby is no longer active." }, 409);
    }
    const battle = await this.env.CHOG_DB.prepare("SELECT * FROM chog_battles WHERE invite_id = ?1 LIMIT 1").bind(claims.inviteId).first();
    const state = await this._refreshState(invite, battle);
    // Keep one active socket per participant to avoid duplicate tabs sending competing controls.
    for (const existing of this.ctx.getWebSockets(claims.role)) {
      const previous = existing.deserializeAttachment();
      if (previous?.discordId === claims.discordId) {
        try { existing.close(4001, "A newer Arena connection replaced this session."); } catch { /* already closed */ }
      }
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server, [claims.role]);
    server.serializeAttachment({
      inviteId: claims.inviteId, discordId: claims.discordId, walletAddress: claims.walletAddress,
      role: claims.role, username: claims.username,
    });
    const player = state.players[claims.role];
    if (!player.connected) state.log.push({ text: `@${player.username} joined the lobby.`, at: Date.now() });
    player.connected = true;
    player.disconnectedAt = 0;
    this._trimLog(state);
    await this._persist(state, true);
    await this._scheduleDisconnectAlarm(state);
    this._broadcast(state);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket, rawMessage) {
    const attachment = socket.deserializeAttachment();
    if (!attachment?.inviteId || !attachment.role) return;
    const now = Date.now();
    if (attachment.lastMessageAt && now - attachment.lastMessageAt < 25) return;
    attachment.lastMessageAt = now;
    socket.serializeAttachment(attachment);
    const message = parseJSON(String(rawMessage), null);
    if (!message || typeof message !== "object") return;
    let state = await this._readState();
    if (!state) return;
    if (message.type === "sync") {
      const invite = await this.env.CHOG_DB.prepare("SELECT * FROM chog_challenge_invites WHERE id = ?1 LIMIT 1").bind(attachment.inviteId).first();
      if (invite) {
        const battle = await this.env.CHOG_DB.prepare("SELECT * FROM chog_battles WHERE invite_id = ?1 LIMIT 1").bind(attachment.inviteId).first();
        state = await this._refreshState(invite, battle);
      }
      const player = state.players[attachment.role];
      if (player) {
        player.connected = true;
        player.disconnectedAt = 0;
        player.username = attachment.username || player.username;
      }
      await this._resolveMatch(state, Date.now());
      await this._persist(state, true);
      await this._scheduleDisconnectAlarm(state);
      this._broadcast(state);
      return;
    }

    if (message.type === "input" && state.status === "IN_BATTLE"
      && ["IN_BATTLE", "ROUND_OVER"].includes(state.phase)) {
      const now = Date.now();
      this._step(state, now);
      const player = state.players[attachment.role];
      if (!player || player.discordId !== attachment.discordId) return;
      const inputX = Number(message.x);
      const inputY = Number(message.y);
      player.input = {
        x: Number.isFinite(inputX) ? clamp(Math.sign(inputX), -1, 1) : 0,
        y: Number.isFinite(inputY) ? clamp(Math.sign(inputY), -1, 1) : 0,
      };
      if (typeof message.defending === "boolean") player.defendRequested = message.defending;
      // Facing follows the rival's position in _step, not the movement key.
      // That lets opposite input act as a backstep instead of turning around.
      if (state.phase === "IN_BATTLE") {
        if (message.action === "attack" || message.action === "doubleAttack") {
          this._attack(state, attachment.role, message.action);
        } else if (message.action === "base" || message.action === "special") {
          this._attack(state, attachment.role, message.action);
        } else if (message.action === "dash") {
          this._dash(state, attachment.role, now);
        } else if (message.action === "jump") {
          this._jump(state, attachment.role, now);
        }
      }

      await this._resolveMatch(state, now);
      await this._persist(state, state.status === "FINISHED" || state.phase === "ROUND_OVER");
      await this._scheduleDisconnectAlarm(state);
      this._broadcast(state);
    }
  }

  async webSocketClose(socket) {
    const attachment = socket.deserializeAttachment();
    if (!attachment?.role) return;
    const remaining = this.ctx.getWebSockets(attachment.role).filter((ws) => ws !== socket);
    if (remaining.length) {
      this._broadcast(await this._readState());
      return;
    }
    const state = await this._readState();
    if (!state?.players?.[attachment.role]) return;
    state.players[attachment.role].connected = false;
    state.players[attachment.role].disconnectedAt = Date.now();
    state.players[attachment.role].input = { x: 0, y: 0 };
    updateHeldDefense(state.players[attachment.role], false, Date.now());
    state.log.push({ text: state.status === "IN_BATTLE" ? `@${state.players[attachment.role].username} disconnected. They have 30 seconds to reconnect during the match.` : `@${state.players[attachment.role].username} disconnected.`, at: Date.now() });
    this._trimLog(state);
    await this._persist(state, true);
    await this._scheduleDisconnectAlarm(state);
    this._broadcast(state);
  }

  async webSocketError(socket) {
    await this.webSocketClose(socket);
  }

  async alarm() {
    let state = await this._readState();
    const now = Date.now();
    if (!state || state.status !== "IN_BATTLE") {
      await this.ctx.storage.deleteAlarm();
      return;
    }

    this._step(state, now);
    await this._resolveMatch(state, now);
    if (state.status === "IN_BATTLE") {
      const disconnectedRole = getDisconnectedForfeitRole(state.players, now, DISCONNECT_GRACE_MS);
      if (disconnectedRole) {
        const winnerRole = disconnectedRole === "challenger" ? "opponent" : "challenger";
        const winner = state.players[winnerRole];
        state.status = "FINISHED";
        state.phase = "FINISHED";
        state.matchDraw = false;
        state.winnerDiscordId = winner?.discordId || null;
        state.forfeitRole = disconnectedRole;
        state.projectiles = [];
        state.players[disconnectedRole].input = { x: 0, y: 0 };
        state.players[winnerRole].input = { x: 0, y: 0 };
        state.log.push({
          text: `@${state.players[disconnectedRole].username} did not reconnect within 30 seconds. @${winner?.username || "Opponent"} wins by forfeit.`,
          at: now,
        });
        this._trimLog(state);
        const updatedAt = new Date(now).toISOString();
        const saved = await this.env.CHOG_DB.prepare("UPDATE chog_battles SET status = 'FINISHED', winner_discord_id = ?1, battle_log = ?2, version = version + 1, updated_at = ?3 WHERE invite_id = ?4 AND status = 'IN_BATTLE'")
          .bind(state.winnerDiscordId, JSON.stringify(state.log), updatedAt, state.inviteId).run();
        if (saved?.meta?.changes === 1) {
          state.inviteStatus = "RESULT_PENDING";
          await this.env.CHOG_DB.prepare("UPDATE chog_challenge_invites SET status = 'RESULT_PENDING', updated_at = ?1 WHERE id = ?2 AND status = 'IN_BATTLE'")
            .bind(updatedAt, state.inviteId).run();
        } else {
          const invite = await this.env.CHOG_DB.prepare("SELECT * FROM chog_challenge_invites WHERE id = ?1 LIMIT 1").bind(state.inviteId).first();
          const battle = await this.env.CHOG_DB.prepare("SELECT * FROM chog_battles WHERE invite_id = ?1 LIMIT 1").bind(state.inviteId).first();
          if (invite && battle) state = await this._refreshState(invite, battle);
        }
      }
    }

    await this._persist(state, true);
    await this._scheduleDisconnectAlarm(state);
    this._broadcast(state);
  }

  async _scheduleDisconnectAlarm(state) {
    if (!state || state.status !== "IN_BATTLE") {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const now = Date.now();
    const disconnected = ["challenger", "opponent"]
      .map((role) => ({ role, player: state.players?.[role] }))
      .filter(({ player }) => player?.connected === false && Number(player.disconnectedAt) > 0);
    if (!disconnected.length) {
      await this.ctx.storage.deleteAlarm();
      return;
    }

    const deadlines = disconnected.map(({ player }) => Number(player.disconnectedAt) + DISCONNECT_GRACE_MS);
    let alarmAt;
    if (disconnected.length > 1) {
      const futureDeadlines = deadlines.filter((deadline) => deadline > now);
      alarmAt = futureDeadlines.length ? Math.min(...futureDeadlines) : now + DISCONNECT_GRACE_MS;
    } else {
      alarmAt = deadlines[0];
    }
    const scheduledAlarm = await this.ctx.storage.getAlarm();
    // Do not move a pending deadline later on each 50 ms gameplay input.
    // When the alarm fires Cloudflare clears it before invoking alarm(), so the
    // next grace deadline can then be scheduled normally.
    if (scheduledAlarm === null || scheduledAlarm > alarmAt + 50) {
      await this.ctx.storage.setAlarm(Math.max(now + 250, alarmAt));
    }
  }

  async _refreshState(invite, battle) {
    let state = await this._readState();
    const isStarted = Boolean(battle && ["IN_BATTLE", "FINISHED", "ABANDONED"].includes(battle.status));
    if (!state) {
      state = {
        inviteId: invite.id,
        phase: "LOBBY",
        status: "LOBBY",
        inviteStatus: invite.status,
        startedAt: null,
        updatedAt: Date.now(),
        lastTick: Date.now(),
        players: {
          challenger: { discordId: invite.challenger_discord_id, username: invite.challenger_username || "Challenger", connected: false },
          opponent: { discordId: invite.opponent_discord_id, username: invite.opponent_username || String(invite.opponent_discord_id).replace("username:", "@"), connected: false },
        },
        log: [],
        winnerDiscordId: battle?.winner_discord_id || null,
      };
    }
    state.inviteStatus = invite.status;
    state.totalRounds = TOTAL_ROUNDS;
    state.roundTimeMs = ROUND_TIME_MS;
    state.round = Number.isFinite(state.round) ? state.round : (isStarted ? 1 : 0);
    state.roundWins ||= { challenger: 0, opponent: 0 };
    state.projectiles ||= [];
    state.timeRemainingMs = Number.isFinite(state.timeRemainingMs) ? state.timeRemainingMs : ROUND_TIME_MS;
    state.roundWinnerRole ??= null;
    state.koRole ??= null;
    state.roundResultUntil ||= 0;
    state.matchDraw ??= false;
    state.players.challenger.discordId = invite.challenger_discord_id;
    state.players.challenger.username = invite.challenger_username || "Challenger";
    state.players.opponent.discordId = invite.opponent_discord_id;
    state.players.opponent.username = invite.opponent_username || String(invite.opponent_discord_id).replace("username:", "@");
    for (const role of ["challenger", "opponent"]) {
      const sockets = this.ctx.getWebSockets(role);
      state.players[role].connected = sockets.length > 0;
      const player = state.players[role];
      if (!player.tokenId) player.tokenId = String(invite[`${role}_token_id`] || "");
      if (!player.fighterName) player.fighterName = "Chog";
      if (!player.action) player.action = "idle";
      if (!Number.isFinite(player.actionStartedAt)) player.actionStartedAt = 0;
      if (!Number.isFinite(player.actionUntil)) player.actionUntil = 0;
      if (!("pendingAttack" in player)) player.pendingAttack = null;
      if (!Number.isFinite(player.facing)) player.facing = role === "challenger" ? 1 : -1;
      if (typeof player.guarding !== "boolean") player.guarding = false;
      if (typeof player.defendRequested !== "boolean") player.defendRequested = false;
      if (!Number.isFinite(player.guardStartedAt)) player.guardStartedAt = 0;
      if (!Number.isFinite(player.guardCooldownUntil)) player.guardCooldownUntil = 0;
      if (typeof player.defenseRequiresRelease !== "boolean") player.defenseRequiresRelease = false;
      // Server and client share a fixed platform lane; jumping is rendered only
      // as jumpHeight above this ground position.
      player.y = LIVE_ARENA_GROUND_Y;
      if (!Number.isFinite(player.energy)) player.energy = 100;
      if (!Number.isFinite(player.maxEnergy)) player.maxEnergy = 100;
      if (!Number.isFinite(player.jumpHeight)) player.jumpHeight = 0;
      if (!Number.isFinite(player.jumpUntil)) player.jumpUntil = 0;
      if (!Number.isFinite(player.nextAttackAt)) player.nextAttackAt = 0;
      if (!Number.isFinite(player.nextBaseAt)) player.nextBaseAt = 0;
      if (!Number.isFinite(player.nextSpecialAt)) player.nextSpecialAt = 0;
      if (!Number.isFinite(player.nextDashAt)) player.nextDashAt = 0;
      if (!Number.isFinite(player.nextJumpAt)) player.nextJumpAt = 0;
      if (!Array.isArray(player.landedPunchWindows)) player.landedPunchWindows = [];
    }
    if (isStarted && state.phase === "LOBBY" && battle.status === "IN_BATTLE") {
      const challengerDna = parseJSON(battle.challenger_dna, {});
      const opponentDna = parseJSON(battle.opponent_dna, {});
      const challengerExisting = state.players.challenger;
      const opponentExisting = state.players.opponent;
      state.players.challenger = fighterFromDna({
        id: invite.challenger_discord_id, username: invite.challenger_username, role: "challenger",
        dna: challengerDna, hp: battle.challenger_hp, connected: challengerExisting.connected, tokenId: invite.challenger_token_id,
      });
      state.players.opponent = fighterFromDna({
        id: invite.opponent_discord_id, username: invite.opponent_username, role: "opponent",
        dna: opponentDna, hp: battle.opponent_hp, connected: opponentExisting.connected, tokenId: invite.opponent_token_id,
      });
      state.phase = "IN_BATTLE";
      state.status = "IN_BATTLE";
      state.startedAt = Date.now();
      state.lastTick = Date.now();
      state.round = 1;
      state.totalRounds = TOTAL_ROUNDS;
      state.roundTimeMs = ROUND_TIME_MS;
      state.timeRemainingMs = ROUND_TIME_MS;
      state.roundStartedAt = Date.now();
      state.roundWins = { challenger: 0, opponent: 0 };
      state.roundWinnerRole = null;
      state.roundResultUntil = 0;
      state.koRole = null;
      state.matchDraw = false;
      state.projectiles = [];
      state.log.push({ text: "Round 1/3 begins. Each round lasts 60 seconds.", at: Date.now() });
    } else if (battle?.status === "FINISHED") {
      state.phase = "FINISHED";
      state.status = "FINISHED";
      state.winnerDiscordId = battle.winner_discord_id;
      if (state.players.challenger?.hp == null || state.players.opponent?.hp == null) {
        state.players.challenger = fighterFromDna({ id: invite.challenger_discord_id, username: invite.challenger_username, role: "challenger", dna: battle.challenger_dna, hp: battle.challenger_hp, tokenId: invite.challenger_token_id });
        state.players.opponent = fighterFromDna({ id: invite.opponent_discord_id, username: invite.opponent_username, role: "opponent", dna: battle.opponent_dna, hp: battle.opponent_hp, tokenId: invite.opponent_token_id });
      }
    }
    return state;
  }

  async _readState() {
    if (this.cachedState) return this.cachedState;
    this.cachedState = await this.ctx.storage.get("arenaState") || null;
    return this.cachedState;
  }

  async _persist(state, force = false) {
    state.updatedAt = Date.now();
    this.cachedState = state;
    if (force || state.updatedAt - this.lastPersist >= 250) {
      await this.ctx.storage.put("arenaState", state);
      this.lastPersist = state.updatedAt;
    }
  }

  _broadcast(state) {
    if (!state) return;
    const publicState = {
      inviteId: state.inviteId,
      phase: state.phase,
      status: state.status,
      inviteStatus: state.inviteStatus,
      updatedAt: state.updatedAt,
      startedAt: state.startedAt,
      round: state.round || 1,
      totalRounds: state.totalRounds || TOTAL_ROUNDS,
      timeRemainingMs: state.phase === "IN_BATTLE"
        ? Math.max(0, ROUND_TIME_MS - (Date.now() - Number(state.roundStartedAt || Date.now())))
        : Math.max(0, Number(state.timeRemainingMs || 0)),
      roundWins: state.roundWins || { challenger: 0, opponent: 0 },
      roundWinnerRole: state.roundWinnerRole || null,
      roundResultUntil: state.roundResultUntil || 0,
      koRole: state.koRole || null,
      matchDraw: Boolean(state.matchDraw),
      forfeitRole: state.forfeitRole || null,
      projectiles: (state.projectiles || []).map((projectile) => ({
        id: projectile.id,
        ownerRole: projectile.ownerRole,
        slot: projectile.slot,
        x: projectile.x,
        y: projectile.y,
        radius: projectile.radius,
        expiresAt: projectile.expiresAt,
      })),
      winnerRole: state.winnerDiscordId === state.players.challenger?.discordId ? "challenger" : state.winnerDiscordId === state.players.opponent?.discordId ? "opponent" : null,
      winnerUsername: state.winnerDiscordId === state.players.challenger?.discordId ? state.players.challenger?.username : state.winnerDiscordId === state.players.opponent?.discordId ? state.players.opponent?.username : null,
      players: {},
      log: (state.log || []).slice(-MAX_LOG),
    };
    for (const role of ["challenger", "opponent"]) {
      const p = state.players[role] || {};
      publicState.players[role] = {
        username: p.username,
        tokenId: p.tokenId,
        fighterName: p.fighterName,
        connected: Boolean(p.connected),
        x: p.x,
        y: p.y,
        facing: p.facing,
        action: p.actionUntil > Date.now() ? p.action : "idle",
        actionStartedAt: p.actionStartedAt,
        actionUntil: p.actionUntil,
        hp: p.hp,
        maxHp: p.maxHp,
        energy: p.energy,
        maxEnergy: p.maxEnergy,
        jumpHeight: p.jumpHeight || 0,
        guarding: Boolean(p.guarding),
        guardCooldownRemainingMs: Math.max(0, Number(p.guardCooldownUntil || 0) - Date.now()),
        attack: p.attack,
        defense: p.defense,
        speed: p.speed,
        tier: p.tier,
        ability: p.ability,
        flashUntil: p.flashUntil,
      };
    }
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment();
      try { socket.send(JSON.stringify({ type: "state", state: publicState, viewerRole: attachment?.role })); }
      catch { /* closed sockets are removed by webSocketClose */ }
    }
  }

  _step(state, now) {
    const dt = clamp((now - Number(state.lastTick || now)) / 1000, 0, 0.08);
    state.lastTick = now;
    if (state.status !== "IN_BATTLE" || state.phase !== "IN_BATTLE") return;

    state.timeRemainingMs = Math.max(0, ROUND_TIME_MS - (now - Number(state.roundStartedAt || now)));
    for (const role of ["challenger", "opponent"]) {
      const p = state.players[role];
      if (!p) continue;

      // Defense is authoritative, held for at most 10 seconds, then locked
      // until release; releasing early starts the same two-second cooldown.
      updateHeldDefense(p, Boolean(p.defendRequested), now);

      // MP regenerates on the server and is replicated to both players.
      p.energy = clamp(Number(p.energy ?? 100) + dt, 0, Number(p.maxEnergy || 100));

      if (now < Number(p.jumpUntil || 0)) {
        const duration = Math.max(1, p.jumpUntil - p.jumpStartedAt);
        const progress = clamp((now - p.jumpStartedAt) / duration, 0, 1);
        p.jumpHeight = Math.sin(Math.PI * progress) * 52;
      } else {
        p.jumpHeight = 0;
        if (p.action === "jump" && now >= p.actionUntil) p.action = "idle";
      }

      const ix = Number(p.input?.x || 0);
      const speed = 160 + p.speed * 2.2;
      p.x = clamp(p.x + Math.sign(ix) * speed * dt, ARENA_LEFT, ARENA_RIGHT);
      // This is a side-view fighter. W/S and the up/down pad must not push
      // the rig through the platform; jumps use the separate jumpHeight arc.
      p.y = LIVE_ARENA_GROUND_Y;
    }

    const a = state.players.challenger;
    const b = state.players.opponent;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 0 && dist < MIN_FIGHTER_DISTANCE) {
      const overlap = (MIN_FIGHTER_DISTANCE - dist) / 2;
      const nx = dx / dist;
      const ny = dy / dist;
      a.x = clamp(a.x - nx * overlap, ARENA_LEFT, ARENA_RIGHT);
      a.y = clamp(a.y - ny * overlap, ARENA_TOP, ARENA_BOTTOM);
      b.x = clamp(b.x + nx * overlap, ARENA_LEFT, ARENA_RIGHT);
      b.y = clamp(b.y + ny * overlap, ARENA_TOP, ARENA_BOTTOM);
    }

    // Keep grounded, uncommitted fighters facing the rival. If the opponent
    // remains in front, opposite input is a backstep. If they get behind,
    // turn toward them instead of continuing to face away.
    for (const role of ["challenger", "opponent"]) {
      const fighter = state.players[role];
      const rival = state.players[role === "challenger" ? "opponent" : "challenger"];
      if (!fighter || !rival || now < Number(fighter.jumpUntil || 0)
        || Number(fighter.actionUntil || 0) > now) continue;
      const horizontalDelta = Number(rival.x) - Number(fighter.x);
      if (horizontalDelta && horizontalDelta * Number(fighter.facing || 0) < 0) {
        fighter.facing = Math.sign(horizontalDelta);
      }
    }

    this._stepPendingAttacks(state, now);
    this._stepPunchWindows(state, now);
    this._stepProjectiles(state, dt, now);
  }

  _attack(state, role, action) {
    const now = Date.now();
    const attacker = state.players[role];
    const targetRole = role === "challenger" ? "opponent" : "challenger";
    const target = state.players[targetRole];
    if (!attacker || !target || attacker.hp <= 0 || target.hp <= 0) return;

    const kind = action === true || action === "special" ? "special"
      : action === "base" ? "base"
        : action === "doubleAttack" ? "doubleAttack"
          : "attack";
    const isMelee = kind === "attack" || kind === "doubleAttack";
    const cooldownField = kind === "base" ? "nextBaseAt"
      : kind === "special" ? "nextSpecialAt"
        : "nextAttackAt";
    const cooldown = kind === "base" ? BASE_COOLDOWN_MS
      : kind === "special" ? SPECIAL_COOLDOWN_MS
        : BASIC_COOLDOWN_MS;
    const cost = kind === "base" ? 10 : kind === "special" ? 35 : 5;

    if (now < Number(attacker[cooldownField] || 0)) return;
    if (Number(attacker.energy ?? 100) < cost) {
      state.log.push({ text: "@" + attacker.username + " does not have enough MP.", at: now });
      this._trimLog(state);
      return;
    }

    attacker.energy = Math.max(0, Number(attacker.energy ?? 100) - cost);
    attacker[cooldownField] = now + cooldown;
    attacker.action = kind;
    attacker.actionStartedAt = now;
    const windupMs = kind === "base" ? 300 : kind === "special" ? 440 : 0;
    attacker.actionUntil = now + (kind === "doubleAttack" ? 520 : kind === "attack" ? 280 : windupMs + 300);
    attacker.pendingAttack = windupMs > 0 ? {
      slot: kind,
      releaseAt: now + windupMs,
      direction: Math.sign(Number(attacker.facing) || 0) || (role === "challenger" ? 1 : -1),
    } : null;
    attacker.flashUntil = now + 140;
    attacker.landedPunchWindows = [];

    if (isMelee) {
      if (!isTargetInFront(attacker.x, target.x, attacker.facing)) {
        state.log.push({ text: "@" + attacker.username + " attacked away from their opponent.", at: now });
        this._trimLog(state);
      }
      return;
    }

    state.log.push({
      text: "@" + attacker.username + " is charging " + (kind === "special" ? attacker.ability : "their base attack") + ".",
      at: now,
    });
    this._trimLog(state);
  }

  _stepPendingAttacks(state, now) {
    for (const role of ["challenger", "opponent"]) {
      const attacker = state.players[role];
      const pending = attacker?.pendingAttack;
      if (!pending || now < Number(pending.releaseAt || 0)) continue;
      attacker.pendingAttack = null;
      if (attacker.hp <= 0 || attacker.action !== pending.slot) continue;

      const direction = Math.sign(Number(pending.direction) || 0) || (role === "challenger" ? 1 : -1);
      const projectile = {
        id: role + "-" + now + "-" + state.projectiles.length,
        ownerRole: role,
        slot: pending.slot,
        x: attacker.x + direction * 38,
        y: attacker.y,
        vx: direction * (pending.slot === "special" ? 600 : 500),
        vy: 0,
        radius: pending.slot === "special" ? 15 : 11,
        height: 0,
        createdAt: now,
        expiresAt: now + 2400,
      };
      state.projectiles.push(projectile);
      state.log.push({
        text: "@" + attacker.username + " released " + (pending.slot === "special" ? attacker.ability : "their base projectile") + ".",
        at: now,
      });
      this._trimLog(state);
    }
  }

  _applyDamage(state, role, slot, now) {
    const attacker = state.players[role];
    const targetRole = role === "challenger" ? "opponent" : "challenger";
    const target = state.players[targetRole];
    if (!attacker || !target || attacker.hp <= 0 || target.hp <= 0) return false;
    const raw = slot === "special" ? attacker.attack * 1.05
      : slot === "base" ? attacker.attack * 0.86
        : attacker.attack * 0.62;
    const unblockedDamage = Math.max(4, Math.round(raw - target.defense * 0.16 + randomInt(-2, 3)));
    const blockPercent = target.guarding ? getGuardBlockPercent(target.tier) : 0;
    const damage = Math.max(0, Math.round(unblockedDamage * (1 - blockPercent / 100)));
    target.hp = Math.max(0, target.hp - damage);
    target.flashUntil = now + 230;

    // A real hit knocks an airborne fighter down immediately instead of
    // allowing the original jump arc to continue. Hits also cancel a base or
    // special that has not released yet; its MP was paid at startup and stays spent.
    const wasAirborne = Number(target.jumpUntil || 0) > now || Number(target.jumpHeight || 0) > 0;
    const pending = target.pendingAttack;
    const interruptedCharge = pending && now < Number(pending.releaseAt || 0);
    if (wasAirborne || interruptedCharge) {
      target.jumpUntil = now;
      target.jumpHeight = 0;
      target.pendingAttack = null;
      target.action = "hitstun";
      target.actionStartedAt = now;
      target.actionUntil = now + 260;
      target.input = { x: 0, y: 0 };
      if (interruptedCharge) {
        state.log.push({
          text: "@" + target.username + "'s " + pending.slot + " attack was interrupted; the MP is lost.",
          at: now,
        });
      }
    }
    state.log.push({
      text: "@" + attacker.username + " " + (
        slot === "special" ? "hit with " + attacker.ability
          : slot === "base" ? "landed a base projectile hit"
            : "landed a punch"
      ) + " for " + damage + " damage.",
      at: now,
    });
    this._trimLog(state);
    return true;
  }

  _stepPunchWindows(state, now) {
    for (const role of ["challenger", "opponent"]) {
      const attacker = state.players[role];
      if (!attacker || attacker.hp <= 0) continue;
      const targetRole = role === "challenger" ? "opponent" : "challenger";
      const target = state.players[targetRole];
      const isCombo = attacker.action === "doubleAttack";
      if (!isCombo && attacker.action !== "attack") continue;
      const age = now - Number(attacker.actionStartedAt || 0);
      const windows = isCombo ? [[55, 145], [250, 335]] : [[65, 150]];
      for (let index = 0; index < windows.length; index += 1) {
        const window = windows[index];
        if (age < window[0] || age > window[1] || attacker.landedPunchWindows.includes(index)) continue;
        attacker.landedPunchWindows.push(index);
        if (!isTargetInFront(attacker.x, target.x, attacker.facing)) {
          state.log.push({ text: "@" + attacker.username + " missed with a punch facing the wrong way.", at: now });
          this._trimLog(state);
          continue;
        }
        if (!isWithinPunchHitbox(attacker, target)) {
          state.log.push({ text: "@" + attacker.username + " punched but missed the hitbox.", at: now });
          this._trimLog(state);
          continue;
        }
        this._applyDamage(state, role, "basic", now);
      }
    }
  }

  _stepProjectiles(state, dt, now) {
    for (let index = state.projectiles.length - 1; index >= 0; index -= 1) {
      const projectile = state.projectiles[index];
      projectile.x += Number(projectile.vx || 0) * dt;
      projectile.y += Number(projectile.vy || 0) * dt;
      const targetRole = projectile.ownerRole === "challenger" ? "opponent" : "challenger";
      const target = state.players[targetRole];

      if (target && projectileOverlapsFighter(projectile, target)) {
        if (projectileIsDodgedByJump(projectile, target)) {
          state.log.push({ text: "@" + target.username + " jumped over a projectile.", at: now });
          this._trimLog(state);
        } else {
          this._applyDamage(state, projectile.ownerRole, projectile.slot, now);
        }
        state.projectiles.splice(index, 1);
        continue;
      }

      if (now >= projectile.expiresAt || projectile.x < ARENA_LEFT - 60 || projectile.x > ARENA_RIGHT + 60) {
        state.projectiles.splice(index, 1);
      }
    }
  }

  _jump(state, role, now) {
    const player = state.players[role];
    if (!player || player.hp <= 0 || now < Number(player.nextJumpAt || 0)) return;
    player.nextJumpAt = now + JUMP_COOLDOWN_MS;
    player.jumpStartedAt = now;
    player.jumpUntil = now + 650;
    player.jumpHeight = 0;
    player.action = "jump";
    player.actionStartedAt = now;
    player.actionUntil = player.jumpUntil;
    state.log.push({ text: "@" + player.username + " jumped.", at: now });
    this._trimLog(state);
  }

  _dash(state, role, now) {
    const p = state.players[role];
    if (!p || now < p.nextDashAt || p.hp <= 0) return;
    p.nextDashAt = now + DASH_COOLDOWN_MS;
    p.action = "dash";
    p.actionStartedAt = now;
    p.actionUntil = now + 230;
    let dx = Number(p.input?.x || 0);
    let dy = Number(p.input?.y || 0);
    if (dx === 0 && dy === 0) dx = p.role === "challenger" ? 1 : -1;
    const length = Math.hypot(dx, dy) || 1;
    p.x = clamp(p.x + dx / length * 84, ARENA_LEFT, ARENA_RIGHT);
    p.y = clamp(p.y + dy / length * 84, ARENA_TOP, ARENA_BOTTOM);
    p.flashUntil = now + 140;
    state.log.push({ text: "@" + p.username + " dashed.", at: now });
    this._trimLog(state);
  }

  async _resolveMatch(state, now) {
    if (state.status !== "IN_BATTLE") return;

    if (state.phase === "ROUND_OVER") {
      if (now < Number(state.roundResultUntil || 0)) return;
      if (state.round >= TOTAL_ROUNDS) {
        const wins = state.roundWins || { challenger: 0, opponent: 0 };
        const winningRole = wins.challenger === wins.opponent
          ? null
          : wins.challenger > wins.opponent ? "challenger" : "opponent";
        state.matchDraw = winningRole === null;
        state.winnerDiscordId = winningRole ? state.players[winningRole].discordId : null;
        state.phase = "FINISHED";
        state.status = "FINISHED";
        for (const p of Object.values(state.players)) updateHeldDefense(p, false, now);
        state.log.push({
          text: state.matchDraw
            ? "The three-round match ended in a draw."
            : "@" + state.players[winningRole].username + " won the match " + wins.challenger + "-" + wins.opponent + ".",
          at: now,
        });
        this._trimLog(state);
        const updatedAt = new Date().toISOString();
        await this.env.CHOG_DB.prepare("UPDATE chog_battles SET status = 'FINISHED', challenger_hp = ?1, opponent_hp = ?2, winner_discord_id = ?3, battle_log = ?4, version = version + 1, updated_at = ?5 WHERE invite_id = ?6 AND status = 'IN_BATTLE'")
          .bind(state.players.challenger.hp, state.players.opponent.hp, state.winnerDiscordId, JSON.stringify(state.log), updatedAt, state.inviteId).run();
        await this.env.CHOG_DB.prepare("UPDATE chog_challenge_invites SET status = 'RESULT_PENDING', updated_at = ?1 WHERE id = ?2 AND status = 'IN_BATTLE'")
          .bind(updatedAt, state.inviteId).run();
        return;
      }

      state.round += 1;
      state.phase = "IN_BATTLE";
      state.roundStartedAt = now;
      state.lastTick = now;
      state.timeRemainingMs = ROUND_TIME_MS;
      state.roundWinnerRole = null;
      state.koRole = null;
      state.roundResultUntil = 0;
      state.projectiles = [];
      for (const role of ["challenger", "opponent"]) {
        const p = state.players[role];
        p.hp = p.maxHp;
        p.energy = p.maxEnergy;
        p.x = role === "challenger" ? 280 : 680;
        p.y = LIVE_ARENA_GROUND_Y;
        p.vx = 0;
        p.vy = 0;
        updateHeldDefense(p, false, now);
        p.defendRequested = false;
        p.input = { x: 0, y: 0 };
        p.facing = role === "challenger" ? 1 : -1;
        p.nextAttackAt = 0;
        p.nextBaseAt = 0;
        p.nextSpecialAt = 0;
        p.nextDashAt = 0;
        p.nextJumpAt = 0;
        p.jumpStartedAt = 0;
        p.jumpUntil = 0;
        p.jumpHeight = 0;
        p.pendingAttack = null;
        p.action = "idle";
        p.actionStartedAt = now;
        p.actionUntil = 0;
        p.landedPunchWindows = [];
      }
      state.log.push({ text: "Round " + state.round + "/" + TOTAL_ROUNDS + " begins. Each round lasts 60 seconds.", at: now });
      this._trimLog(state);
      return;
    }

    if (state.phase !== "IN_BATTLE") return;
    const challenger = state.players.challenger;
    const opponent = state.players.opponent;
    const challengerDown = challenger.hp <= 0;
    const opponentDown = opponent.hp <= 0;
    const timeUp = state.timeRemainingMs <= 0;
    if (!challengerDown && !opponentDown && !timeUp) return;

    let winnerRole = null;
    if (challengerDown !== opponentDown) winnerRole = challengerDown ? "opponent" : "challenger";
    else if (!challengerDown && !opponentDown && challenger.hp !== opponent.hp) {
      winnerRole = challenger.hp > opponent.hp ? "challenger" : "opponent";
    }

    state.phase = "ROUND_OVER";
    state.roundWinnerRole = winnerRole;
    state.koRole = challengerDown && opponentDown ? "both"
      : challengerDown ? "challenger"
        : opponentDown ? "opponent" : null;
    state.roundResultUntil = now + ROUND_INTERMISSION_MS;
    state.projectiles = [];
    for (const role of ["challenger", "opponent"]) {
      state.players[role].input = { x: 0, y: 0 };
      state.players[role].jumpHeight = 0;
      state.players[role].jumpUntil = 0;
    }
    if (winnerRole) state.roundWins[winnerRole] = Number(state.roundWins[winnerRole] || 0) + 1;

    const score = state.roundWins.challenger + "-" + state.roundWins.opponent;
    const message = state.koRole
      ? state.koRole === "both" ? "Double K.O.! Round " + state.round + " is a draw."
        : "K.O.! @" + state.players[winnerRole].username + " wins round " + state.round + "."
      : winnerRole ? "@" + state.players[winnerRole].username + " wins round " + state.round + " on HP."
        : "Round " + state.round + " is a draw on time.";
    state.log.push({ text: message + " Score " + score + ".", at: now });
    this._trimLog(state);
  }
  _trimLog(state) {
    if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
  }
}
