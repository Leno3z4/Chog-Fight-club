-- Authoritative, turn-based battle state for Chog Battle Arena.
-- Apply after migrations/0001 and 0002 in the Cloudflare D1 database.

CREATE TABLE IF NOT EXISTS chog_battles (
  invite_id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL DEFAULT 'IN_BATTLE' CHECK (status IN ('IN_BATTLE', 'FINISHED', 'ABANDONED')),
  active_player_discord_id TEXT NOT NULL,
  turn_number INTEGER NOT NULL DEFAULT 1 CHECK (turn_number >= 1),
  challenger_hp INTEGER NOT NULL CHECK (challenger_hp >= 0),
  opponent_hp INTEGER NOT NULL CHECK (opponent_hp >= 0),
  challenger_energy INTEGER NOT NULL DEFAULT 3 CHECK (challenger_energy BETWEEN 0 AND 3),
  opponent_energy INTEGER NOT NULL DEFAULT 3 CHECK (opponent_energy BETWEEN 0 AND 3),
  challenger_guard INTEGER NOT NULL DEFAULT 0 CHECK (challenger_guard IN (0, 1)),
  opponent_guard INTEGER NOT NULL DEFAULT 0 CHECK (opponent_guard IN (0, 1)),
  challenger_dna TEXT NOT NULL,
  opponent_dna TEXT NOT NULL,
  battle_log TEXT NOT NULL DEFAULT '[]',
  winner_discord_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (invite_id) REFERENCES chog_challenge_invites(id)
);

CREATE INDEX IF NOT EXISTS chog_battles_status_updated_idx
  ON chog_battles (status, updated_at DESC);
