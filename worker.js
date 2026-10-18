import { createPublicClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { onRequest as invites } from "./functions/api/invites.js";
import { onRequest as battle } from "./functions/api/battle.js";
import { onRequest as pacts } from "./functions/api/pacts.js";
import { onRequest as players } from "./functions/api/players.js";
import { onRequest as realtimeTicket } from "./functions/api/realtime-ticket.js";
import {
  startDiscordOAuth,
  finishDiscordOAuth,
  readDiscordSession,
  endDiscordSession,
  startWalletLink,
  finishWalletLink,
  DiscordAuthError,
} from "./server/discordAuth.js";
import {
  findOwnedChogTokenIds,
  OpenSeaLookupError,
  CHOG_COLLECTION,
  CHOG_CONTRACT,
} from "./server/openSeaChogs.js";

const DEFAULT_RPC = "https://rpc.monad.xyz";
const DEFAULT_FRONTEND_ORIGIN = "https://chog-fight-club.vercel.app";
const FACTORY_ABI = [{
  type: "function",
  name: "matchResolver",
  stateMutability: "view",
  inputs: [],
  outputs: [{ name: "", type: "address" }],
}];

function json(payload, status = 200, headers = {}) {
  return Response.json(payload, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

function redirectResponse(result) {
  const headers = new Headers({
    Location: result.location,
    "Cache-Control": "no-store",
  });
  for (const cookie of result.cookies || []) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: result.status || 302, headers });
}

function frontendOrigin(env) {
  const configured = String(env.DISCORD_APP_ORIGIN || "").trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === "https:" && !url.username && !url.password) return url.origin;
    } catch { /* Use the redirect URI fallback. */ }
  }
  try {
    const callback = new URL(String(env.DISCORD_REDIRECT_URI || ""));
    if (callback.protocol === "https:" && !callback.username && !callback.password) return callback.origin;
  } catch { /* Use the production frontend default. */ }
  return DEFAULT_FRONTEND_ORIGIN;
}

function addCookies(headers, cookies) {
  for (const cookie of cookies || []) headers.append("Set-Cookie", cookie);
}

async function authRoute(request, env) {
  const url = new URL(request.url);
  const origin = frontendOrigin(env);
  const cookieHeader = request.headers.get("Cookie") || "";
  const secure = origin.startsWith("https:");

  try {
    if (url.pathname === "/api/discord/login" && request.method === "GET") {
      const result = await startDiscordOAuth({
        origin,
        env,
        secure,
        returnTo: url.searchParams.get("returnTo") || "/profile.html",
      });
      return redirectResponse(result);
    }

    if (url.pathname === "/api/discord/callback" && request.method === "GET") {
      const callbackUrl = new URL(url.pathname + url.search, origin).toString();
      const result = await finishDiscordOAuth({
        requestUrl: callbackUrl,
        cookieHeader,
        env,
        secure,
      });
      return redirectResponse(result);
    }

    if (url.pathname === "/api/discord/session" && request.method === "GET") {
      return json(await readDiscordSession({ cookieHeader, env }), 200, {
        "Cache-Control": "private, no-store",
      });
    }

    if (url.pathname === "/api/discord/logout" && request.method === "POST") {
      const result = endDiscordSession({ secure });
      const headers = new Headers({ "Cache-Control": "no-store" });
      addCookies(headers, result.cookies);
      return new Response(JSON.stringify(result.body), {
        status: result.status || 200,
        headers,
      });
    }

    if (url.pathname === "/api/wallet/challenge" && request.method === "POST") {
      const result = await startWalletLink({ cookieHeader, env, origin, secure });
      const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      addCookies(headers, result.cookies);
      return new Response(JSON.stringify(result.body), { status: result.status || 200, headers });
    }

    if (url.pathname === "/api/wallet/verify" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const result = await finishWalletLink({
        cookieHeader,
        env,
        message: body?.message,
        signature: body?.signature,
        secure,
      });
      const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      addCookies(headers, result.cookies);
      return new Response(JSON.stringify(result.body), { status: result.status || 200, headers });
    }

    if (url.pathname.startsWith("/api/discord/") || url.pathname.startsWith("/api/wallet/")) {
      const methods = url.pathname.endsWith("/login") || url.pathname.endsWith("/callback") || url.pathname.endsWith("/session")
        ? ["GET"]
        : ["POST"];
      return json({ error: "Method not allowed.", code: "METHOD_NOT_ALLOWED" }, 405, { Allow: methods.join(", ") });
    }
    return null;
  } catch (error) {
    if (url.pathname === "/api/discord/login") {
      const target = new URL("/", origin);
      target.searchParams.set("error", error?.code || "DISCORD_CONFIG_MISSING");
      return redirectResponse({ status: 302, location: target.toString() });
    }
    const status = error instanceof DiscordAuthError ? error.status : 500;
    if (status >= 500) console.error("Worker auth handler failed", error?.code || error?.name || "Error");
    return json({
      error: error instanceof Error ? error.message : "Authentication request failed.",
      code: error?.code || "AUTH_REQUEST_FAILED",
    }, status);
  }
}

async function chogsRoute(request, env) {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed.", code: "METHOD_NOT_ALLOWED" }, 405, { Allow: "GET" });
  }
  const url = new URL(request.url);
  try {
    const tokenIds = await findOwnedChogTokenIds({
      owner: url.searchParams.get("owner"),
      apiKey: env.OPENSEA_API_KEY,
    });
    return json({
      source: "opensea",
      collection: CHOG_COLLECTION,
      contract: CHOG_CONTRACT,
      tokenIds,
      count: tokenIds.length,
    }, 200, { "Cache-Control": "private, max-age=15, stale-while-revalidate=30" });
  } catch (error) {
    const status = error instanceof OpenSeaLookupError ? error.status : 502;
    const headers = { "Cache-Control": status >= 500 ? "private, no-store" : "no-store" };
    if (error instanceof OpenSeaLookupError && error.retryAfter) headers["Retry-After"] = error.retryAfter;
    if (status >= 500) console.error("Worker Chog lookup failed", error?.code || error?.name || "Error");
    return json({
      error: error instanceof OpenSeaLookupError ? error.message : "OpenSea could not return the Chog roster right now.",
      code: error?.code || "OPENSEA_REQUEST_FAILED",
    }, status, headers);
  }
}

async function healthRoute(env) {
  const factory = String(env.PACT_FACTORY_ADDRESS || "");
  const resolver = String(env.PACT_RESOLVER_ADDRESS || "");
  const privateKey = String(env.PACT_RESOLVER_PRIVATE_KEY || "");
  const rpc = String(env.MONAD_RPC_URL || DEFAULT_RPC);
  const checks = {
    database: Boolean(env.CHOG_DB && typeof env.CHOG_DB.prepare === "function"),
    sessionSecret: Boolean(String(env.SESSION_SECRET || "").trim()),
    discordCredentials: Boolean(String(env.DISCORD_CLIENT_ID || "").trim() && String(env.DISCORD_CLIENT_SECRET || "").trim()),
    openSeaCredential: Boolean(String(env.OPENSEA_API_KEY || "").trim()),
    factoryConfigured: /^0x[a-fA-F0-9]{40}$/.test(factory),
    resolverConfigured: /^0x[a-fA-F0-9]{40}$/.test(resolver),
    resolverKeyPresent: /^0x[0-9a-fA-F]{64}$/.test(privateKey),
    resolverKeyMatchesAddress: false,
    rpcChainIsMonadMainnet: false,
    factoryHasCode: false,
    onchainResolverMatches: false,
  };

  try {
    if (checks.resolverKeyPresent && checks.resolverConfigured) {
      checks.resolverKeyMatchesAddress = privateKeyToAccount(privateKey).address.toLowerCase() === resolver.toLowerCase();
    }
  } catch { checks.resolverKeyMatchesAddress = false; }

  if (checks.factoryConfigured && checks.resolverConfigured) {
    try {
      const chain = defineChain({
        id: 143,
        name: "Monad",
        nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
        rpcUrls: { default: { http: [rpc] } },
      });
      const client = createPublicClient({ chain, transport: http(rpc, { timeout: 5000, retryCount: 0 }) });
      const [chainId, bytecode, onchainResolver] = await Promise.all([
        client.getChainId(),
        client.getBytecode({ address: factory }),
        client.readContract({ address: factory, abi: FACTORY_ABI, functionName: "matchResolver" }),
      ]);
      checks.rpcChainIsMonadMainnet = chainId === 143;
      checks.factoryHasCode = Boolean(bytecode && bytecode !== "0x");
      checks.onchainResolverMatches = String(onchainResolver).toLowerCase() === resolver.toLowerCase();
    } catch (error) {
      console.error("Worker health chain check failed", error?.name || "Error");
    }
  }

  const ok = checks.database && checks.sessionSecret && checks.discordCredentials
    && checks.factoryConfigured && checks.resolverConfigured && checks.resolverKeyPresent
    && checks.resolverKeyMatchesAddress && checks.rpcChainIsMonadMainnet
    && checks.factoryHasCode && checks.onchainResolverMatches;
  return json({ ok, service: "chog-fight-club-api", checks }, ok ? 200 : 503);
}

const routeHandlers = new Map([
  ["/api/invites", invites],
  ["/api/battle", battle],
  ["/api/pacts", pacts],
  ["/api/players", players],
  ["/api/realtime-ticket", realtimeTicket],
]);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") return healthRoute(env);
    if (url.pathname === "/api/chogs") return chogsRoute(request, env);

    const authResponse = await authRoute(request, env);
    if (authResponse) return authResponse;

    const handler = routeHandlers.get(url.pathname);
    if (handler) {
      try {
        return await handler({ request, env, ctx, params: {}, data: {} });
      } catch (error) {
        console.error("Worker API route failed", error?.code || error?.name || "Error");
        return json({ error: "The API request failed.", code: error?.code || "INTERNAL_ERROR" }, 500);
      }
    }

    return json({ error: "Not found.", code: "NOT_FOUND" }, 404);
  },
};
