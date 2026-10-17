-- Pact NFT signing and mint receipt tracking.
-- Apply after migrations 0001, 0002, and 0003.

ALTER TABLE chog_challenge_invites ADD COLUMN pact_expires_at INTEGER;
ALTER TABLE chog_challenge_invites ADD COLUMN challenger_pact_signature TEXT;
ALTER TABLE chog_challenge_invites ADD COLUMN opponent_pact_signature TEXT;
ALTER TABLE chog_challenge_invites ADD COLUMN pact_id INTEGER;
ALTER TABLE chog_challenge_invites ADD COLUMN pact_tx_hash TEXT;
ALTER TABLE chog_challenge_invites ADD COLUMN pact_contract_address TEXT;
ALTER TABLE chog_challenge_invites ADD COLUMN challenger_receipt_id TEXT;
ALTER TABLE chog_challenge_invites ADD COLUMN opponent_receipt_id TEXT;
ALTER TABLE chog_challenge_invites ADD COLUMN pact_minted_at TEXT;
