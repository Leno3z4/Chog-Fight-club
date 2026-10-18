import { proxyToCloudflare } from "../../server/cloudflareProxy.js";

export default function handler(req, res) {
  return proxyToCloudflare(req, res, { path: "/api/discord/login", methods: ["GET"] });
}
