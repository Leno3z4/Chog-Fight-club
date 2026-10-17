-- Player directory for username-based challenge discovery.
-- Apply after 0001_challenge_invites.sql in the Cloudflare D1 Console.

CREATE TABLE IF NOT EXISTS chog_players (
  discord_id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  wallet_address TEXT,
  last_seen TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS chog_players_username_idx
  ON chog_players (username COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS chog_players_display_name_idx
  ON chog_players (display_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS chog_players_last_seen_idx
  ON chog_players (last_seen DESC);
