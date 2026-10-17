-- Independent, mutually accepted demands for the Pact agreement.
-- Apply after migrations 0001 through 0005.

ALTER TABLE chog_challenge_invites ADD COLUMN opponent_demand_text TEXT NOT NULL DEFAULT '';
