-- Chog Fight Club persistent challenge invitations for Cloudflare D1 (SQLite).
-- Apply with:
-- npx wrangler d1 execute chog-fight-club --remote --file=migrations/0001_challenge_invites.sql

CREATE TABLE IF NOT EXISTS chog_challenge_invites (
  id TEXT PRIMARY KEY NOT NULL,
  challenger_discord_id TEXT NOT NULL,
  challenger_username TEXT NOT NULL,
  challenger_wallet TEXT NOT NULL,
  challenger_token_id TEXT NOT NULL,
  opponent_discord_id TEXT NOT NULL,
  opponent_username TEXT,
  opponent_wallet TEXT,
  opponent_token_id TEXT,
  condition_text TEXT NOT NULL CHECK (length(condition_text) BETWEEN 5 AND 500),
  terms_hash TEXT NOT NULL CHECK (length(terms_hash) = 64),
  challenger_terms_accepted INTEGER NOT NULL DEFAULT 1 CHECK (challenger_terms_accepted IN (0, 1)),
  challenger_terms_accepted_at TEXT NOT NULL,
  opponent_terms_accepted INTEGER NOT NULL DEFAULT 0 CHECK (opponent_terms_accepted IN (0, 1)),
  opponent_terms_accepted_at TEXT,
  challenger_ready INTEGER NOT NULL DEFAULT 0 CHECK (challenger_ready IN (0, 1)),
  opponent_ready INTEGER NOT NULL DEFAULT 0 CHECK (opponent_ready IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'PENDING_ACCEPTANCE'
    CHECK (status IN (
      'PENDING_ACCEPTANCE',
      'TERMS_ACCEPTED',
      'READY',
      'IN_BATTLE',
      'RESULT_PENDING',
      'SETTLED',
      'CONDITION_PENDING',
      'CONDITION_FULFILLED',
      'DECLINED',
      'CANCELLED',
      'EXPIRED',
      'DISPUTED',
      'ABANDONED'
    )),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT,
  CHECK (challenger_discord_id <> opponent_discord_id),
  CHECK ((opponent_terms_accepted = 1 AND opponent_terms_accepted_at IS NOT NULL)
      OR (opponent_terms_accepted = 0 AND opponent_terms_accepted_at IS NULL))
);

CREATE INDEX IF NOT EXISTS chog_invites_incoming_idx
  ON chog_challenge_invites (opponent_discord_id, created_at DESC);
CREATE INDEX IF NOT EXISTS chog_invites_outgoing_idx
  ON chog_challenge_invites (challenger_discord_id, created_at DESC);
CREATE INDEX IF NOT EXISTS chog_invites_status_expiry_idx
  ON chog_challenge_invites (status, expires_at);
CREATE INDEX IF NOT EXISTS chog_invites_throttle_idx
  ON chog_challenge_invites (challenger_discord_id, created_at DESC, status);
