# Chog Fight Club

A 2D/2.5D Chog fighting game prototype where each Chog's collection metadata resolves into a separate Battle DNA profile.

## Current foundation

- Phaser 3 + Vite; fixed side-on battle arena (not an explorable world).
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

Open the Vite URL for the landing page. Open `/roster.html` to connect a Monad Mainnet wallet, load the Chog roster, and choose a fighter for practice mode.

## OpenSea API key

The app includes a server-side `/api/chogs` route. Add `OPENSEA_API_KEY` in the deployment platform's server-side environment settings. **Do not use a `VITE_OPENSEA_API_KEY` variable.** The OpenSea route discovers Chog token IDs; the app rechecks each candidate's current ownership on Monad before using its NFT metadata.

For local development, the frontend may fall back to MonadScan if the Vercel serverless route is not available. Live OpenSea lookup requires the server-side key to be configured in the deployed environment.

## Chog ownership lookup

The app detects ERC-721 Enumerable support and uses `tokenOfOwnerByIndex` when available. Otherwise it falls back to the public MonadScan NFT transfer API, which is rate-limited without an API key. For production, configure `VITE_CHOG_NFT_INDEXER_URL` to a server-side indexer endpoint that accepts `?owner=0x...` and returns `{ "tokenIds": ["561", "973"] }`.

Do **not** put private indexer/API keys in `VITE_*` variables: these become public in the browser build. The client checks each candidate NFT's current owner on-chain and reads metadata through the collection's `tokenURI`.

See [CHOG_NFT_INTEGRATION.md](./CHOG_NFT_INTEGRATION.md) for details.

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
