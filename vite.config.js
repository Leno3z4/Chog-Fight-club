import { defineConfig, loadEnv } from "vite";
import { fileURLToPath } from "node:url";
import {
  findOwnedChogTokenIds,
  OpenSeaLookupError,
  CHOG_COLLECTION,
  CHOG_CONTRACT,
} from "./server/openSeaChogs.js";
import {
  startDiscordOAuth,
  finishDiscordOAuth,
  readDiscordSession,
  endDiscordSession,
} from "./server/discordAuth.js";

export default defineConfig(({ mode }) => {
  // Read keys on the dev server only. Never expose API secrets as VITE_* variables.
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [{
      name: "chog-local-server-routes",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const requestUrl = new URL(req.url ?? "/", "http://localhost");
          const pathname = requestUrl.pathname;
          if (!pathname.startsWith("/api/discord/")) return next();

          const origin = env.DISCORD_APP_ORIGIN || "http://localhost:5173";
          const secure = origin.startsWith("https://");
          const sendJson = (status, payload, headers = {}) => {
            res.statusCode = status;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
            res.end(JSON.stringify(payload));
          };
          const redirect = (result) => {
            res.statusCode = result.status;
            res.setHeader("Location", result.location);
            if (result.cookies?.length) res.setHeader("Set-Cookie", result.cookies);
            res.setHeader("Cache-Control", "no-store");
            res.end();
          };

          try {
            if (pathname === "/api/discord/login" && req.method === "GET") {
              return redirect(await startDiscordOAuth({ origin, env, secure }));
            }
            if (pathname === "/api/discord/callback" && req.method === "GET") {
              return redirect(await finishDiscordOAuth({
                requestUrl: new URL(requestUrl.pathname + requestUrl.search, origin).toString(),
                cookieHeader: req.headers.cookie || "",
                env,
                secure,
              }));
            }
            if (pathname === "/api/discord/session" && req.method === "GET") {
              res.setHeader("Cache-Control", "private, no-store");
              return sendJson(200, await readDiscordSession({ cookieHeader: req.headers.cookie || "", env }));
            }
            if (pathname === "/api/discord/logout" && req.method === "POST") {
              const result = endDiscordSession({ secure });
              res.setHeader("Set-Cookie", result.cookies);
              res.setHeader("Cache-Control", "no-store");
              return sendJson(200, result.body);
            }
            return sendJson(405, { error: "Method not allowed." }, { Allow: pathname.endsWith("/logout") ? "POST" : "GET" });
          } catch (error) {
            if (pathname === "/api/discord/login") {
              const target = new URL("/", origin);
              target.searchParams.set("error", error?.code || "DISCORD_CONFIG_MISSING");
              return redirect({ status: 302, location: target.toString() });
            }
            console.error("Local Discord auth handler failed", error?.code || error?.name || "Error");
            return sendJson(500, { error: "Discord authentication could not be completed." });
          }
        });

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
            if (error instanceof OpenSeaLookupError && error.retryAfter) res.setHeader("Retry-After", error.retryAfter);
            if (!(error instanceof OpenSeaLookupError) || error.status >= 500) res.setHeader("Cache-Control", "private, no-store");
            const status = error instanceof OpenSeaLookupError ? error.status : 502;
            const message = error instanceof OpenSeaLookupError ? error.message : "OpenSea could not return the Chog roster right now.";
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
          landing: fileURLToPath(new URL("./landing.html", import.meta.url)),
          profile: fileURLToPath(new URL("./profile.html", import.meta.url)),
          battle: fileURLToPath(new URL("./battle.html", import.meta.url)),
          roster: fileURLToPath(new URL("./roster.html", import.meta.url)),
        },
      },
    },
  };
});
