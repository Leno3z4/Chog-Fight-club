# Chog NFT integration — first milestone

## What this branch adds
- Wallet connection and switch/add Monad Mainnet (chain ID 143).
- Chog Genesis read-only integration using collection contract `0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763`.
- Metadata parsing from `tokenURI`, including standard `attributes` into trait fields and IPFS URI resolution.
- A `/roster.html` screen that displays each owned Chog as a separate card with its current Battle DNA preview, rarity, traits, and ability preview.
- Selecting a real NFT stores a local practice selection that the Phaser arena reads. It does not approve, transfer, or modify the Chog.
- A clearly labelled local training fighter for testing when the developer owns no Chog.

## OpenSea API lookup

The default fallback is the server-side `/api/chogs?owner=0x...` route. Vercel uses `api/chogs.js`; Cloudflare Pages uses `functions/api/chogs.js`. Both call the shared `server/openSeaChogs.js` implementation. It calls OpenSea's account NFT endpoint with `chain=monad` and `collection=chog-genesis`, paginates, and filters returned items to the exact Chog Genesis contract address. Monad appears in OpenSea's current supported-chain list, and its account endpoint supports collection filtering and pagination.

Configure `OPENSEA_API_KEY` as a **server-side environment secret** in your deployment platform: Vercel → Settings → Environment Variables, or Cloudflare Pages → Settings → Variables and Secrets (secret, not plain text), for the environments that serve the app. Do not name it `VITE_OPENSEA_API_KEY`; any `VITE_*` variable is shipped to the browser. The endpoint returns only token IDs. The client then verifies each candidate with the actual Monad `ownerOf` call and reads the collection's `tokenURI` for traits and metadata.

If the key is not configured or OpenSea is unavailable, the client falls back to the configured indexer or MonadScan transfer history. OpenSea is an index/discovery aid, not authority on current ownership. Rate limits and marketplace hidden-item behavior are possible, so the app still needs a production-owned indexer strategy and error states.

## Ownership discovery
ERC-721 owner enumeration is optional. The client checks the `0x780e9d63` ERC-721 Enumerable interface first. If unsupported, it falls back to the public MonadScan `tokennfttx` API and reconstructs the latest transfer status per token. The public API is rate-limited when used without a key, so it is a prototype fallback rather than a production dependency.

For production, set `VITE_CHOG_NFT_INDEXER_URL` to a **server-side** endpoint accepting `?owner=0x...` and returning token IDs, e.g.:

```json
{ "tokenIds": ["561", "973"] }
```

The client verifies each candidate with `ownerOf` before showing it. An indexer is only a discovery aid; it is not trusted as proof of current ownership. Keep provider API keys in server-side environment secrets, never in a `VITE_*` variable. The roster uses the collection's `tokenURI` and does not ask the user to approve any transaction.

## Run
```bash
npm install
npm run dev
```

Open `/roster.html`, connect a wallet, and choose a real Chog or the local training fighter. The selected profile is saved in session storage and read by `battle.html` in practice mode.

## Deliberately not included yet
- Discord OAuth/account linking.
- Challenge invitations, both-player consent, immutable terms/pact minting, battle result attestations, or fulfilment confirmation.
- A condition NFT contract or mutable/revealed outcome metadata.
- Production battle-result verification.

Those should be added only with a server-side OAuth/session layer and a dedicated conditional NFT/challenge contract. The browser's session storage is only for practice UI; never use it as proof of ownership or as a settlement result.
