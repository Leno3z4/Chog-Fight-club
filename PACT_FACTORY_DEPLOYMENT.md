# Pact NFT factory deployment

The contract is `contracts/ChogBattlePactFactory.sol`. It is a single factory/collection contract; you deploy it once, then accepted challenges mint two linked soulbound receipts.

## Important: do not deploy to mainnet until the app's signature/mint integration is merged

The factory requires both players to sign the same EIP-712 agreement. The feature branch now includes two-wallet EIP-712 signing for the canonical combined string of both players' written demands, the mint panel, and on-chain mint receipt verification. Still do not deploy to mainnet until the branch passes CI, the D1 migrations are applied in a staging environment, and the full flow is tested with a test factory. Deploying before end-to-end testing risks minting receipts that the app cannot settle or track.

## Constructor arguments

Compile with Solidity **0.8.24**, optimizer enabled, 200 runs, and **via-IR enabled** (the factory uses IR compilation to avoid stack-depth limits).

1. `chogCollection_`: `0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763`
2. `matchResolver_`: a dedicated resolver wallet address. This address is immutable and is the only address permitted to call `settleMatch`. Do not use an everyday wallet. The server stores the resolver private key as the Cloudflare secret `PACT_RESOLVER_PRIVATE_KEY`; `PACT_RESOLVER_ADDRESS` must match the factory constructor. The winner can trigger settlement, but the backend uses the resolver key only after checking the authoritative battle row. The resolver wallet needs MON for gas.

The contract has no owner, no upgrade function, no arbitrary metadata editor, and no way to transfer or approve a Pact NFT. It checks current ownership of each selected Chog when minting; it never moves or approves a Chog.

## Remix deployment steps (when integration is ready)

1. Open Remix and create `ChogBattlePactFactory.sol`.
2. Paste the exact contents of `contracts/ChogBattlePactFactory.sol`.
3. In **Solidity Compiler**, select **0.8.24**, enable optimization, and set runs to **200**.
4. Compile and inspect warnings. Do not deploy if compilation shows an error.
5. In **Deploy & Run Transactions**, choose **Injected Provider** and verify the wallet/network before deploying.
6. Enter the two constructor arguments above and deploy. Save the resulting factory address; it is required by the frontend and Cloudflare backend.
7. Do not publish a resolver private key or place it in frontend/Vercel client code.

## On-chain lifecycle

- Each player writes one harmless demand. Both accept the exact combined text before signing the same typed agreement, including invite key, wallets, both Chog IDs, combined-terms hash, terms-URI hash and expiry.
- `mintPact` verifies both signatures and current Chog ownership, then mints one soulbound receipt to each player.
- The immutable resolver records the validated winner once.
- Only that winner can confirm fulfilment. The loser’s NFT metadata then changes from `Unfulfilled Challenge` to `Challenge lost - condition fulfilled`.
- Conditions are public and permanent. Do not accept private, dangerous, illegal, harassing or non-consensual tasks.

## Current limitation

The website now contains the EIP-712 signature and mint flow, server verification of mint/settlement/fulfilment events, and winner-triggered settlement plus wallet-signed fulfilment. These still need end-to-end testing against a deployed factory before production deployment.
