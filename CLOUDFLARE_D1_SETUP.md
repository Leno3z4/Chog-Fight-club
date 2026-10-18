# Cloudflare D1 backend setup for Chog Battle Arena

Vercel serves the website and Discord sign-in. Cloudflare Pages serves the authenticated invitation/Pact APIs and binds the D1 database. A separate Cloudflare Worker provides the real-time battle room.

## Current connected deployment

- **Pages project:** `chog-fight-club`, production branch `main`, URL `https://chog-fight-club.pages.dev`.
- **D1 database:** `chog-fight-club`, ID `8b61a704-51a0-40c0-a6dd-0f46bb81589e`, binding `CHOG_DB`.
- **Real-time Worker:** `chog-battle-arena-realtime`, with Durable Object `ArenaRoom`.
- **Vercel frontend:** `https://chog-fight-club.vercel.app`.
- The Pages and Vercel production deployments have completed successfully. The realtime Worker has its D1 and Durable Object bindings configured.
- Migrations **0001 through 0007 are already applied to this production D1 database**. Do not re-run them there; migrations 0003–0007 alter the existing invite table and are not repeatable.

The session secret was synchronized across Vercel, Pages, and the real-time Worker during deployment. Existing Discord sessions may need to sign in again.

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

## 2. Cloudflare Pages settings

In **Cloudflare Dashboard → Workers & Pages → chog-fight-club → Settings → Bindings**, the Pages Functions binding must be named exactly `CHOG_DB` and point to the database above.

The connected production and preview configurations use:

- `SESSION_SECRET` — the same secret as Vercel and the real-time Worker
- `MONAD_RPC_URL=https://rpc.monad.xyz`
- `PACT_CHAIN_ID=143` — Monad mainnet chain ID

Pages is a Git-connected project. Its build command is `npm run build`, output directory is `dist`, and production branch is `main`. Pages deploys automatically after a successful build; do not run `npx wrangler deploy` for this Pages project.

## 3. Vercel settings

Vercel production uses:

- `CLOUDFLARE_BACKEND_URL=https://chog-fight-club.pages.dev`
- `SESSION_SECRET` — same exact secret as Cloudflare
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_REDIRECT_URI=https://chog-fight-club.vercel.app/api/discord/callback`
- `MONAD_RPC_URL=https://rpc.monad.xyz`
- `OPENSEA_API_KEY`, if using OpenSea API lookups
- `VITE_ARENA_REALTIME_URL` — public URL of the real-time Worker, no keys/secrets

After changing Vercel environment variables, create a new deployment to pick them up. The OAuth redirect stays on the Vercel domain.

## 4. Real-time Worker

The Worker named `chog-battle-arena-realtime` is deployed with:

- Durable Object namespace binding `ARENA_ROOMS` targeting `ArenaRoom`
- D1 binding `CHOG_DB`
- `SESSION_SECRET` as a Cloudflare secret
- `ARENA_FRONTEND_ORIGIN=https://chog-fight-club.vercel.app`

The WebSocket service checks a short-lived signed ticket from the Pages API and verifies the participant against the shared D1 invitation. Do not put the session secret or resolver key in browser code.

## 5. Pact factory configuration

The Pact factory is not yet deployed/configured. After the contract is deployed, set these on **Cloudflare Pages → Variables and Secrets**:

- `PACT_FACTORY_ADDRESS` — deployed factory address
- `PACT_CHAIN_ID=143`
- `PACT_RESOLVER_ADDRESS` — must match the immutable constructor argument
- `PACT_RESOLVER_PRIVATE_KEY` — Cloudflare secret only, matching the resolver address; keep it funded for settlement gas

Do not paste the resolver private key into chat, GitHub, or Vercel. See [`PACT_FACTORY_DEPLOYMENT.md`](./PACT_FACTORY_DEPLOYMENT.md) for the contract and end-to-end test requirements.

## 6. Post-deployment validation

1. Sign in with Discord and confirm the holder-role gate.
2. Link a Monad wallet and verify the signed wallet-link message.
3. Test invitation creation, target acceptance, both written demands, and readiness.
4. Connect two browser sessions and verify the real-time room opens and both players see the other player.
5. With a test factory, exercise both EIP-712 signatures, paired minting, winner settlement, and winner-confirmed fulfilment. Verify both NFTs' `tokenURI()` outputs after each stage.
6. Only after that full cycle succeeds should the immutable Monad mainnet factory be treated as production-ready.

The Discord OAuth redirect must remain `https://chog-fight-club.vercel.app/api/discord/callback`; do not register the Pages URL as the callback.
