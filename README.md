# Chog Battle Arena

Chog Battle Arena is a Discord-gated 2D/2.5D Chog fighting game. Vercel serves the website and same-origin API proxy routes; the `chog-fight-club` Cloudflare Worker runs the authenticated API; a separate Cloudflare Durable Object Worker handles the real-time arena.

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
- **Cloudflare API Worker:** `chog-fight-club`, URL `https://chog-fight-club.gatakehanami.workers.dev`. The Worker runs Discord auth, wallet linking, Chog roster lookup, player directory, invites, battle APIs, and Pact lifecycle endpoints.
- **Cloudflare D1:** database `chog-fight-club`, binding `CHOG_DB`, ID `8b61a704-51a0-40c0-a6dd-0f46bb81589e`.
- **Real-time Worker:** `chog-battle-arena-realtime`; its URL is configured in Vercel's public `VITE_ARENA_REALTIME_URL` variable.
- **D1 migrations:** 0001 through 0007 have been applied to the connected production database. Do not re-run migrations 0003–0007 against this database; they contain ALTER TABLE operations.

The Cloudflare API Worker is deployed from `main`; its live health check confirms D1, Discord/OpenSea credentials, Monad chain ID, deployed factory bytecode, and the resolver key/address match. Vercel's production deployment is `READY`, and the public API proxy routes return the expected authentication/validation responses. Run the full two-account Pact lifecycle test before accepting official matches.

## Required configuration

### Vercel

In **Vercel → Project → Settings → Environment Variables**, configure:

- `CLOUDFLARE_BACKEND_URL=https://chog-fight-club.gatakehanami.workers.dev` — server-side API proxy target
- `VITE_ARENA_REALTIME_URL` — public URL of the separate real-time Worker

The Discord OAuth callback remains `https://chog-fight-club.vercel.app/api/discord/callback`. Register that exact callback in the Discord Developer Portal. Vercel serves the frontend and proxies its `/api/*` routes to the Cloudflare API Worker; do not put secrets into `VITE_*` variables.

### Cloudflare API Worker

The Worker `chog-fight-club` uses the D1 binding `CHOG_DB` and these public runtime variables:

- `PACT_FACTORY_ADDRESS=0x3a5485d41cAcE651dBAba9f292C12b1Df425f950`
- `PACT_RESOLVER_ADDRESS=0x77DF3ae15b994131797905e59675da3544C90DFF`
- `PACT_CHAIN_ID=143`
- `MONAD_RPC_URL=https://rpc.monad.xyz`
- `DISCORD_APP_ORIGIN=https://chog-fight-club.vercel.app`
- `DISCORD_REDIRECT_URI=https://chog-fight-club.vercel.app/api/discord/callback`

Worker secrets include `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `SESSION_SECRET`, `OPENSEA_API_KEY`, and `PACT_RESOLVER_PRIVATE_KEY`. The resolver key stays in Cloudflare Worker Secrets and must match the immutable resolver address. The live health endpoint currently confirms that match.

### Real-time Worker

The Worker `chog-battle-arena-realtime` is deployed with Durable Object binding `ARENA_ROOMS`, D1 binding `CHOG_DB`, and the shared `SESSION_SECRET`. Its `ARENA_FRONTEND_ORIGIN` must match the actual Vercel site origin exactly.

## Pact NFT deployment status

Contract source: [`contracts/ChogBattlePactFactory.sol`](./contracts/ChogBattlePactFactory.sol)  
Deployment instructions: [`PACT_FACTORY_DEPLOYMENT.md`](./PACT_FACTORY_DEPLOYMENT.md)

The contract is already deployed and immutable on Monad mainnet. The full mint → real-time match settlement → winner-confirmed fulfilment flow still needs an end-to-end test against this deployed factory before official matches should be treated as production-ready. Do not redeploy another factory unless that is intentional.

The contract generates metadata on-chain through `tokenURI()`. Settlement writes the winner to contract storage; the winner must then submit `confirmFulfillment` after the agreed off-chain task is done. The next `tokenURI()` response reflects those values without uploading a replacement metadata file. NFT marketplaces may cache metadata and can take time to refresh.

## Development and validation

```bash
npm install
npm test
npm run build
```

The GitHub Actions workflow also syntax-checks the API/Worker code, validates all seven D1 migrations against SQLite, and runs Foundry contract tests.
