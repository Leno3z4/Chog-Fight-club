# Cloudflare D1 backend setup for Chog Battle Arena

Vercel serves the website and same-origin API proxy routes. The `chog-fight-club` Cloudflare Worker runs Discord auth, wallet linking, Chog roster lookup, player directory, invitations, battle and Pact APIs with the D1 binding. A separate Cloudflare Durable Object Worker provides the real-time battle room.

## Current connected deployment

- **API Worker:** `chog-fight-club`, URL `https://chog-fight-club.gatakehanami.workers.dev`.
- **D1 database:** `chog-fight-club`, ID `8b61a704-51a0-40c0-a6dd-0f46bb81589e`, binding `CHOG_DB`.
- **Real-time Worker:** `chog-battle-arena-realtime`, with Durable Object `ArenaRoom`.
- **Vercel frontend:** `https://chog-fight-club.vercel.app`.
- The API Worker is deployed and its live `/health` check has passed: D1, Discord/OpenSea credentials, factory bytecode, Monad chain ID, resolver secret/address match, and on-chain immutable resolver are verified. Vercel's production deployment is `READY` and its API proxy routes were smoke-tested. The realtime Worker has its D1 and Durable Object bindings configured.
- Migrations **0001 through 0007 are already applied to this production D1 database**. Do not re-run them there; migrations 0003–0007 alter the existing invite table and are not repeatable.

The session secret is shared between the API Worker and the real-time Worker so both can validate the same signed tickets/session context. The Vercel API proxies do not need to hold the resolver private key. Existing Discord sessions may need to sign in again after session-secret changes.

## 1. For a fresh D1 database only

For a *new/empty* database, apply these SQL migrations once, in numerical order:

1. [`0001_challenge_invites.sql`](./migrations/0001_challenge_invites.sql)
2. [`0002_player_directory.sql`](./migrations/0002_player_directory.sql)
3. [`0003_authoritative_battles.sql`](./migrations/0003_authoritative_battles.sql)
4. [`0004_pact_nft_signatures.sql`](./migrations/0004_pact_nft_signatures.sql)
5. [`0005_pact_settlement.sql`](./migrations/0005_pact_settlement.sql)
6. [`0006_bilateral_demands.sql`](./migrations/0006_bilateral_demands.sql)
7. [`0007_multiplayer_practice.sql`](./migrations/0007_multiplayer_practice.sql)

Do not apply these files again to the connected production database listed above.

## 2. Cloudflare API Worker settings

The production backend is the Worker `chog-fight-club`, not the Pages project. Its source entry point is `worker.js`; `wrangler.jsonc` defines the `CHOG_DB` D1 binding and public Monad/Pact variables.

The Git-connected Worker build configuration is:

- Branch: `main`
- Build command: `npm test && npx wrangler deploy --dry-run`
- Deploy command: `npm run deploy:worker` (runs `wrangler deploy`)
- Preview builds: disabled for this production Worker

Do **not** use `npx wrangler pages deploy` for this Worker. The build first runs the existing test suite and a Wrangler dry run, then deploys the Worker entry point.

The production Worker has the following secrets configured as Cloudflare Worker Secrets:

- `SESSION_SECRET`
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `OPENSEA_API_KEY`
- `PACT_RESOLVER_PRIVATE_KEY`

The public runtime configuration includes `PACT_FACTORY_ADDRESS`, `PACT_RESOLVER_ADDRESS`, `PACT_CHAIN_ID=143`, `MONAD_RPC_URL=https://rpc.monad.xyz`, `DISCORD_APP_ORIGIN`, and `DISCORD_REDIRECT_URI`. The live health endpoint verifies that the key derives the configured resolver address and that the immutable resolver stored in the factory matches.

The Pages project named `chog-fight-club` still exists, but it is **not** the active API target. Do not configure Vercel to route its production API requests to the Pages URL.

## 3. Vercel settings

Vercel production uses:

- `CLOUDFLARE_BACKEND_URL=https://chog-fight-club.gatakehanami.workers.dev`
- `CLOUDFLARE_BACKEND_URL` — API Worker URL above for production and preview
- `DISCORD_REDIRECT_URI=https://chog-fight-club.vercel.app/api/discord/callback` is configured on the Worker as a public variable, with Discord client credentials stored as Worker Secrets
- `VITE_ARENA_REALTIME_URL` — public URL of the real-time Worker, no keys/secrets

After changing Vercel environment variables, create a new deployment to pick them up. The OAuth redirect stays on the Vercel domain.

## 4. Real-time Worker

The Worker named `chog-battle-arena-realtime` is deployed with:

- Durable Object namespace binding `ARENA_ROOMS` targeting `ArenaRoom`
- D1 binding `CHOG_DB`
- `SESSION_SECRET` as a Cloudflare secret
- `ARENA_FRONTEND_ORIGIN=https://chog-fight-club.vercel.app`

The WebSocket service checks a short-lived signed ticket from the API Worker and verifies the participant against the shared D1 invitation. Do not put the session secret or resolver key in browser code.

## 5. Pact factory configuration

The Pact factory **is deployed on Monad mainnet (chain ID 143)**:

- Factory: `0x3a5485d41cAcE651dBAba9f292C12b1Df425f950`
- Immutable resolver: `0x77DF3ae15b994131797905e59675da3544C90DFF`

These public values are configured in `wrangler.jsonc` and deployed to the API Worker. `PACT_RESOLVER_PRIVATE_KEY` is stored as a Cloudflare Worker Secret only; the live health check confirms the secret matches the configured wallet and the on-chain immutable resolver.

Keep the resolver wallet funded with MON for settlement gas. Never paste the private key into chat, GitHub, Vercel, or public configuration. See [`PACT_FACTORY_DEPLOYMENT.md`](./PACT_FACTORY_DEPLOYMENT.md) for the immutable factory warning and lifecycle test.

## 6. Post-deployment validation

1. Sign in with Discord and confirm the holder-role gate.
2. Link a Monad wallet and verify the signed wallet-link message.
3. Test invitation creation, target acceptance, both written demands, and readiness.
4. Connect two browser sessions and verify the real-time room opens and both players see the other player.
5. Run a controlled two-account test against the deployed app and factory: both EIP-712 signatures, paired minting, server-validated match winner settlement, and winner-confirmed fulfilment. Verify both NFTs' `tokenURI()` outputs after mint, settlement, and fulfilment.
6. The public API proxy and Worker health checks currently pass, but this two-account Pact lifecycle is still required before accepting official matches. Do not redeploy the immutable mainnet factory unless intentionally deploying a different contract.

The Discord OAuth redirect must remain `https://chog-fight-club.vercel.app/api/discord/callback`; do not register the Worker URL or Pages URL as the OAuth callback.
