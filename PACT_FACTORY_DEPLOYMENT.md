# Pact NFT factory deployment

The contract is [`contracts/ChogBattlePactFactory.sol`](./contracts/ChogBattlePactFactory.sol). It is a single factory/collection contract. Each accepted official challenge mints two linked soulbound receipts.

## Current status and mainnet warning


**Monad mainnet deployment recorded (chain ID 143):**

- Factory: `0x3a5485d41cAcE651dBAba9f292C12b1Df425f950`
- Immutable resolver: `0x77DF3ae15b994131797905e59675da3544C90DFF`
- RPC: `https://rpc.monad.xyz`

The public factory/resolver addresses, chain ID, and RPC are defined in `wrangler.jsonc`, so they deploy with the Pages runtime. Add the resolver private key in Cloudflare Pages → Settings → Variables and Secrets as `PACT_RESOLVER_PRIVATE_KEY` with type **Secret** for the production environment (and preview if you test there). Never put the private key in `wrangler.jsonc`, source control, frontend variables, or chat. The key must derive exactly the resolver address above.

The application signing/mint/settlement integration is merged into `main`; the contract unit tests and CI checks passed. Cloudflare Pages, the D1 schema, and the real-time Worker are deployed.

**The full end-to-end lifecycle has not yet been exercised against a deployed factory. Do that with a test factory before deploying the immutable contract on Monad mainnet.** A mainnet deployment cannot be upgraded or repaired in place if a constructor address or contract bug is discovered later.

## Open the source

- [Open source on GitHub](https://github.com/Leno3z4/Chog-Fight-club/blob/main/contracts/ChogBattlePactFactory.sol)
- [Open the source in Remix](https://remix.ethereum.org/#url=https://raw.githubusercontent.com/Leno3z4/Chog-Fight-club/main/contracts/ChogBattlePactFactory.sol)

Compile with Solidity **0.8.24**, optimizer enabled, 200 runs, and **via-IR enabled**.

## Constructor arguments

1. `chogCollection_`: `0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763`
2. `matchResolver_`: a dedicated resolver wallet address. The address is immutable and is the only address allowed to call `settleMatch`. Use a wallet kept for this purpose, not an everyday wallet. The backend's Cloudflare Pages secret `PACT_RESOLVER_PRIVATE_KEY` must match `PACT_RESOLVER_ADDRESS`, and the resolver wallet needs MON for gas.

## Remix steps

1. Open the source link above and confirm that Remix loaded `ChogBattlePactFactory.sol`.
2. In **Solidity Compiler**, select **0.8.24**, enable optimization, set runs to **200**, and enable **via-IR**.
3. Compile and inspect the warnings. Do not deploy if compilation fails.
4. In **Deploy & Run Transactions**, select **Injected Provider** and verify the wallet is connected to **Monad Mainnet (chain ID 143)** before choosing Deploy.
5. Enter the two constructor arguments above, with your dedicated resolver wallet address as the second argument.
6. Deploy and save the resulting factory address. Check the deployed address/constructor values before using it.
7. In Cloudflare Pages → project `chog-fight-club` → Variables and Secrets, configure `PACT_FACTORY_ADDRESS` and `PACT_RESOLVER_ADDRESS`. Add `PACT_RESOLVER_PRIVATE_KEY` as a secret only. Never paste or commit the private key to GitHub, Vercel frontend environment variables, or chat.
8. Once these values are set, the Pact card can call the deployed contract. Until then, it correctly shows that the factory is not configured.

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

Run the full two-account flow against a test factory before treating the mainnet factory as production-ready.
