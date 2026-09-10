// Media downloads use public HTTP(S) URLs. Validate every redirect target;
// a provider result must meet the same host policy as a direct ingest URL.
// Public HTTPS-to-HTTP redirects are allowed, matching direct HTTP support.
// This is a literal-host policy, not DNS pinning: DNS resolution remains trusted.

import { BlockList, isIP } from "node:net";

const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
])
  blocked.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
])
  blocked.addSubnet(network, prefix, "ipv6");

export function isPublicMediaUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const host = url.hostname.replace(/\.$/, "");
    if (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.endsWith(".internal")
    )
      return false;
    const address = host.replace(/^\[|\]$/g, "");
    const family = isIP(address);
    return family === 0 || !blocked.check(address, family === 4 ? "ipv4" : "ipv6");
  } catch {
    return false;
  }
}

export async function fetchMedia(url, { method = "GET", signal, fetchImpl = fetch } = {}) {
  let current = String(url);
  for (let hop = 0; hop <= 5; hop++) {
    if (!isPublicMediaUrl(current))
      throw new Error("Media download blocked: URL is not public HTTP(S)");
    const response = await fetchImpl(current, { method, signal, redirect: "manual" });
    if (!(response.status >= 300 && response.status < 400)) return response;
    const location = response.headers.get("location");
    if (!location) return response;
    await response.body?.cancel();
    current = new URL(location, current).href;
  }
  throw new Error("Media download exceeded redirect limit");
}
