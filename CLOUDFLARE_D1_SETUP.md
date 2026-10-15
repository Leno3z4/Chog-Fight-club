# Cloudflare D1 setup for Chog Fight Club

The invitation feature uses **Cloudflare D1**, Cloudflare's native serverless SQL database. It does not use Supabase.

## 1. Create the database

In the Cloudflare dashboard, open **Workers & Pages → D1 SQL Database → Create database**. Use a name such as:

```text
chog-fight-club
```

Keep the database name and ID available for the next steps.

## 2. Apply the schema in the dashboard

Open the D1 database you just created and select **Console**. Open the [migration SQL file](https://raw.githubusercontent.com/Leno3z4/Chog-Fight-club/discord-gate-invitations/migrations/0001_challenge_invites.sql), copy all of it, paste it into the D1 Console, and press **Execute**. You should see the table and indexes created.

No terminal is needed.

## 3. Wrangler configuration is in the repository

The branch now contains [wrangler.jsonc](https://github.com/Leno3z4/Chog-Fight-club/blob/discord-gate-invitations/wrangler.jsonc) with:

- **Binding:** `CHOG_DB`
- **Database:** `chog-fight-club`
- **Database ID:** `8b61a704-51a0-40c0-a6dd-0f46bb81589e`

This matches the details in your screenshot. The config is in the branch, not deployed to your live Pages project until Cloudflare builds that branch.

Before deploying, check that your Cloudflare Pages project's name is `chog-fight-club`. The Wrangler `name` field should match the actual Pages project name. If your project has a different name, tell me the exact name and I'll adjust the file.

## 4. Configure Cloudflare Pages secrets

Under your Pages project settings, add the server-side environment variables:

- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_REDIRECT_URI` — must exactly match the callback URL registered in Discord's Developer Portal, e.g. `https://YOUR-PROJECT.pages.dev/api/discord/callback`
- `SESSION_SECRET` — use a long random secret
- `OPENSEA_API_KEY`
- `MONAD_RPC_URL` — recommended value: `https://rpc.monad.xyz`

The default Discord guild is `1253481714710220810` and the holder role is `1545507860455096460`. You can override them with `DISCORD_GUILD_ID` and `DISCORD_HOLDER_ROLE_ID` if necessary.

Never prefix server secrets with `VITE_`. Vite variables are bundled into browser code. After updating environment variables, redeploy the Pages project.

## 5. Discord Developer Portal

Add the exact callback URL to the Discord application's OAuth2 redirect URI allowlist. Enable the scopes requested by the app: `identify` and `guilds.members.read`. The user must already belong to the configured guild and have the holder role; the server checks this with Discord rather than trusting the browser.

## 6. Skip local terminal testing

You said you're using the Cloudflare dashboard, so skip the local Wrangler commands. Apply the schema in the D1 Console, add secrets in Pages settings, and let the Git-connected Pages deployment build the configured branch.

## 7. Test the invitation flow

After the D1 binding and Discord settings have been deployed:

1. Sign in as a holder and confirm the profile opens.
2. Connect the wallet and approve the message signature. This signature links an address to the Discord session; it does not authorize transactions.
3. Load the Chog roster and select a Chog currently owned by that wallet.
4. Open **Invite to battle**, enter the opponent's numeric Discord user ID, write a harmless condition, confirm the disclosure, and create the invitation.
5. Send the generated URL to that user. They must sign in with the exact account ID the invitation targets.
6. The recipient chooses their own Chog and accepts the condition. Both players can then mark themselves ready.
7. Refresh the page or open the invite link in a fresh browser session to confirm the invitation remains persisted.

The ready state does not launch a real synchronized multiplayer match yet. The authoritative PvP relay, Pact NFT contract/mint, result verification, and fulfillment confirmation are still separate work. Do not mint winner metadata from a client-only battle result.

## Cloudflare D1 plan limit note

Cloudflare's current D1 limits documentation lists **5 GB total storage across a Free account**, while **each individual Free database is capped at 500 MB**. Invitation rows are small text/metadata records; use retention and cleanup policies if the project grows. Free-plan read/write limits also apply.

Official docs:
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/pages/functions/bindings/
