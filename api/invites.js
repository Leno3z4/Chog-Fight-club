import { proxyToCloudflare } from "../server/cloudflareProxy.js";

export default function handler(req, res) {
  return proxyToCloudflare(req, res, { path: "/api/invites", methods: ["GET", "POST"] });
}
