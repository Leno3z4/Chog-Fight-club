# Discord Gate, Player Profiles and Battle Invitations

## Access gate
- The landing route is the Discord connect screen.
- The server performs Discord OAuth with `identify guilds.members.read`.
- Access is granted only if the OAuth-authenticated Discord user is a member of `DISCORD_GUILD_ID` and their member-role list contains `DISCORD_HOLDER_ROLE_ID` (default `1545507860455096460`).
- The role ID alone is insufficient. The supplied Chog Discord guild ID is configured as the default: `1253481714710220810`; deployments may override it with `DISCORD_GUILD_ID`.
- Never trust client-supplied Discord IDs, role names, screenshots, or a URL query. The backend must use Discord's OAuth identity and guild-member endpoint.

## Profile
The gated profile has a left sidebar: My Chogs, Invite to Battle, Incoming Invites, Sent Invites, Battle History. Wallet connection happens here, after Discord verification. Chogs are listed separately and the player selects a main fighter.

## Invitation state machine
`DRAFT → PENDING_ACCEPTANCE → ACCEPTED → SELECTING_FIGHTERS → TERMS_REVIEW → TERMS_ACCEPTED → PACT_MINT_PENDING → READY → IN_BATTLE → RESULT_PENDING → SETTLED → CONDITION_PENDING → CONDITION_FULFILLED`

Alternate terminal/recovery states:
`DECLINED`, `CANCELLED`, `EXPIRED`, `DISPUTED`, `ABANDONED`.

### Proposed flow
1. Player A chooses a real owned Chog and creates an invitation link with an unguessable invitation ID. Store a record on the backend immediately; the link must survive refreshes, logout, and the recipient being offline.
2. Player B opens the link. They pass Discord role verification, connect their wallet, and choose their own Chog.
3. The lobby displays both players, Discord display names, selected Chog images/IDs, metadata-derived stats, and a persistent invitation status.
4. Either side can decline. The sender can cancel while pending. Pending invites have an expiry and rate limits. One invitation ID can be accepted only once.
5. Both players see the exact condition text and disclosure that pact terms/outcomes are public on-chain. Each signs/accepts the same `termsHash`.
6. Only after both players consent does the pact NFT mint. The Chog NFTs are never approved, transferred, or escrowed.
7. When both players are online and click Ready, the shared lobby enters the arena. A reconnect token restores the lobby after refresh.
8. After a validated result, the separate pact NFTs reveal win/condition-pending status. The winner can confirm fulfilment, changing the loser's record from unfulfilled to fulfilled. Disputes/expiry need a defined neutral process.

## Persistence is mandatory
Do not store invitations only in localStorage, sessionStorage, or an in-memory serverless variable. The invitation needs a durable record with transactional status transitions, expiry, replay protection, and access control. Before implementing live invitations, select a persistent backend/storage binding and configure it in the deployment target.

Recommended record fields:
- `inviteId`, `createdAt`, `expiresAt`, `status`
- `challengerDiscordId`, `challengerWallet`, `challengerTokenId`
- `opponentDiscordId` or one-time invite capability token, `opponentWallet`, `opponentTokenId`
- `termsDraft`, `termsHash`, `challengerAcceptedTerms`, `opponentAcceptedTerms`
- `pactTokenIds`, `matchId`, `result`, `conditionStatus`, event/audit trail.

## Deployment secrets required
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_GUILD_ID`
- `DISCORD_REDIRECT_URI` (must exactly match the callback configured in the Discord Developer Portal; can be derived from origin in development if omitted)
- `SESSION_SECRET` (long random secret, never commit)
- `OPENSEA_API_KEY` (server-side only, for Chog discovery)

The holder role ID defaults to `1545507860455096460`; optionally override using `DISCORD_HOLDER_ROLE_ID`.
