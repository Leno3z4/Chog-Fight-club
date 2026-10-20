# Pact NFT factory deployment

The contract is [`contracts/ChogBattlePactFactory.sol`](./contracts/ChogBattlePactFactory.sol). It is a single factory/collection contract. Each accepted official challenge mints two linked soulbound receipts.

## Current status and mainnet warning


**Monad mainnet deployment recorded (chain ID 143):**

- Factory: `0x3a5485d41cAcE651dBAba9f292C12b1Df425f950`
- Immutable resolver: `0x77DF3ae15b994131797905e59675da3544C90DFF`
- RPC: `https://rpc.monad.xyz`

The public factory/resolver addresses, chain ID, and RPC are defined in `wrangler.jsonc` and are deployed with the Cloudflare Worker. The resolver key is stored in Cloudflare Worker Secrets as `PACT_RESOLVER_PRIVATE_KEY`; the live Worker health endpoint confirms that the key derives the configured resolver address and that the factory's immutable on-chain resolver matches it. Never put the private key in `wrangler.jsonc`, source control, frontend variables, or chat.

The application signing/mint/settlement integration is merged into `main`; contract unit tests and CI checks passed. The Cloudflare API Worker, D1 schema, and separate real-time Worker are deployed. Vercel hosts the frontend and proxies API requests to the Cloudflare API Worker.

**The full end-to-end lifecycle has not yet been exercised against this deployed mainnet factory. Do not treat official Pact matches as production-ready until a controlled two-account test passes the full mint → authoritative winner settlement → winner-confirmed fulfilment lifecycle and both `tokenURI()` responses reflect each state change.** This factory is immutable and cannot be upgraded or repaired in place; do not deploy another factory unless that is intentional.

## Result review and immutable-factory limitation

The Cloudflare application now adds a five-minute post-match result-review window. Either participant can submit a bounded dispute reason before settlement; the backend changes the invite to `DISPUTED` and blocks the resolver call. A moderator authorized by `ADMIN_DISCORD_IDS` can dismiss the dispute and restart the five-minute window, but cannot choose a different winner. That preserves the factory's immutable winner rule.

**Important:** the already-deployed factory has no `disputeMatch`, `voidPact`, or `expireFulfillment` transition. Once the resolver settles a Pact, the app cannot use D1 to change the on-chain token metadata or reverse the winner. If a dispute cannot be dismissed safely, leave it unsettled. If a winner disappears after settlement, the receipt can remain pending indefinitely. A full on-chain timeout / neutral-dispute lifecycle requires a new factory version and a separately reviewed deployment; do not redeploy the current factory automatically.

## Open the source

- [Open source on GitHub](https://github.com/Leno3z4/Chog-Fight-club/blob/main/contracts/ChogBattlePactFactory.sol)
- [Open the source in Remix](https://remix.ethereum.org/#url=https://raw.githubusercontent.com/Leno3z4/Chog-Fight-club/main/contracts/ChogBattlePactFactory.sol)

Compile with Solidity **0.8.24**, optimizer enabled, 200 runs, and **via-IR enabled**.

## Constructor arguments

1. `chogCollection_`: `0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763`
2. `matchResolver_`: a dedicated resolver wallet address. The address is immutable and is the only address allowed to call `settleMatch`. Use a wallet kept for this purpose, not an everyday wallet. The Cloudflare Worker secret `PACT_RESOLVER_PRIVATE_KEY` must match `PACT_RESOLVER_ADDRESS`, and the resolver wallet needs MON for gas.

## Remix steps

1. Open the source link above and confirm that Remix loaded `ChogBattlePactFactory.sol`.
2. In **Solidity Compiler**, select **0.8.24**, enable optimization, set runs to **200**, and enable **via-IR**.
3. Compile and inspect the warnings. Do not deploy if compilation fails.
4. In **Deploy & Run Transactions**, select **Injected Provider** and verify the wallet is connected to **Monad Mainnet (chain ID 143)** before choosing Deploy.
5. Enter the two constructor arguments above, with your dedicated resolver wallet address as the second argument.
6. Deploy and save the resulting factory address. Check the deployed address/constructor values before using it.
7. For the already deployed factory, do not repeat the deployment steps. The current Cloudflare Worker has `PACT_FACTORY_ADDRESS`, `PACT_RESOLVER_ADDRESS`, and `PACT_CHAIN_ID` configured and the live health check has confirmed the resolver-key match. Keep `PACT_RESOLVER_PRIVATE_KEY` in Worker Secrets only, and keep the resolver wallet funded with MON for gas.

## How metadata changes

The contract's `tokenURI(tokenId)` generates a JSON data URI from current on-chain Pact state:

- At mint, metadata shows the deal and that the battle is awaiting a result.
- When the resolver records the server-validated winner through `settleMatch`, both receipts' metadata show the winner, loser, and pending condition.
- After the agreed off-chain task is completed, the winner must explicitly submit `confirmFulfillment`. That transaction changes the contract state, so both receipts' next `tokenURI()` responses show the fulfilled outcome.
- No off-chain metadata upload/update job is involved. Marketplaces may cache old metadata and need a refresh before showing the new attributes.

This is not automatic detection of an off-chain task: the smart contract cannot know that a real-world promise was completed by itself. The app provides the winner-confirmation transaction and verifies its on-chain event before updating its UI/database.

## Security properties and limits

- Both players must sign the same EIP-712 agreement, including both wallets, both Chog IDs, the challenge key, the agreed deal hash, and expiry.
- The contract checks the current owner of both chosen Chogs at mint. It does not transfer or approve CHOG NFTs.
- Pact receipts are soulbound; transfer and approval are blocked.
- The immutable resolver alone can record a match winner. The backend checks the authoritative battle row before submitting settlement.
- Only the recorded winner can confirm fulfilment.
- There is no owner, upgrade mechanism, or arbitrary metadata editor.
- Conditions are public and permanent. Do not accept private, dangerous, illegal, harassing, or non-consensual demands.

Next validation: run the full flow with two authorized Discord accounts and separate wallets on the deployed app. Test the challenge signing, Pact mint event verification, finished-match settlement, and winner confirmation. Compare both receipts' `tokenURI()` output before/after settlement and fulfilment. Treat any failure as a blocker; do not accept real official matches until this passes.
