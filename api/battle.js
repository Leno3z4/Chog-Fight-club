import { proxyToCloudflare } from "../server/cloudflareProxy.js";

export default function handler(req, res) {
  return proxyToCloudflare(req, res, { path: "/api/battle", methods: ["GET", "POST"] });
}
