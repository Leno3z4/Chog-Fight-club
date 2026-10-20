# Chog Arena multiplayer implementation research

## Findings

A Cloudflare Durable Object can coordinate multiple long-lived WebSocket clients for one room. Cloudflare notes that hibernation clears in-memory state, so a room that uses hibernation must restore connection state from serialized attachments or storage. The current arena runs frequent gameplay ticks, so the implementation should retain the existing active room simulation and not introduce hibernation without an explicit state-recovery design. Cloudflare recommends batching high-frequency updates into time-based messages around 50 to 100 ms, which is consistent with the current client's 50 ms input cadence. [Cloudflare Durable Objects: Use WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)

Phaser's client/server tutorial describes the client as responsible for player input and rendering, while the server broadcasts shared game state. For Chog Arena, the stronger fit is to keep the current Durable Object authoritative for movement, hit outcomes, health, and match status. Each client sends only its own controls and renders both players from received room snapshots. This reuses the existing invite and match rules rather than trusting either browser to decide combat results. [Phaser: Socket.io Phaser 3 Tutorial](https://phaser.io/news/2018/05/socket-io-phaser-3-tutorial)

Phaser's Scale Manager documents `FIT` as preserving the configured game aspect ratio inside a parent container. The online scene can therefore share the practice arena's fixed world dimensions and scale to the available lobby area without stretching the Chog rig. [Phaser Help: Scale Manager](https://docs.phaser.io/phaser/concepts/scale-manager)

## Implementation constraints

Keep the invitation acceptance, readiness, and Pact flow intact. Do not open the playable arena before the match is accepted and ready. Keep NFT identity and Battle DNA on the existing verified server path. Use the existing layered Chog PNGs and rig logic, with the room snapshot driving remote fighter position, facing, pose, and hit feedback. No third-party code or artwork is being copied.

## Production wiring audit (2026-10-20)

The latest code now lives on the launch-hardening branch while CI validates it before merge. Cloudflare confirms that `chog-battle-arena-realtime` is deployed and that its Durable Object namespace (`ARENA_ROOMS`), D1 binding (`CHOG_DB`), shared `SESSION_SECRET`, and frontend-origin variable are configured. The Worker endpoint is enabled. The main API Worker `chog-fight-club` remains separate from the real-time Worker; Vercel still serves the website and same-origin proxy routes.

The previous October 18 audit's statements that the real-time Worker URL and deployment were unconfirmed are stale. Deployment/configuration checks are not a substitute for a live two-account playthrough. The Pact mint → real-time match → settlement → fulfilment lifecycle must still be tested with two authorized Discord accounts and separate Monad wallets before official matches are considered ready. The existing Pact factory is immutable; see `PACT_FACTORY_DEPLOYMENT.md` for the limitations around disputed results and winner non-response.
