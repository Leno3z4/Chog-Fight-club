# Chog Fight Club — website and challenge lobby

The website layer for Chog Fight Club. It contains the Discord holder gate, player profile, read-only Chog roster, wallet linking, persistent challenge invitations, and Cloudflare Pages API routes.

## What's included on this branch

- Root page: connect Discord and verify holder role before entering.
- Profile: connect a Monad wallet, view owned Chogs and choose a main fighter.
- Invites: send a challenge link to a specific Discord user, accept/decline/cancel, review the agreed condition, and persist both players' ready states.
- Separate challenge lobby page with polling so an offline recipient can open the invitation later.
- Cloudflare Pages Functions for Discord OAuth, wallet signature verification, OpenSea lookup, and invitations.
- Cloudflare D1 storage through the binding `CHOG_DB`.
- Bold rounded display typography and the purple/yellow/orange community palette.

The unfinished battle engine and battle screen are intentionally **not included on main**. The website shows a metadata-derived roster preview; its numbers are not an authoritative final combat balance.

## Cloudflare Pages setup

Build command: `npm run build`  
Build output directory: `dist`

The repository includes `wrangler.jsonc` with the D1 binding from the Cloudflare dashboard:
- Binding: `CHOG_DB`
- Database: `chog-fight-club`
- Database ID: `8b61a704-51a0-40c0-a6dd-0f46bb81589e`

Run the SQL in `migrations/0001_challenge_invites.sql` in the D1 Console, then make sure the Pages project uses the same D1 binding.

## Required server-side variables/secrets

- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_REDIRECT_URI` — exact callback: `https://YOUR-DOMAIN/api/discord/callback`
- `SESSION_SECRET`
- `OPENSEA_API_KEY`
- `MONAD_RPC_URL` — `https://rpc.monad.xyz`

Default Discord guild: `1253481714710220810`  
Default holder role: `1545507860455096460`

Never expose secrets with a `VITE_*` prefix.

See [Cloudflare D1 setup](./CLOUDFLARE_D1_SETUP.md) and [Discord/invitation design](./DISCORD_GATE_AND_INVITATIONS.md).

## Current boundary

The D1-backed invitation lifecycle is a lobby foundation. It does not launch synchronized combat. The multiplayer relay, Pact NFT contract/mint, verified winner settlement, and fulfillment confirmation remain later milestones. No Chog Genesis NFT is ever transferred or approved by this website layer.
