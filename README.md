# Chog Battle Arena — website and challenge lobby

The website and Discord sign-in run on **Vercel**. Cloudflare provides D1-backed APIs and a separate Durable Object Worker for the real-time battle room. The browser stays on the Vercel domain.

## What's included

- Discord OAuth and holder-role verification, including owner access for the configured Discord user.
- Player profile and Chog roster selection.
- Wallet-signature linking to the Discord session.
- Username-based player search and persistent challenge invitations.
- A Play screen with **Single Player vs Bot** practice and **Multiplayer** invitations.
- A persistent shared lobby with presence updates and browser notifications when the invited player joins.
- Bilateral demands: each player writes a demand, both explicitly accept both demands, and any edit resets the prior acceptances.
- A real-time arena with movement, attacks, special attacks, and dash. Multiplayer state is hosted by a Cloudflare Durable Object, not turn-based polling.
- A separate prototype bot mode that does not need a Chog NFT and never mints a Pact.
- Metadata-derived battle stats fetched server-side from OpenSea and current Chog ownership rechecked on Monad before the match starts.
- A Pact NFT signing panel: both players sign the same EIP-712 agreement, then either can mint the paired soulbound receipts.
- A Solidity factory that makes the condition visible in token metadata, blocks transfers and approvals, and supports resolver settlement plus winner-confirmed fulfilment.
- Cloudflare D1 storage through the Pages Functions binding `CHOG_DB`.

These changes are in the feature branch and draft PR, not `main` yet. The factory still requires `PACT_FACTORY_ADDRESS`, `PACT_RESOLVER_ADDRESS`, and the `PACT_RESOLVER_PRIVATE_KEY` Cloudflare secret, plus an end-to-end test before production use. The match resolver is immutable and must only submit a result after validating the server-authoritative match.

## Vercel: website and browser-facing API

Vercel automatically deploys functions under `/api`. Set these production environment variables in **Vercel → Project → Settings → Environment Variables**:

- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_REDIRECT_URI=https://chog-fight-club.vercel.app/api/discord/callback`
- `SESSION_SECRET` — must match the value on Cloudflare exactly
- `OPENSEA_API_KEY`
- `MONAD_RPC_URL=https://rpc.monad.xyz`
- `CLOUDFLARE_BACKEND_URL=https://chog-fight-club.pages.dev` — use your actual Pages backend URL if it differs

The Discord OAuth Redirects list in the Developer Portal must include the exact Vercel callback URL above. Do not use the Cloudflare Pages URL as the Discord callback. Never expose secrets with a `VITE_*` prefix.

## Cloudflare: D1 battle and Pact backend

The Pages Functions API is used behind Vercel's `/api` proxies. The separate real-time Worker is deployed from the `realtime/` directory. In Cloudflare Pages, bind the D1 database as `CHOG_DB`, and set:

- `SESSION_SECRET` — exactly the same secret as Vercel, so the backend can validate the signed Discord session
- `MONAD_RPC_URL=https://rpc.monad.xyz`
- `OPENSEA_API_KEY` — server-side secret for reading Chog metadata
- `PACT_FACTORY_ADDRESS` — deployed factory address
- `PACT_CHAIN_ID=143`
- `PACT_RESOLVER_ADDRESS` — the resolver address passed to the factory constructor
- `PACT_RESOLVER_PRIVATE_KEY` — Cloudflare secret only; this wallet needs MON for settlement gas

After the feature branch is reviewed and merged, apply migrations `0001_challenge_invites.sql` through `0006_bilateral_demands.sql` in numerical order in the D1 dashboard Console. Do not run the new migrations on production before the feature has been reviewed. Players who have signed in once appear in username search; if a player is not listed yet, invite their exact Discord username and they can claim it after signing in. Database binding ID: `8b61a704-51a0-40c0-a6dd-0f46bb81589e`.

### Cloudflare deployment settings

This is a **Pages** project, not a Worker script. If the dashboard provides a build command and output directory, use `npm run build` and `dist`. Do not use `npx wrangler deploy`. If the project specifically requires a deploy command, use `npx wrangler pages deploy dist --project-name=chog-fight-club` after the build step.

## Real-time Worker deployment

Deploy `realtime/worker.js` as a separate Cloudflare Worker named `chog-battle-arena-realtime`. In Cloudflare's dashboard, use `realtime/wrangler.jsonc` as its configuration and bind the same D1 database as `CHOG_DB`. Add `SESSION_SECRET` as a Cloudflare secret with the exact same value used by Vercel and Pages. Set `ARENA_FRONTEND_ORIGIN` to your actual Vercel origin. The Worker URL is shown in its dashboard after deployment.

In Vercel, add the public build-time variable `VITE_ARENA_REALTIME_URL` with that Worker base URL, for example `https://chog-battle-arena-realtime.<your-account>.workers.dev`, then redeploy Vercel. This value is a public service URL, not a secret.

The real-time game cannot start officially until the Pact factory is deployed/configured and both players have signed and minted the Pact. Single Player practice is separate and does not touch the contract.

## Development and validation

`npm test` runs the service tests. GitHub Actions validates the D1 migration as SQLite and builds the Vite website.

See [Cloudflare setup](./CLOUDFLARE_D1_SETUP.md) and [Discord/invitation design](./DISCORD_GATE_AND_INVITATIONS.md).
