# Chog Arena multiplayer implementation research

## Findings

A Cloudflare Durable Object can coordinate multiple long-lived WebSocket clients for one room. Cloudflare notes that hibernation clears in-memory state, so a room that uses hibernation must restore connection state from serialized attachments or storage. The current arena runs frequent gameplay ticks, so the implementation should retain the existing active room simulation and not introduce hibernation without an explicit state-recovery design. Cloudflare recommends batching high-frequency updates into time-based messages around 50 to 100 ms, which is consistent with the current client's 50 ms input cadence. [Cloudflare Durable Objects: Use WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)

Phaser's client/server tutorial describes the client as responsible for player input and rendering, while the server broadcasts shared game state. For Chog Arena, the stronger fit is to keep the current Durable Object authoritative for movement, hit outcomes, health, and match status. Each client sends only its own controls and renders both players from received room snapshots. This reuses the existing invite and match rules rather than trusting either browser to decide combat results. [Phaser: Socket.io Phaser 3 Tutorial](https://phaser.io/news/2018/05/socket-io-phaser-3-tutorial)

Phaser's Scale Manager documents `FIT` as preserving the configured game aspect ratio inside a parent container. The online scene can therefore share the practice arena's fixed world dimensions and scale to the available lobby area without stretching the Chog rig. [Phaser Help: Scale Manager](https://docs.phaser.io/phaser/concepts/scale-manager)

## Implementation constraints

Keep the invitation acceptance, readiness, and Pact flow intact. Do not open the playable arena before the match is accepted and ready. Keep NFT identity and Battle DNA on the existing verified server path. Use the existing layered Chog PNGs and rig logic, with the room snapshot driving remote fighter position, facing, pose, and hit feedback. No third-party code or artwork is being copied.

## Production wiring audit (2026-10-18)

The Vercel project `chog-fight-club` reports a READY production deployment from Git branch `main`, commit `ff96d7f4b1f53e8be39bf1ebe7d3eefc342aee56` (`Trim remaining decorative labels`). The project metadata reports Node.js 24.x, but does not expose the configured build command or production environment-variable names, so those settings remain unverified. This task's integration branch is local and is not included in that deployment. The Cloudflare account lists a Worker named `chog-battle-arena-realtime`, but its deployed source is older than this implementation: it permits `PENDING_ACCEPTANCE` sockets and its player broadcasts omit the Chog token ID and attack-action timestamps required by the new Phaser arena. The candidate URL `https://chog-battle-arena-realtime.gatakehanami.workers.dev/health` returned HTTP 404 with Cloudflare error code 1042, so that hostname is not confirmed as the current Worker URL.

The repository's `.env.example` documents `VITE_ARENA_REALTIME_URL` as the public Worker URL. The production environment-variable values were not inspected. To activate this integration, deploy the updated Worker, set `VITE_ARENA_REALTIME_URL` to its confirmed public URL, and ensure the Vercel ticket signer and Cloudflare Worker use the same server-side `SESSION_SECRET`. No secrets were read, and no commit, push, or deployment was made.
