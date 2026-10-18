# Chog Battle Arena

Chog Battle Arena is a Discord-gated 2D/2.5D Chog fighting game. Vercel serves the website and Discord OAuth; Cloudflare Pages runs the authenticated backend API; a separate Cloudflare Durable Object Worker handles the real-time arena.

## Implemented

- Discord OAuth and holder-role verification, including configured owner access.
- Player profiles, Chog roster selection, and signed wallet linking.
- Username search, persistent invitations, pending lobby links, and presence/notifications.
- Single-player practice against a bot and prototype practice without owning a Chog NFT.
- Multiplayer real-time movement, attacks, special attacks, dash, and shared room state.
- Server-side battle state and current Chog ownership verification before official matches.
- Two-player EIP-712 signing of the exact written deal; mint verification; winner settlement; winner-confirmed fulfilment.
- Paired soulbound Pact receipts. Chog NFTs are referenced and ownership-checked; they are never transferred or approved by this app.
- Contract-generated Pact metadata containing the public deal, each player's role, winner, loser, and condition status.

## Live deployment architecture

- **Website:** Vercel project `chog-fight-club`, production branch `main`, domain `https://chog-fight-club.vercel.app`.
- **Cloudflare Pages API:** project `chog-fight-club`, production branch `main`, URL `https://chog-fight-club.pages.dev`.
- **Cloudflare D1:** database `chog-fight-club`, binding `CHOG_DB`, ID `8b61a704-51a0-40c0-a6dd-0f46bb81589e`.
- **Real-time Worker:** `chog-battle-arena-realtime`; its URL is configured in Vercel's public `VITE_ARENA_REALTIME_URL` variable.
- **D1 migrations:** 0001 through 0007 have been applied to the connected production database. Do not re-run migrations 0003–0007 against this database; they contain ALTER TABLE operations.

The Cloudflare Pages build from `main`, the real-time Worker deployment, and the Vercel production deployment from merge commit `91f3ecc` completed successfully. Run a live two-account test before accepting official matches.

## Required configuration

### Vercel

In **Vercel → Project → Settings → Environment Variables**, keep these configured for production:

- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_REDIRECT_URI=https://chog-fight-club.vercel.app/api/discord/callback`
- `SESSION_SECRET` — must exactly match the value on Cloudflare Pages and the real-time Worker
- `CLOUDFLARE_BACKEND_URL=https://chog-fight-club.pages.dev`
- `MONAD_RPC_URL=https://rpc.monad.xyz`
- `OPENSEA_API_KEY` (for OpenSea metadata lookups, where configured)
- `VITE_ARENA_REALTIME_URL` — public Worker URL only; never put secrets in a `VITE_*` variable

The exact Discord OAuth callback must be registered in the Discord Developer Portal. Keep the callback on the Vercel domain, not Pages.

### Cloudflare Pages

The project uses a D1 binding named `CHOG_DB`. The production/preview configuration includes:

- `SESSION_SECRET` — same as Vercel and the realtime Worker
- `MONAD_RPC_URL=https://rpc.monad.xyz`
- `PACT_CHAIN_ID=143`

The Pact factory has **not yet been deployed or configured**. After the factory is deployed, configure `PACT_FACTORY_ADDRESS` and `PACT_RESOLVER_ADDRESS`; store `PACT_RESOLVER_PRIVATE_KEY` as a Cloudflare secret only. The resolver private key must match the immutable resolver address passed to the factory constructor and the wallet needs MON for gas.

### Real-time Worker

The Worker `chog-battle-arena-realtime` is deployed with Durable Object binding `ARENA_ROOMS`, D1 binding `CHOG_DB`, and the shared `SESSION_SECRET`. Its `ARENA_FRONTEND_ORIGIN` must match the actual Vercel site origin exactly.

## Pact NFT deployment status

Contract source: [`contracts/ChogBattlePactFactory.sol`](./contracts/ChogBattlePactFactory.sol)  
Deployment instructions: [`PACT_FACTORY_DEPLOYMENT.md`](./PACT_FACTORY_DEPLOYMENT.md)

The contract compiles and its Foundry unit tests pass in CI, but it is immutable after deployment. The full mint → real-time match settlement → fulfilment flow still needs an end-to-end test against a test deployment before the mainnet contract should be treated as production-ready.

The contract generates metadata on-chain through `tokenURI()`. Settlement writes the winner to contract storage; the winner must then submit `confirmFulfillment` after the agreed off-chain task is done. The next `tokenURI()` response reflects those values without uploading a replacement metadata file. NFT marketplaces may cache metadata and can take time to refresh.

## Development and validation

```bash
npm install
npm test
npm run build
```

The GitHub Actions workflow also syntax-checks the API/Worker code, validates all seven D1 migrations against SQLite, and runs Foundry contract tests.
