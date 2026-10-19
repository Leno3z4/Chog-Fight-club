import { readDiscordSession } from "./discordAuth.js";

const CHOG_CONTRACT = "0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763";
const DEFAULT_RPC = "https://rpc.monad.xyz";
const MAX_LOG_ENTRIES = 80;

export class BattleApiError extends Error {
  constructor(message, { status = 500, code = "BATTLE_ERROR" } = {}) {
    super(message);
    this.name = "BattleApiError";
    this.status = status;
    this.code = code;
  }
}

function getDb(env) {
  if (!env?.CHOG_DB || typeof env.CHOG_DB.prepare !== "function") {
    throw new BattleApiError("Cloudflare D1 is not configured. Apply migrations 0001, 0002, and 0003.", {
      status: 503, code: "D1_NOT_CONFIGURED",
    });
  }
  return env.CHOG_DB;
}
function validId(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function safeJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}
function randomInt(min, max) {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return min + (bytes[0] % (max - min + 1));
}
function normalizeAttributes(nft) {
  const metadata = nft?.nft?.metadata || nft?.metadata || {};
  const attributes = Array.isArray(metadata.attributes) ? metadata.attributes
    : Array.isArray(nft?.nft?.traits) ? nft.nft.traits
      : Array.isArray(nft?.traits) ? nft.traits : [];
  const traits = { ...metadata };
  for (const item of attributes) {
    const key = String(item?.trait_type || item?.key || item?.name || "").trim();
    if (key) traits[key] = item?.value ?? item?.trait_value ?? "";
  }
  return traits;
}
const PROTOTYPE_METADATA = {
  "prototype:ember": { name: "Ember", Tier: "Rare", Aura: "Fire", Skin: "Red", Body: "Toad", Eyes: "Angry" },
  "prototype:tide": { name: "Tide", Tier: "Uncommon", Aura: "Water", Skin: "Blue", Body: "Toad", Eyes: "Happy" },
  "prototype:volt": { name: "Volt", Tier: "Epic", Aura: "Electric", Skin: "Yellow", Body: "Tuxedo", Eyes: "Angry" },
};
function abilityFromTraits(meta) {
  const signal = `${meta.Aura || ""} ${meta.Background || ""} ${meta.Skin || ""}`.toLowerCase();
  if (/fire|flame|ember|red/.test(signal)) return "Ember Strike";
  if (/water|aqua|blue|ice/.test(signal)) return "Pressure Wave";
  if (/electric|shock|lightning|yellow/.test(signal)) return "Static Snap";
  if (/shadow|smoke|dark|purple/.test(signal)) return "Shadow Feint";
  if (/green|nature|leaf/.test(signal)) return "Thorn Rush";
  return "Focused Strike";
}
export function buildCombatDNA(metadata = {}) {
  const tier = String(metadata.Tier || metadata.Rarity || "Common");
  const bonuses = { Common: 0, Uncommon: 2, Rare: 4, Epic: 6, Legendary: 8, Mythic: 10 };
  const bonus = bonuses[tier] ?? 0;
  const stats = {
    maxHp: 100 + bonus * 2,
    attack: 20 + bonus,
    defense: 14 + bonus,
    speed: 14 + Math.floor(bonus / 2),
  };
  if (metadata.Body === "Toad") stats.maxHp += 8;
  if (metadata.Body === "Tuxedo" || metadata.Body === "White tuxedo") stats.defense += 3;
  if (metadata.Eyes === "Angry") stats.attack += 3;
  if (metadata.Skin === "Red") stats.attack += 2;
  if (metadata.Skin === "Blue") stats.defense += 2;
  if (metadata.Skin === "Green") stats.maxHp += 3;
  if (metadata.Skin === "Pink") stats.speed += 1;
  return { name: String(metadata.name || metadata.Name || "Chog"), tier, ability: abilityFromTraits(metadata), stats };
}
async function rpcCall(fetchImpl, env, data) {
  const response = await fetchImpl(env?.MONAD_RPC_URL || DEFAULT_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: CHOG_CONTRACT, data }, "latest"] }),
  });
  if (!response.ok) throw new BattleApiError("Monad RPC could not verify the selected Chog.", { status: 502, code: "RPC_FAILED" });
  const payload = await response.json();
  if (payload.error || !/^0x[0-9a-fA-F]{64}$/.test(payload.result || "")) {
    throw new BattleApiError("Could not verify current Chog ownership on Monad.", { status: 409, code: "CHOG_OWNERSHIP_UNVERIFIED" });
  }
  return "0x" + payload.result.slice(-40).toLowerCase();
}
async function verifyChogOwner(fetchImpl, env, tokenId, wallet) {
  if (!/^\d{1,78}$/.test(String(tokenId))) throw new BattleApiError("The selected Chog token ID is invalid.", { status: 400, code: "TOKEN_ID_INVALID" });
  const data = "0x6352211e" + BigInt(tokenId).toString(16).padStart(64, "0");
  const owner = await rpcCall(fetchImpl, env, data);
  if (owner !== String(wallet).toLowerCase()) {
    throw new BattleApiError("A selected Chog is no longer owned by the linked wallet.", { status: 409, code: "CHOG_OWNERSHIP_CHANGED" });
  }
}
async function fetchTokenUri(fetchImpl, env, tokenId) {
  const data = "0xc87b56dd" + BigInt(tokenId).toString(16).padStart(64, "0");
  const response = await fetchImpl(env?.MONAD_RPC_URL || DEFAULT_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: CHOG_CONTRACT, data }, "latest"] }),
  });
  if (!response.ok) throw new BattleApiError("Monad RPC could not read the selected Chog metadata URI.", { status: 502, code: "NFT_METADATA_RPC_FAILED" });
  const payload = await response.json();
  const result = String(payload?.result || "");
  if (payload.error || !/^0x[0-9a-fA-F]+$/.test(result)) {
    throw new BattleApiError("The selected Chog did not return a readable tokenURI.", { status: 502, code: "NFT_TOKEN_URI_UNAVAILABLE" });
  }
  const hex = result.slice(2);
  if (hex.length < 128) throw new BattleApiError("The selected Chog returned malformed tokenURI data.", { status: 502, code: "NFT_TOKEN_URI_INVALID" });
  const offset = Number(BigInt("0x" + hex.slice(0, 64)));
  if (!Number.isSafeInteger(offset) || offset < 32 || offset * 2 + 64 > hex.length) {
    throw new BattleApiError("The selected Chog returned malformed tokenURI data.", { status: 502, code: "NFT_TOKEN_URI_INVALID" });
  }
  const lengthStart = offset * 2;
  const length = Number(BigInt("0x" + hex.slice(lengthStart, lengthStart + 64)));
  const contentStart = lengthStart + 64;
  if (!Number.isSafeInteger(length) || length < 1 || length > 4096 || contentStart + length * 2 > hex.length) {
    throw new BattleApiError("The selected Chog returned an invalid metadata URI length.", { status: 502, code: "NFT_TOKEN_URI_INVALID" });
  }
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) bytes[i] = Number.parseInt(hex.slice(contentStart + i * 2, contentStart + i * 2 + 2), 16);
  return new TextDecoder().decode(bytes);
}

function metadataJsonFromDataUri(uri) {
  const comma = uri.indexOf(",");
  if (comma < 0) throw new BattleApiError("The Chog metadata data URI is malformed.", { status: 502, code: "NFT_METADATA_URI_INVALID" });
  const header = uri.slice(0, comma).toLowerCase();
  const payload = uri.slice(comma + 1);
  try {
    if (header.includes(";base64")) {
      const binary = atob(payload);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    }
    return JSON.parse(decodeURIComponent(payload));
  } catch {
    throw new BattleApiError("The Chog metadata data URI does not contain valid JSON.", { status: 502, code: "NFT_METADATA_JSON_INVALID" });
  }
}

function safeMetadataUrl(uri) {
  let value = String(uri || "").trim();
  if (value.startsWith("ipfs://")) {
    value = "https://ipfs.io/ipfs/" + value.slice("ipfs://".length).replace(/^ipfs\//i, "");
  } else if (value.startsWith("ar://")) {
    value = "https://arweave.net/" + value.slice("ar://".length);
  }
  let url;
  try { url = new URL(value); } catch {
    throw new BattleApiError("The Chog metadata URI is not a valid URL.", { status: 502, code: "NFT_METADATA_URI_INVALID" });
  }
  const host = url.hostname.toLowerCase();
  const ipv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
  if (url.protocol !== "https:" || url.username || url.password || !host.includes(".") || ipv4
    || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")
    || host === "metadata.google.internal" || host === "169.254.169.254") {
    throw new BattleApiError("The Chog metadata URI uses an unsafe or unsupported host.", { status: 502, code: "NFT_METADATA_URI_UNSAFE" });
  }
  return url;
}

async function fetchTokenMetadata(fetchImpl, env, tokenId) {
  const uri = await fetchTokenUri(fetchImpl, env, tokenId);
  if (uri.startsWith("data:application/json")) return metadataJsonFromDataUri(uri);
  const url = safeMetadataUrl(uri);
  const response = await fetchImpl(url.toString(), { headers: { accept: "application/json" }, redirect: "follow" });
  if (!response.ok) throw new BattleApiError("The Chog tokenURI metadata endpoint did not return a successful response.", { status: 502, code: "NFT_METADATA_FETCH_FAILED" });
  const finalUrl = safeMetadataUrl(response.url || url.toString());
  if (finalUrl.hostname !== url.hostname) {
    throw new BattleApiError("The Chog metadata endpoint redirected to a different host. Use an on-chain metadata URI with no cross-host redirects.", { status: 502, code: "NFT_METADATA_REDIRECT_REJECTED" });
  }
  const raw = await response.text();
  if (raw.length > 1_000_000) throw new BattleApiError("The Chog metadata response is too large.", { status: 502, code: "NFT_METADATA_TOO_LARGE" });
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed;
  } catch {
    throw new BattleApiError("The Chog tokenURI endpoint did not return valid JSON metadata.", { status: 502, code: "NFT_METADATA_JSON_INVALID" });
  }
}

async function fetchCombatDNA(fetchImpl, env, tokenId) {
  const prototype = PROTOTYPE_METADATA[String(tokenId)];
  if (prototype) return buildCombatDNA(prototype);

  const apiKey = String(env?.OPENSEA_API_KEY || "");
  if (apiKey) {
    const url = `https://api.opensea.io/api/v2/chain/monad/contract/${CHOG_CONTRACT}/nfts/${encodeURIComponent(tokenId)}`;
    const response = await fetchImpl(url, { headers: { accept: "application/json", "X-API-KEY": apiKey } });
    if (response.ok) return buildCombatDNA(normalizeAttributes(await response.json()));
    // Use the NFT's on-chain tokenURI as a fallback if OpenSea is unavailable or rate-limited.
  }

  try {
    return buildCombatDNA(normalizeAttributes(await fetchTokenMetadata(fetchImpl, env, tokenId)));
  } catch (error) {
    if (error instanceof BattleApiError) throw error;
    throw new BattleApiError("Could not load the selected Chog's metadata from OpenSea or its on-chain tokenURI.", { status: 502, code: "NFT_METADATA_UNAVAILABLE" });
  }
}

function publicBattle(row, invite, user) {
  if (!row) return { inviteId: invite.id, inviteStatus: invite.status, status: "WAITING_FOR_READY", battle: null };
  const isChallenger = user.discordId === invite.challenger_discord_id;
  const log = safeJson(row.battle_log, []);
  return {
    inviteId: invite.id,
    inviteStatus: invite.status,
    viewerRole: isChallenger ? "challenger" : "opponent",
    status: row.status,
    turnNumber: row.turn_number,
    yourTurn: row.status === "IN_BATTLE" && row.active_player_discord_id === user.discordId,
    challenger: {
      username: invite.challenger_username,
      tokenId: invite.challenger_token_id,
      hp: row.challenger_hp,
      energy: row.challenger_energy,
      guard: Boolean(row.challenger_guard),
      dna: safeJson(row.challenger_dna, null),
    },
    opponent: {
      username: invite.opponent_username,
      tokenId: invite.opponent_token_id,
      hp: row.opponent_hp,
      energy: row.opponent_energy,
      guard: Boolean(row.opponent_guard),
      dna: safeJson(row.opponent_dna, null),
    },
    winnerDiscordId: row.winner_discord_id,
    youWon: row.status === "FINISHED" ? row.winner_discord_id === user.discordId : null,
    version: row.version,
    log,
  };
}
async function loadParticipant({ db, inviteId, user }) {
  const invite = await db.prepare("SELECT * FROM chog_challenge_invites WHERE id = ?1 LIMIT 1").bind(inviteId).first();
  if (!invite) throw new BattleApiError("Challenge not found.", { status: 404, code: "INVITE_NOT_FOUND" });
  const isChallenger = invite.challenger_discord_id === user.discordId;
  const isOpponent = invite.opponent_discord_id === user.discordId;
  if (!isChallenger && !isOpponent) throw new BattleApiError("This battle belongs to another Discord account.", { status: 403, code: "BATTLE_FORBIDDEN" });
  const expectedWallet = isChallenger ? invite.challenger_wallet : invite.opponent_wallet;
  if (!user.walletAddress || !expectedWallet || user.walletAddress.toLowerCase() !== expectedWallet.toLowerCase()) {
    throw new BattleApiError("Connect the wallet linked to this challenge before entering the battle.", { status: 403, code: "BATTLE_WALLET_MISMATCH" });
  }
  if (!invite.opponent_token_id || !invite.opponent_terms_accepted) {
    throw new BattleApiError("Both players must accept the challenge and select their Chogs first.", { status: 409, code: "CHALLENGE_NOT_ACCEPTED" });
  }
  return { invite, isChallenger, isOpponent };
}

export async function handleBattleRequest({ method, url, cookieHeader, env, body = {}, fetchImpl = fetch }) {
  const session = await readDiscordSession({ cookieHeader, env });
  if (!session.authenticated) throw new BattleApiError("Connect Discord before entering the battle.", { status: 401, code: "DISCORD_SESSION_REQUIRED" });
  const user = session.user;
  const requestUrl = new URL(url, "https://arena.invalid");
  const inviteId = requestUrl.searchParams.get("id") || body.id;
  if (!validId(inviteId)) throw new BattleApiError("A valid challenge ID is required.", { status: 400, code: "INVITE_ID_INVALID" });
  const db = getDb(env);
  const { invite, isChallenger } = await loadParticipant({ db, inviteId, user });
  let row = await db.prepare("SELECT * FROM chog_battles WHERE invite_id = ?1 LIMIT 1").bind(inviteId).first();

  if (method === "GET") return { status: 200, body: { battle: publicBattle(row, invite, user) } };
  if (method !== "POST") throw new BattleApiError("Method not allowed.", { status: 405, code: "METHOD_NOT_ALLOWED" });

  if (body.action === "start") {
    if (row) return { status: 200, body: { battle: publicBattle(row, invite, user) } };
    const practiceMode = invite.game_mode === "PRACTICE";
    if (!practiceMode && (!invite.pact_id || !invite.pact_tx_hash)) {
      throw new BattleApiError("Both players must sign and mint the soulbound Pact NFT before the match starts.", { status: 409, code: "PACT_NOT_MINTED" });
    }
    if (invite.status !== "READY" || !invite.challenger_ready || !invite.opponent_ready) {
      throw new BattleApiError("Both players must accept the terms and confirm readiness before the battle starts.", { status: 409, code: "PLAYERS_NOT_READY" });
    }
    if (!practiceMode) {
      await verifyChogOwner(fetchImpl, env, invite.challenger_token_id, invite.challenger_wallet);
      await verifyChogOwner(fetchImpl, env, invite.opponent_token_id, invite.opponent_wallet);
    }
    const [challengerDNA, opponentDNA] = await Promise.all([
      fetchCombatDNA(fetchImpl, env, invite.challenger_token_id),
      fetchCombatDNA(fetchImpl, env, invite.opponent_token_id),
    ]);
    const now = new Date().toISOString();
    const log = [{ turn: 0, type: "system", text: practiceMode ? "Prototype multiplayer practice started. No Pact NFT or official result will be recorded." : "Real-time battle started. Move, attack, and dash to win." }];
    await db.prepare(`INSERT OR IGNORE INTO chog_battles
      (invite_id, status, active_player_discord_id, turn_number, challenger_hp, opponent_hp,
       challenger_energy, opponent_energy, challenger_guard, opponent_guard, challenger_dna, opponent_dna,
       battle_log, winner_discord_id, version, created_at, updated_at)
      VALUES (?1, 'IN_BATTLE', ?2, 1, ?3, ?4, 3, 3, 0, 0, ?5, ?6, ?7, NULL, 1, ?8, ?8)`)
      .bind(inviteId, invite.challenger_discord_id, challengerDNA.stats.maxHp, opponentDNA.stats.maxHp,
        JSON.stringify(challengerDNA), JSON.stringify(opponentDNA), JSON.stringify(log), now).run();
    await db.prepare("UPDATE chog_challenge_invites SET status = 'IN_BATTLE', updated_at = ?1 WHERE id = ?2 AND status = 'READY'")
      .bind(now, inviteId).run();
    row = await db.prepare("SELECT * FROM chog_battles WHERE invite_id = ?1 LIMIT 1").bind(inviteId).first();
    return { status: 200, body: { battle: publicBattle(row, invite, user) } };
  }

  if (body.action === "move") throw new BattleApiError("Turn-based moves are disabled. The match uses the real-time arena connection.", { status: 410, code: "REALTIME_COMBAT_ONLY" });
  throw new BattleApiError("Choose a supported battle action.", { status: 400, code: "BATTLE_ACTION_INVALID" });
  if (!row || row.status !== "IN_BATTLE") throw new BattleApiError("The battle has not started or has already ended.", { status: 409, code: "BATTLE_NOT_ACTIVE" });
  if (row.active_player_discord_id !== user.discordId) throw new BattleApiError("It is your opponent's turn. The lobby will update automatically.", { status: 409, code: "NOT_YOUR_TURN" });
  const move = String(body.move || "");
  if (!["strike", "guard", "special"].includes(move)) throw new BattleApiError("Choose Strike, Guard, or Special.", { status: 400, code: "MOVE_INVALID" });

  const attackerIsChallenger = isChallenger;
  const attackerDNA = safeJson(attackerIsChallenger ? row.challenger_dna : row.opponent_dna, null);
  const defenderDNA = safeJson(attackerIsChallenger ? row.opponent_dna : row.challenger_dna, null);
  if (!attackerDNA?.stats || !defenderDNA?.stats) throw new BattleApiError("Battle stats are unavailable. Restart the challenge.", { status: 500, code: "BATTLE_DNA_INVALID" });
  let challengerHP = row.challenger_hp;
  let opponentHP = row.opponent_hp;
  let challengerEnergy = row.challenger_energy;
  let opponentEnergy = row.opponent_energy;
  let challengerGuard = Boolean(row.challenger_guard);
  let opponentGuard = Boolean(row.opponent_guard);
  let attackerEnergy = attackerIsChallenger ? challengerEnergy : opponentEnergy;
  let damage = 0;
  let text = "";
  const attackerName = attackerIsChallenger ? invite.challenger_username : invite.opponent_username;
  const defenderName = attackerIsChallenger ? invite.opponent_username : invite.challenger_username;
  if (move === "guard") {
    if (attackerIsChallenger) challengerGuard = true; else opponentGuard = true;
    text = `${attackerName} braces for the next hit.`;
  } else {
    if (move === "special" && attackerEnergy <= 0) throw new BattleApiError("No energy left. Use Strike or Guard.", { status: 409, code: "NO_ENERGY" });
    const raw = move === "special"
      ? Math.round(attackerDNA.stats.attack * 1.6 + randomInt(0, 4))
      : Math.round(attackerDNA.stats.attack + randomInt(-2, 3));
    const defended = attackerIsChallenger ? opponentGuard : challengerGuard;
    damage = Math.max(5, raw - Math.floor(defenderDNA.stats.defense * 0.25));
    if (defended) damage = Math.max(1, Math.floor(damage * 0.5));
    if (attackerIsChallenger) {
      opponentHP = Math.max(0, opponentHP - damage);
      opponentGuard = false;
      if (move === "special") challengerEnergy = Math.max(0, challengerEnergy - 1);
    } else {
      challengerHP = Math.max(0, challengerHP - damage);
      challengerGuard = false;
      if (move === "special") opponentEnergy = Math.max(0, opponentEnergy - 1);
    }
    text = `${attackerName} used ${move === "special" ? attackerDNA.ability : "Strike"} for ${damage} damage${defended ? " (guard reduced the hit)" : ""}.`;
  }
  const winner = challengerHP <= 0 ? invite.opponent_discord_id : opponentHP <= 0 ? invite.challenger_discord_id : null;
  const nextPlayer = attackerIsChallenger ? invite.opponent_discord_id : invite.challenger_discord_id;
  const now = new Date().toISOString();
  const log = safeJson(row.battle_log, []);
  log.push({ turn: row.turn_number, actor: user.discordId, move, damage, text, at: now });
  if (log.length > MAX_LOG_ENTRIES) log.splice(0, log.length - MAX_LOG_ENTRIES);
  const newStatus = winner ? "FINISHED" : "IN_BATTLE";
  const nextActive = winner ? user.discordId : nextPlayer;
  const update = await db.prepare(`UPDATE chog_battles SET status = ?1, active_player_discord_id = ?2,
    turn_number = ?3, challenger_hp = ?4, opponent_hp = ?5, challenger_energy = ?6, opponent_energy = ?7,
    challenger_guard = ?8, opponent_guard = ?9, battle_log = ?10, winner_discord_id = ?11,
    version = version + 1, updated_at = ?12
    WHERE invite_id = ?13 AND version = ?14 AND active_player_discord_id = ?15 AND status = 'IN_BATTLE'`)
    .bind(newStatus, nextActive, row.turn_number + 1, challengerHP, opponentHP, challengerEnergy, opponentEnergy,
      challengerGuard ? 1 : 0, opponentGuard ? 1 : 0, JSON.stringify(log), winner, now,
      inviteId, row.version, user.discordId).run();
  if (!update.meta || update.meta.changes !== 1) throw new BattleApiError("The battle state changed. Refresh and try again.", { status: 409, code: "BATTLE_STATE_CONFLICT" });
  if (winner) {
    await db.prepare("UPDATE chog_challenge_invites SET status = 'RESULT_PENDING', updated_at = ?1 WHERE id = ?2 AND status = 'IN_BATTLE'")
      .bind(now, inviteId).run();
  }
  const updatedRow = await db.prepare("SELECT * FROM chog_battles WHERE invite_id = ?1 LIMIT 1").bind(inviteId).first();
  const updatedInvite = winner
    ? { ...invite, status: "RESULT_PENDING" }
    : invite;
  return { status: 200, body: { battle: publicBattle(updatedRow, updatedInvite, user) } };
}
