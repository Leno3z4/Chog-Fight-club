# Cloudflare D1 setup for Chog Fight Club

The invitation feature uses **Cloudflare D1**, Cloudflare's native serverless SQL database. It does not use Supabase.

## 1. Create the database

In the Cloudflare dashboard, open **Workers & Pages → D1 SQL Database → Create database**. Use a name such as:

```text
chog-fight-club
```

Keep the database name and ID available for the next steps.

## 2. Apply the schema

From a local checkout at the repository root, authenticate Wrangler if needed:

```bash
npx wrangler login
npx wrangler d1 execute chog-fight-club --remote --file=migrations/0001_challenge_invites.sql
```

Replace `chog-fight-club` if you gave the database another name. This applies the schema to the **remote** D1 database. Do not run it against the wrong account/database.

## 3. Bind D1 to the Cloudflare Pages project

Open **Workers & Pages → your Chog Fight Club Pages project → Settings → Bindings → Add → D1 database**.

Set:

- **Variable name:** `CHOG_DB`
- **D1 database:** the database created above

Save the binding and redeploy the Pages project. The Cloudflare Function receives the database through `env.CHOG_DB`. A binding named something else will not work unless the code is changed to match it.

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

## 6. Local Cloudflare Pages Functions testing

Vite's `npm run dev` is useful for frontend work, but D1 is provided by the Cloudflare runtime binding. For end-to-end local API testing, use Pages Functions via Wrangler:

```bash
cp .dev.vars.example .dev.vars
# Fill in the Discord client ID/secret, SESSION_SECRET, and OpenSea API key.
npm run build
npx wrangler d1 execute chog-fight-club --local --file=migrations/0001_challenge_invites.sql
npx wrangler d1 list
npx wrangler pages dev dist --d1 CHOG_DB=YOUR_D1_DATABASE_ID
```

Use the database ID shown by Wrangler for the `CHOG_DB` binding. Local D1 data is separate from production data. Use the local Pages URL and make sure `DISCORD_REDIRECT_URI` exactly matches that local callback URL while testing; update it back to the deployed URL when testing production.

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
