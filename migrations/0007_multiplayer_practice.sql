-- Owner-enabled multiplayer practice rooms use prototype fighters and can never mint a real Pact.
-- Apply after migrations 0001 through 0006.

ALTER TABLE chog_challenge_invites
  ADD COLUMN game_mode TEXT NOT NULL DEFAULT 'OFFICIAL'
  CHECK (game_mode IN ('OFFICIAL', 'PRACTICE'));
