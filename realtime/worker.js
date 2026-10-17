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
const MIN_FIGHTER_DISTANCE = 42;
const MAX_LOG = 60;

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function parseJSON(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}
function randomInt(min, max) {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return min + (values[0] % (max - min + 1));
}
function fighterFromDna({ id, username, role, dna, hp, connected, x, y }) {
  const parsed = typeof dna === "string" ? parseJSON(dna, {}) : (dna || {});
  const stats = parsed.stats || {};
  const maxHp = Math.max(1, Number(stats.maxHp || hp || 100));
  return {
    discordId: id,
    username: username || (role === "challenger" ? "Challenger" : "Opponent"),
    role,
    connected: Boolean(connected),
    x: x ?? (role === "challenger" ? 170 : 790),
    y: y ?? 270,
    vx: 0,
    vy: 0,
    hp: clamp(Number(hp ?? maxHp), 0, maxHp),
    maxHp,
    attack: clamp(Number(stats.attack || 20), 5, 45),
    defense: clamp(Number(stats.defense || 14), 0, 40),
    speed: clamp(Number(stats.speed || 14), 8, 28),
    tier: String(parsed.tier || "Common"),
    ability: String(parsed.ability || "Focused Strike"),
    input: { x: 0, y: 0 },
    facing: role === "challenger" ? 1 : -1,
    nextAttackAt: 0,
    nextSpecialAt: 0,
    nextDashAt: 0,
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
    if (!["PENDING_ACCEPTANCE", "TERMS_ACCEPTED", "READY", "IN_BATTLE", "RESULT_PENDING", "CONDITION_PENDING", "CONDITION_FULFILLED"].includes(invite.status)) {
      return json({ error: "This lobby is no longer active." }, 409);
    }
    const battle = await this.env.CHOG_DB.prepare("SELECT * FROM chog_battles WHERE invite_id = ?1 LIMIT 1").bind(claims.inviteId).first();
    const state = await this._refreshState(invite, battle);
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
    this._trimLog(state);
    await this._persist(state, true);
    this._broadcast(state);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket, rawMessage) {
    const attachment = socket.deserializeAttachment();
    if (!attachment?.inviteId || !attachment.role) return;
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
        player.username = attachment.username || player.username;
      }
      await this._persist(state, true);
      this._broadcast(state);
      return;
    }

    if (message.type === "input" && state.phase === "IN_BATTLE" && state.status === "IN_BATTLE") {
      this._step(state, Date.now());
      const player = state.players[attachment.role];
      if (!player || player.discordId !== attachment.discordId) return;
      const inputX = Number(message.x);
      const inputY = Number(message.y);
      player.input = {
        x: Number.isFinite(inputX) ? clamp(Math.sign(inputX), -1, 1) : 0,
        y: Number.isFinite(inputY) ? clamp(Math.sign(inputY), -1, 1) : 0,
      };
      if (player.input.x !== 0) player.facing = player.input.x;
      if (message.action === "attack") this._attack(state, attachment.role, false);
      else if (message.action === "special") this._attack(state, attachment.role, true);
      else if (message.action === "dash") this._dash(state, attachment.role, Date.now());
      await this._checkWinner(state);
      await this._persist(state, state.status === "FINISHED");
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
    state.log.push({ text: `@${state.players[attachment.role].username} disconnected.`, at: Date.now() });
    this._trimLog(state);
    await this._persist(state, true);
    this._broadcast(state);
  }

  async webSocketError(socket) {
    await this.webSocketClose(socket);
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
    state.players.challenger.discordId = invite.challenger_discord_id;
    state.players.challenger.username = invite.challenger_username || "Challenger";
    state.players.opponent.discordId = invite.opponent_discord_id;
    state.players.opponent.username = invite.opponent_username || String(invite.opponent_discord_id).replace("username:", "@");
    for (const role of ["challenger", "opponent"]) {
      const sockets = this.ctx.getWebSockets(role);
      state.players[role].connected = sockets.length > 0;
    }
    if (isStarted && state.phase === "LOBBY" && battle.status === "IN_BATTLE") {
      const challengerDna = parseJSON(battle.challenger_dna, {});
      const opponentDna = parseJSON(battle.opponent_dna, {});
      const challengerExisting = state.players.challenger;
      const opponentExisting = state.players.opponent;
      state.players.challenger = fighterFromDna({
        id: invite.challenger_discord_id, username: invite.challenger_username, role: "challenger",
        dna: challengerDna, hp: battle.challenger_hp, connected: challengerExisting.connected,
      });
      state.players.opponent = fighterFromDna({
        id: invite.opponent_discord_id, username: invite.opponent_username, role: "opponent",
        dna: opponentDna, hp: battle.opponent_hp, connected: opponentExisting.connected,
      });
      state.phase = "IN_BATTLE";
      state.status = "IN_BATTLE";
      state.startedAt = Date.now();
      state.lastTick = Date.now();
      state.log.push({ text: "The live battle has started. Move, dash, and attack in real time.", at: Date.now() });
    } else if (battle?.status === "FINISHED") {
      state.phase = "FINISHED";
      state.status = "FINISHED";
      state.winnerDiscordId = battle.winner_discord_id;
      if (state.players.challenger?.hp == null || state.players.opponent?.hp == null) {
        state.players.challenger = fighterFromDna({ id: invite.challenger_discord_id, username: invite.challenger_username, role: "challenger", dna: battle.challenger_dna, hp: battle.challenger_hp });
        state.players.opponent = fighterFromDna({ id: invite.opponent_discord_id, username: invite.opponent_username, role: "opponent", dna: battle.opponent_dna, hp: battle.opponent_hp });
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
      winnerRole: state.winnerDiscordId === state.players.challenger?.discordId ? "challenger" : state.winnerDiscordId === state.players.opponent?.discordId ? "opponent" : null,
      winnerUsername: state.winnerDiscordId === state.players.challenger?.discordId ? state.players.challenger?.username : state.winnerDiscordId === state.players.opponent?.discordId ? state.players.opponent?.username : null,
      players: {},
      log: (state.log || []).slice(-MAX_LOG),
    };
    for (const role of ["challenger", "opponent"]) {
      const p = state.players[role] || {};
      publicState.players[role] = {
        username: p.username,
        connected: Boolean(p.connected),
        x: p.x,
        y: p.y,
        hp: p.hp,
        maxHp: p.maxHp,
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
    if (dt <= 0 || state.phase !== "IN_BATTLE" || state.status !== "IN_BATTLE") return;
    for (const role of ["challenger", "opponent"]) {
      const p = state.players[role];
      if (!p) continue;
      const ix = Number(p.input?.x || 0);
      const iy = Number(p.input?.y || 0);
      const length = Math.hypot(ix, iy) || 1;
      const speed = 160 + p.speed * 2.2;
      p.x = clamp(p.x + (ix / length) * speed * dt, ARENA_MARGIN + 15, MAP_W - ARENA_MARGIN - 15);
      p.y = clamp(p.y + (iy / length) * speed * dt, ARENA_MARGIN + 55, MAP_H - ARENA_MARGIN - 15);
    }
    const a = state.players.challenger;
    const b = state.players.opponent;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 0 && dist < MIN_FIGHTER_DISTANCE) {
      const overlap = (MIN_FIGHTER_DISTANCE - dist) / 2;
      const nx = dx / dist; const ny = dy / dist;
      a.x = clamp(a.x - nx * overlap, ARENA_MARGIN + 15, MAP_W - ARENA_MARGIN - 15);
      a.y = clamp(a.y - ny * overlap, ARENA_MARGIN + 55, MAP_H - ARENA_MARGIN - 15);
      b.x = clamp(b.x + nx * overlap, ARENA_MARGIN + 15, MAP_W - ARENA_MARGIN - 15);
      b.y = clamp(b.y + ny * overlap, ARENA_MARGIN + 55, MAP_H - ARENA_MARGIN - 15);
    }
  }

  _attack(state, role, special) {
    const now = Date.now();
    const attacker = state.players[role];
    const target = state.players[role === "challenger" ? "opponent" : "challenger"];
    if (!attacker || !target || attacker.hp <= 0 || target.hp <= 0) return;
    if (special) {
      if (now < attacker.nextSpecialAt) return;
      attacker.nextSpecialAt = now + 1800;
    } else {
      if (now < attacker.nextAttackAt) return;
      attacker.nextAttackAt = now + 420;
    }
    const dist = Math.hypot(target.x - attacker.x, target.y - attacker.y);
    const range = special ? 128 : 88;
    attacker.flashUntil = now + 180;
    if (dist > range) {
      state.log.push({ text: `@${attacker.username} swung and missed.`, at: now });
      this._trimLog(state);
      return;
    }
    const raw = special ? attacker.attack * 1.05 : attacker.attack * 0.62;
    const damage = Math.max(4, Math.round(raw - target.defense * 0.16 + randomInt(-2, 3)));
    target.hp = Math.max(0, target.hp - damage);
    target.flashUntil = now + 230;
    state.log.push({ text: `@${attacker.username} ${special ? "used " + attacker.ability : "landed a hit"} for ${damage} damage.`, at: now });
    this._trimLog(state);
  }

  _dash(state, role, now) {
    const p = state.players[role];
    if (!p || now < p.nextDashAt || p.hp <= 0) return;
    p.nextDashAt = now + 1100;
    let dx = Number(p.input?.x || 0);
    let dy = Number(p.input?.y || 0);
    if (dx === 0 && dy === 0) dx = p.role === "challenger" ? 1 : -1;
    const length = Math.hypot(dx, dy) || 1;
    p.x = clamp(p.x + dx / length * 84, ARENA_MARGIN + 15, MAP_W - ARENA_MARGIN - 15);
    p.y = clamp(p.y + dy / length * 84, ARENA_MARGIN + 55, MAP_H - ARENA_MARGIN - 15);
    p.flashUntil = now + 140;
    state.log.push({ text: `@${p.username} dashed.`, at: now });
    this._trimLog(state);
  }

  async _checkWinner(state) {
    if (state.status !== "IN_BATTLE") return;
    let winner = null;
    if (state.players.challenger.hp <= 0) winner = state.players.opponent;
    else if (state.players.opponent.hp <= 0) winner = state.players.challenger;
    if (!winner) return;
    state.status = "FINISHED";
    state.phase = "FINISHED";
    state.winnerDiscordId = winner.discordId;
    state.log.push({ text: `@${winner.username} won the match.`, at: Date.now() });
    this._trimLog(state);
    const now = new Date().toISOString();
    await this.env.CHOG_DB.prepare(`UPDATE chog_battles SET status = 'FINISHED', challenger_hp = ?1, opponent_hp = ?2,
      winner_discord_id = ?3, battle_log = ?4, version = version + 1, updated_at = ?5
      WHERE invite_id = ?6 AND status = 'IN_BATTLE'`)
      .bind(state.players.challenger.hp, state.players.opponent.hp, winner.discordId, JSON.stringify(state.log), now, state.inviteId).run();
    await this.env.CHOG_DB.prepare("UPDATE chog_challenge_invites SET status = 'RESULT_PENDING', updated_at = ?1 WHERE id = ?2 AND status = 'IN_BATTLE'")
      .bind(now, state.inviteId).run();
  }

  _trimLog(state) {
    if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
  }
}
