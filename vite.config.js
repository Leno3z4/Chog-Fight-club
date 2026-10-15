import { defineConfig, loadEnv } from "vite";
import { fileURLToPath } from "node:url";
import {
  findOwnedChogTokenIds,
  OpenSeaLookupError,
  CHOG_COLLECTION,
  CHOG_CONTRACT,
} from "./server/openSeaChogs.js";

export default defineConfig(({ mode }) => {
  // Read all environment keys server-side for the local-only API middleware.
  // Only VITE_* values are exposed to browser code; never prefix the OpenSea key with VITE_.
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [{
      name: "chog-opensea-local-api",
      configureServer(server) {
        server.middlewares.use("/api/chogs", async (req, res) => {
          const url = new URL(req.url ?? "/", "http://localhost");
          const send = (status, payload) => {
            res.statusCode = status;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify(payload));
          };

          if (req.method !== "GET") {
            res.setHeader("Allow", "GET");
            return send(405, { error: "Method not allowed." });
          }

          try {
            const tokenIds = await findOwnedChogTokenIds({
              owner: url.searchParams.get("owner"),
              apiKey: env.OPENSEA_API_KEY,
            });
            res.setHeader("Cache-Control", "private, max-age=15, stale-while-revalidate=30");
            return send(200, {
              source: "opensea",
              collection: CHOG_COLLECTION,
              contract: CHOG_CONTRACT,
              tokenIds,
              count: tokenIds.length,
            });
          } catch (error) {
            if (error instanceof OpenSeaLookupError && error.retryAfter) {
              res.setHeader("Retry-After", error.retryAfter);
            }
            if (!(error instanceof OpenSeaLookupError) || error.status >= 500) {
              res.setHeader("Cache-Control", "private, no-store");
            }
            const status = error instanceof OpenSeaLookupError ? error.status : 502;
            const message = error instanceof OpenSeaLookupError
              ? error.message
              : "OpenSea could not return the Chog roster right now.";
            const code = error instanceof OpenSeaLookupError ? error.code : "OPENSEA_REQUEST_FAILED";
            if (status >= 500) console.error("OpenSea Chog lookup failed", code);
            return send(status, { error: message, code });
          }
        });
      },
    }],
    build: {
      rollupOptions: {
        input: {
          main: fileURLToPath(new URL("./index.html", import.meta.url)),
          battle: fileURLToPath(new URL("./battle.html", import.meta.url)),
          roster: fileURLToPath(new URL("./roster.html", import.meta.url)),
        },
      },
    },
  };
});
