# Cloudflare D1 backend setup for Chog Battle Arena

**Vercel hosts the website and Discord sign-in. Cloudflare is used for the persistent invitation API and D1 database.** Users should keep browsing the Vercel site; its `/api/invites` function forwards invitation requests to Cloudflare.

## 1. D1 database

Your database details are:

- Database: `chog-fight-club`
- Binding: `CHOG_DB`
- Database ID: `8b61a704-51a0-40c0-a6dd-0f46bb81589e`

Open **Cloudflare Dashboard → Workers & Pages → D1 SQL Database → chog-fight-club → Console**. Copy all SQL from [`migrations/0001_challenge_invites.sql`](https://raw.githubusercontent.com/Leno3z4/Chog-Fight-club/main/migrations/0001_challenge_invites.sql), paste it in Console, and click **Execute**.

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
5. Create an invitation and verify it appears in the sent list. Open it as the intended Discord user to test acceptance.

The invite API does not yet launch a synchronized PvP match or mint a Pact NFT. Those are separate remaining tasks.

