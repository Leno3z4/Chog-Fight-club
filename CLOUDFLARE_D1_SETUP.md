# Cloudflare D1 backend setup for Chog Battle Arena

**Vercel hosts the website and Discord sign-in. Cloudflare is used for the persistent invitation API and D1 database.** Users should keep browsing the Vercel site; its `/api/invites` function forwards invitation requests to Cloudflare.

## 1. D1 database

Your database details are:

- Database: `chog-fight-club`
- Binding: `CHOG_DB`
- Database ID: `8b61a704-51a0-40c0-a6dd-0f46bb81589e`

Open **Cloudflare Dashboard → Workers & Pages → D1 SQL Database → chog-fight-club → Console**. Run these migrations one at a time, in order. Copy all SQL from [`migrations/0001_challenge_invites.sql`](https://raw.githubusercontent.com/Leno3z4/Chog-Fight-club/main/migrations/0001_challenge_invites.sql), paste it in Console, and click **Execute**. Then apply [`migrations/0002_player_directory.sql`](https://raw.githubusercontent.com/Leno3z4/Chog-Fight-club/feature/pvp-battle-engine-pact-nft/migrations/0002_player_directory.sql), [`migrations/0003_authoritative_battles.sql`](https://raw.githubusercontent.com/Leno3z4/Chog-Fight-club/feature/pvp-battle-engine-pact-nft/migrations/0003_authoritative_battles.sql), and [`migrations/0004_pact_nft_signatures.sql`](https://raw.githubusercontent.com/Leno3z4/Chog-Fight-club/feature/pvp-battle-engine-pact-nft/migrations/0004_pact_nft_signatures.sql), and [`migrations/0005_pact_settlement.sql`](https://raw.githubusercontent.com/Leno3z4/Chog-Fight-club/feature/pvp-battle-engine-pact-nft/migrations/0005_pact_settlement.sql), in that order. Migration 0003 stores server-authoritative battle state, 0004 stores signatures and minted receipt IDs, and 0005 stores on-chain settlement/fulfilment transactions. Do not apply 0003–0005 to production until the feature branch has been reviewed and merged.

## 2. Bind D1 to the Pages backend

Open **Workers & Pages → your Pages project → Settings → Bindings → Add → D1 database**.

Set **Variable name** to exactly `CHOG_DB`, select the database above, save, and redeploy.

## 3. Fix the failed Cloudflare deployment

The build log shows the deploy command is `npx wrangler deploy`. That is the wrong command for a Pages project; it attempts to deploy a Worker and fails with “Missing entry-point to Worker script or to assets directory.”

In the Cloudflare project’s build settings, set:

- **Build command:** `npm run build`
- **Build output directory:** `dist`

If your dashboard is showing a separate **Deploy command** field (as in the log you sent), change that command from `npx wrangler deploy` to:

```text
npx wrangler pages deploy dist --project-name=chog-fight-club
```

That deploy command must run after the build command. If you are using the normal Git-connected Pages build settings that deploy automatically, do not add a separate deploy command at all. The project name in the command must match the actual Pages project name.

## 4. Cloudflare backend settings

In **Pages → Settings → Variables and Secrets**, set:

- `SESSION_SECRET` — exactly the same value configured in Vercel
- `MONAD_RPC_URL` — `https://rpc.monad.xyz`
- `OPENSEA_API_KEY` — server-side secret used to read Chog metadata for combat stats
- `PACT_FACTORY_ADDRESS` — set only after the factory is deployed and the website integration has been tested
- `PACT_CHAIN_ID=143` — Monad mainnet chain ID
- `PACT_RESOLVER_ADDRESS` — dedicated wallet passed as the factory's immutable resolver
- `PACT_RESOLVER_PRIVATE_KEY` — the resolver's private key, stored as a Cloudflare secret only; fund this wallet with enough MON for settlement transactions

The matching session secret is required because Vercel signs the Discord session and Cloudflare validates that same signed session before allowing invitation access. Do not share or commit the secret.

The Discord OAuth client ID, client secret, and redirect URI belong on **Vercel**, not Cloudflare, because the live browser signs in at the Vercel domain.

## 5. Configure Vercel to reach Cloudflare

In **Vercel → your Chog Battle Arena project → Settings → Environment Variables**, set:

- `CLOUDFLARE_BACKEND_URL` — the base URL of your deployed Pages backend, e.g. `https://chog-fight-club.pages.dev`
- `SESSION_SECRET` — same exact value as Cloudflare
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_REDIRECT_URI=https://chog-fight-club.vercel.app/api/discord/callback`
- `OPENSEA_API_KEY`
- `MONAD_RPC_URL=https://rpc.monad.xyz`

If your actual Vercel or Cloudflare hostname differs, use the exact hostname shown in that platform's dashboard.

## 6. Discord redirect

In [Discord Developer Portal](https://discord.com/developers/applications) → your application → **OAuth2**, add this exact Redirect URL:

`https://chog-fight-club.vercel.app/api/discord/callback`

The URL must match `DISCORD_REDIRECT_URI` on Vercel. Do not register the Pages URL as the callback.

## 7. Test

After both deployments and variables are set:

1. Open the Vercel website.
2. Click **Connect Discord**; the URL should remain on the Vercel domain until Discord's own authorization page opens.
3. After authorization, Discord should return to the Vercel callback and send you to the profile.
4. Connect the Monad wallet and sign the wallet-link message.
5. Open **Invite to battle**, type at least two characters of the opponent's Discord username, and select them from the results. Create the invitation and verify it appears in the sent list. Open it as the intended Discord user to test acceptance.

Players become searchable after signing in once; search matches the start of their Discord username or display name. If a target has not joined yet, choose the exact-username invite fallback. The invite remains pending for that handle until the matching Discord account accepts, when its stable ID is bound internally. After acceptance, both players use the same `/battle-lobby.html?id=...` room link. The shared lobby exists, but synchronized combat and Pact NFT minting are still separate tasks.

