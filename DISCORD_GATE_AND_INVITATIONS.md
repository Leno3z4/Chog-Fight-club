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
`PENDING_ACCEPTANCE → TERMS_ACCEPTED (recipient has joined lobby) → READY (both demands accepted) → PACT_MINT_PENDING → IN_BATTLE → RESULT_PENDING → CONDITION_PENDING → CONDITION_FULFILLED`

Alternate terminal/recovery states:
`DECLINED`, `CANCELLED`, `EXPIRED`, `DISPUTED`, `ABANDONED`.

### Proposed flow
1. Player A chooses a real owned Chog and creates an invitation link with an unguessable invitation ID. Store a record on the backend immediately; the link must survive refreshes, logout, and the recipient being offline.
2. Player B opens the link, passes Discord holder verification, links their wallet, selects an owned Chog, and chooses **Join lobby**. The invitation creator can already be waiting in that same lobby.
3. The lobby shows who is connected and prompts each player to write one demand. Each player must explicitly accept the exact combined demands; joining alone is not consent. Changing either demand resets both acceptances.
4. The opponent's join causes an in-app notification and, where enabled, a browser notification with a **Join lobby** link. Either side can decline before acceptance; the sender can cancel while pending. Each invite ID is accepted at most once.
5. Both wallets sign the same EIP-712 Pact agreement only after both demands are accepted. The factory mints two linked soulbound receipts; the Chog NFTs remain read-only and are never transferred or approved.
6. After mint, both players are online and ready, then enter the shared real-time arena. Players move and attack continuously; this is not a turn-based combat loop. The Cloudflare Durable Object owns the live combat state.
7. After the resolver records the winner, the Pact receipts reveal the result. The winner confirms the condition when it has been completed. A timeout/dispute path should be designed before meaningful wagers.

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


## Implemented invite backend foundation

The branch includes `server/invites.js`, the Cloudflare Pages adapter at `functions/api/invites.js`, and the Cloudflare D1 migration at `migrations/0001_challenge_invites.sql`. The invite endpoint requires the signed Discord session plus a wallet that was linked through a fresh wallet signature. It checks the selected Chog with Monad's `ownerOf` before creating or accepting an invitation. Invite reads are restricted to the two specified Discord accounts; state changes use status filters, and the ready check uses one conditional SQLite update through D1.

To activate this portion, create a Cloudflare D1 database, apply `migrations/0001_challenge_invites.sql` with Wrangler, then bind the database to the Cloudflare Pages project using the exact binding name `CHOG_DB`. Set `MONAD_RPC_URL` as a server-side variable. D1 binding setup is documented in `CLOUDFLARE_D1_SETUP.md`.

The feature branch now has a Durable Object WebSocket room for real-time combat, separate Single Player vs Bot practice, a bilateral demand editor, the EIP-712 soulbound Pact mint flow, and result/fulfilment handlers. It remains a draft branch and still needs deployment/configuration in Cloudflare and Vercel plus a staged end-to-end test.


## Cloudflare storage decision

Cloudflare D1 is the only persistence service used by the invitation API. No Supabase project or secret is required. In the Pages Functions runtime, the binding is available as `env.CHOG_DB`. A missing binding returns an explicit `D1_NOT_CONFIGURED` response rather than silently storing invitations in browser storage.
