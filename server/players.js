import { readDiscordSession } from "./discordAuth.js";
import { inviteExpiryAt } from "./launchPolicy.js";

export class PlayerDirectoryError extends Error {
  constructor(message, { status = 500, code = "PLAYER_DIRECTORY_ERROR" } = {}) {
    super(message);
    this.name = "PlayerDirectoryError";
    this.status = status;
    this.code = code;
  }
}

function database(env) {
  if (!env?.CHOG_DB || typeof env.CHOG_DB.prepare !== "function") {
    throw new PlayerDirectoryError(
      "Cloudflare D1 is not configured. Bind the database as CHOG_DB and apply migrations/0002_player_directory.sql.",
      { status: 503, code: "D1_NOT_CONFIGURED" },
    );
  }
  return env.CHOG_DB;
}

function safeSearch(value) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 40);
}

export async function handlePlayerDirectoryRequest({
  method, url, cookieHeader = "", env,
}) {
  const current = await readDiscordSession({ cookieHeader, env });
  if (!current.authenticated) {
    throw new PlayerDirectoryError("Connect Discord and verify access first.", { status: 401, code: "DISCORD_SESSION_REQUIRED" });
  }
  const db = database(env);
  const user = current.user;
  const now = new Date().toISOString();

  if (method === "POST") {
    const username = String(user.discordUsername || user.username || "discord-user").slice(0, 32);
    const displayName = String(user.displayName || user.username || username).slice(0, 80);
    await db.prepare(`
      INSERT INTO chog_players (
        discord_id, username, display_name, avatar_url, wallet_address, last_seen, created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
      ON CONFLICT(discord_id) DO UPDATE SET
        username = excluded.username,
        display_name = excluded.display_name,
        avatar_url = excluded.avatar_url,
        wallet_address = excluded.wallet_address,
        last_seen = excluded.last_seen
    `).bind(
      user.discordId,
      username,
      displayName,
      user.avatar || null,
      user.walletAddress || null,
      now,
    ).run();

    // Turn reserved username invites into fixed-ID invites at the first verified Arena signup.
    // The invite then gets the normal 24-hour acceptance window.
    const registeredAt = new Date(now);
    await db.prepare(`
      UPDATE chog_challenge_invites
      SET opponent_discord_id = ?1, opponent_username = ?2, expires_at = ?3, updated_at = ?4
      WHERE opponent_discord_id = ?5
        AND status = 'PENDING_ACCEPTANCE'
        AND challenger_discord_id <> ?1
    `).bind(
      user.discordId,
      username,
      inviteExpiryAt(registeredAt),
      now,
      `username:${username.toLowerCase()}`,
    ).run();

    return {
      status: 200,
      body: { ok: true },
      headers: { "Cache-Control": "no-store" },
    };
  }

  if (method === "GET") {
    const parsed = new URL(url, "https://arena.invalid");
    const query = safeSearch(parsed.searchParams.get("q") || "");
    if (query.length < 2) {
      return {
        status: 200,
        body: { players: [], queryTooShort: true },
        headers: { "Cache-Control": "private, no-store" },
      };
    }
    // Escape LIKE metacharacters without stripping valid Discord username characters such as "_".
    const prefix = query.replace(/[\\%_]/g, "\\$&") + "%";
    const rows = await db.prepare(`
      SELECT discord_id, username, display_name, avatar_url, last_seen
      FROM chog_players
      WHERE discord_id <> ?1
        AND (username LIKE ?2 ESCAPE '\\' COLLATE NOCASE OR display_name LIKE ?2 ESCAPE '\\' COLLATE NOCASE)
      ORDER BY
        CASE WHEN username = ?3 COLLATE NOCASE THEN 0
             WHEN display_name = ?3 COLLATE NOCASE THEN 1
             ELSE 2 END,
        last_seen DESC
      LIMIT 10
    `).bind(user.discordId, prefix, query).all();
    return {
      status: 200,
      body: { players: rows.results ?? [], queryTooShort: false },
      headers: { "Cache-Control": "private, no-store" },
    };
  }

  throw new PlayerDirectoryError("Method not allowed.", { status: 405, code: "METHOD_NOT_ALLOWED" });
}
