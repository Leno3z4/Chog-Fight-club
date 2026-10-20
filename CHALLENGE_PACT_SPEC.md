# Challenge Pact + Conditional NFT spec

This document records the intended challenge flow. It is a product/security spec, not deployed contract code.

## Non-negotiable boundary

**Chog Genesis NFTs are read-only player assets.** The game can verify current ownership, read their metadata, and record a token ID as the fighter selected for a match. It must never request NFT approvals, transfer custody, alter the Chog contract, or use a Chog as collateral.

The condition/pact NFTs are a separate collection controlled by the game's own contract.

## Player flow

1. **Identity link.** Each player connects a Monad wallet and signs a one-time wallet challenge. They separately connect Discord through OAuth. The server stores the verified Discord-user-to-wallet association. A Discord name supplied by the browser is not proof of identity.
2. **Create challenge.** A challenger chooses a Discord-linked opponent, selects one of their own verified Chogs, and writes a proposed condition.
3. **Review and accept.** The opponent sees the exact text, public visibility warning, 24-hour invitation expiry, and selected fighters; chooses their own Chog; then explicitly accepts the exact terms. Reject, cancel, or expire before acceptance means no Pact NFT is minted.
4. **Lock the pact.** Both players sign the same `challengeId + termsHash + selected token IDs + expiry`. The contract records the immutable terms hash and a content URI to the written terms, then mints one role-specific Pact NFT to each participant. Neither NFT is a Chog.
5. **Fight.** The game starts only after both wallets and the pact state are checked again. The fight records which two Chog token IDs were selected, but does not transfer them.
6. **Settle the result.** A trusted, auditable match resolver records the winner only after the match result has been validated. The Pact NFT metadata then reveals the outcome and the agreed condition.
7. **Condition pending.** The winner's Pact NFT shows the win, the opponent, and the condition. The loser's Pact NFT shows an **Unfulfilled Challenge** status while the condition is outstanding.
8. **Confirm completion.** The loser may submit a completion claim/evidence. The winner reviews the claim and presses **Confirm fulfilled** in the battle history. The contract changes the loser's Pact NFT metadata to **Condition fulfilled — challenge lost**. It does not call them a sore loser and it does not erase the recorded loss.

## NFT model

Prefer two linked, role-specific Pact NFTs minted at acceptance (one per participant), with a shared `challengeId`. Their metadata is derived from the same on-chain challenge record but personalized for the wallet's role. The loser's receipt itself carries the pending stigma state; a separate third stigma token is unnecessary for the MVP.

The Pact NFT contains or references:
- challenge ID;
- challenger/opponent addresses;
- selected Chog collection address + token IDs (references only);
- exact condition text via a content URI, plus an on-chain `termsHash`;
- terms acceptance timestamps and expiry;
- match ID and validated winner after settlement;
- condition status: `PENDING`, `FULFILLED`, `DISPUTED` or `EXPIRED` if those states are later adopted.

**Terms are public.** Before signing, explain that a condition and its history may be visible permanently. Keep private Discord IDs, OAuth tokens, email, and private evidence off-chain. Store only public wallet addresses and hashes/URIs needed for the pact.

## How the NFT gets "revealed"

Do not rely on an administrator manually editing token metadata. The contract should hold the status fields and have a `tokenURI(tokenId)` implementation (or a constrained metadata renderer) derive the current JSON metadata from those fields. The terms URI/hash stays fixed; the status fields change only through specific authorized transitions:

- `acceptChallenge`: validates both parties' signatures/consent; locks the terms hash and mints the two Pact NFTs.
- `settleMatch`: callable only by the authorized match resolver; records a single validated winner once.
- `submitFulfillment`: loser can submit a claim or optional evidence URI; cannot declare their own claim approved.
- `confirmFulfillment`: callable only by the recorded winner; changes the loser's Pact state to fulfilled.
- `cancel/expire`: only before acceptance or under explicitly defined safe expiry rules.

The contract owner should not have an unrestricted "set winner", "edit terms", or "set fulfilled" power. Admin access can pause the system for emergencies, but should not override a settled outcome or rewrite accepted terms. All state transitions should emit events.

## Result integrity

The real-time multiplayer room is hosted by a Cloudflare Durable Object, which owns movement, cooldowns, damage, match state, and the winner recorded to D1. Browser input is not trusted as a result by itself. The configured resolver submits the on-chain result from the server-recorded match. The app enforces a five-minute post-match review window; either participant can open an off-chain dispute before settlement, which blocks settlement until an authorized moderator dismisses the dispute. This remains a trusted-server design—not a cryptographic proof of fair play. Before meaningful stakes, the resolver path still needs an independent security review and the deployed immutable contract's limits around post-settlement disputes and winner non-response must be accepted or addressed in a future factory version. Never describe the result as trustless.

## Conditions and safety

Both players must approve the exact text; no silent edits after acceptance. Reject or moderate dangerous, illegal, harassing, privacy-invasive, or non-consensual conditions. The easiest safe first version limits conditions to voluntary, harmless tasks (for example, posting a silly but non-abusive public message) and makes public visibility clear before signature.

A winner-only completion button can leave the loser marked unfulfilled if the winner disappears or acts unfairly. The pre-settlement review/dispute path is implemented off-chain. The deployed immutable factory cannot transition a minted Pact to EXPIRED or DISPUTED, and it cannot change fulfillment status without the winner confirming it. This post-settlement limitation must remain explicit until a new factory supports a bounded timeout and neutral review path; do not imply that off-chain D1 status changes update NFT metadata. Do not give the admin wallet unrestricted discretion.

## Discord and wallet security

- OAuth token exchange and session creation happen on the server; never ship a Discord client secret in frontend code.
- Use a fresh nonce for wallet-signature verification and bind it to the authenticated Discord session.
- Do not treat a wallet address pasted into Discord as an identity proof.
- Recheck Chog ownership at acceptance/start time; roster cache or session storage is not proof.
- Apply per-wallet and per-Discord-user rate limits; prevent self-challenges, replayed signatures, duplicate settlement, and expired challenge acceptance.

## Implementation phases

1. Read-only Chog roster and Battle DNA preview (current branch slice).
2. Production ownership indexer configuration + Discord OAuth/wallet-link backend.
3. Challenge invitation and two-party term review/acceptance.
4. Pact contract and role-specific Pact NFTs, initially with no token wagering.
5. Authoritative match result resolution and metadata reveal.
6. Fulfilment claim + winner confirmation and pending/fulfilled display.
7. Rate limits, structured observability, pre-settlement review/dispute controls, and lobby expiry are implemented. Remaining launch checks are an independent security review and the two-account demo/e2e lifecycle test.
