-- On-chain Pact settlement and fulfilment transaction references.
-- Apply after migrations 0001 through 0004.

ALTER TABLE chog_challenge_invites ADD COLUMN pact_settlement_tx_hash TEXT;
ALTER TABLE chog_challenge_invites ADD COLUMN pact_settled_at TEXT;
ALTER TABLE chog_challenge_invites ADD COLUMN pact_fulfillment_tx_hash TEXT;
ALTER TABLE chog_challenge_invites ADD COLUMN pact_fulfilled_at TEXT;
