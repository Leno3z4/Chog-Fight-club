# Chog Fight Club

A 2D/2.5D Chog fighting game prototype where each Chog's collection metadata resolves into a separate Battle DNA profile.

## Current foundation

- Phaser 3 + Vite; fixed side-on battle arena (not an explorable world).
- Base fighter rendered from the repo's transparent PNG layers (`images/body.png`, `head.png`, `eyes.png`, arms, legs, and nose); aura glow picks up a color family from metadata. Trait-specific clothing/headwear still needs matching artist-supplied layers.
- Real-time movement, jumping, basic attacks, abilities, energy, cooldowns, and round flow.
- Battle DNA generated from Chog Genesis metadata: tier, aura, background, form/base, body, eyes, skin, and other available traits.
- Wallet-connected Chog roster at `/roster.html`: owned Chogs are shown separately with metadata, rarity, and a Battle DNA preview.
- A clearly labelled local prototype fighter for development without a real Chog.
- Read-only ownership/metadata checks; the game must never ask users to approve or transfer their Chog NFTs.

## Run locally

```bash
npm install
npm run dev
```

Open the Vite URL for the Discord holder gate. After successful Discord role verification, the app opens `/profile.html`, where the player can connect a Monad Mainnet wallet, view Chogs, and choose a main fighter. The previous game overview remains at `/landing.html`; the standalone `/roster.html` practice page is also retained.

## Discord holder gate

The root page now starts with **Connect Discord**. Server-side OAuth requests the `identify` and `guilds.members.read` scopes and only creates a signed session if the authenticated Discord user is in the configured guild and has the required role. The role ID defaults to `1545507860455096460`.

Configure these server-side environment variables:

- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_GUILD_ID` — the Discord server ID (different from the role ID)
- `DISCORD_REDIRECT_URI` — must exactly match the callback URL registered in the Discord Developer Portal
- `SESSION_SECRET` — long random signing secret

The role check is performed on the server using Discord's `/users/@me/guilds/{guild.id}/member` endpoint. The browser cannot grant itself holder access by changing JavaScript or query parameters. Vercel routes live under `api/discord/`; Cloudflare Pages routes live under `functions/api/discord/`; Vite local development has middleware for the same endpoints.

The profile sidebar includes My Chogs, Invite to Battle, Incoming Invites, Sent Invites, and Battle History. The invitation screens are currently UI/spec only. Persistent invitations and the pact NFT lifecycle require a configured database/storage layer and verified match settlement before they should be enabled.

## OpenSea API key

The app includes a server-side `/api/chogs` route for Vercel (`api/chogs.js`) and Cloudflare Pages (`functions/api/chogs.js`), backed by `server/openSeaChogs.js`. Add `OPENSEA_API_KEY` in the deployment platform's server-side environment settings (Vercel Environment Variables or Cloudflare Pages Variables and Secrets). **Do not use a `VITE_OPENSEA_API_KEY` variable.** The OpenSea route discovers Chog token IDs; the app rechecks each candidate's current ownership on Monad before using its NFT metadata.

For local development, the frontend may fall back to MonadScan if the Vercel serverless route is not available. Live OpenSea lookup requires the server-side key to be configured in the deployed environment.

## Chog ownership lookup

The app detects ERC-721 Enumerable support and uses `tokenOfOwnerByIndex` when available. Otherwise it falls back to the public MonadScan NFT transfer API, which is rate-limited without an API key. For production, configure `VITE_CHOG_NFT_INDEXER_URL` to a server-side indexer endpoint that accepts `?owner=0x...` and returns `{ "tokenIds": ["561", "973"] }`.

Do **not** put private indexer/API keys in `VITE_*` variables: these become public in the browser build. The client checks each candidate NFT's current owner on-chain and reads metadata through the collection's `tokenURI`.

See [CHOG_NFT_INTEGRATION.md](./CHOG_NFT_INTEGRATION.md) for details.

## Persistent challenge invitations on Cloudflare

The profile includes a challenge creator, incoming/outgoing lists, and a shared invitation lobby. Invitation records are stored in **Cloudflare D1** through the Pages Functions binding named `CHOG_DB`; no Supabase service is used.

### Set up D1 once

1. In Cloudflare, open **Workers & Pages → D1 SQL Database → Create database** and name it `chog-fight-club` (or choose your own name).
2. Run the migration from the repository root:
   ```bash
   npx wrangler d1 execute chog-fight-club --remote --file=migrations/0001_challenge_invites.sql
   ```
3. Open the Cloudflare Pages project, then **Settings → Bindings → Add → D1 database**. Set the variable name to exactly `CHOG_DB`, select that database, save, and redeploy.
4. Add the Discord OAuth and `OPENSEA_API_KEY` values as server-side secrets in Cloudflare Pages. Set `MONAD_RPC_URL=https://rpc.monad.xyz` as a server-side variable. Do not add secrets with a `VITE_*` prefix.

The API checks the connected wallet's signed link to Discord and rechecks Chog `ownerOf(tokenId)` on Monad before accepting create/accept actions. Invitations can be accepted, declined, cancelled, and tracked while offline; pending invitations expire after seven days. Conditions are limited to 500 characters and obvious unsafe conditions or links are rejected.

## Challenge pact design

The planned Discord-linked challenge flow and conditional NFTs are specified in [CHALLENGE_PACT_SPEC.md](./CHALLENGE_PACT_SPEC.md). They are **not deployed yet**. In particular, browser-only practice results are not valid proof for minting winner/loser outcome metadata; challenge settlement needs a server-authoritative or otherwise verifiable result resolver.

## Controls

- `A` / `D` or `←` / `→` — move
- `Space` / `W` / `↑` — jump
- `F` — basic attack
- `1` — base ability
- `2` — special ability
- `3` — defense

This is a hackathon prototype. Wallet roster selection is implemented; Discord OAuth, real player challenge matchmaking, the Pact NFT contract, and production settlement remain future milestones.
