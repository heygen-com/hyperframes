// Media downloads use public HTTP(S) URLs. Validate every redirect target;
// a provider result must meet the same host policy as a direct ingest URL.
// Public HTTPS-to-HTTP redirects are allowed, matching direct HTTP support.
// A host name is resolved once and the connection dials that checked address.

import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import { Readable } from "node:stream";

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
    return isIP(address) === 0 || !isBlockedAddress(address);
  } catch {
    return false;
  }
}

function isBlockedAddress(address) {
  const bare = address.split("%")[0];
  const family = isIP(bare);
  return family === 0 || blocked.check(bare, family === 4 ? "ipv4" : "ipv6");
}

function publicOnlyLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (error, answers) => {
    if (error) return callback(error);
    if (answers.length === 0 || answers.some((a) => isBlockedAddress(a.address)))
      return callback(new Error("Media download blocked: host resolves to a non-public address"));
    if (options.all) return callback(null, answers);
    callback(null, answers[0].address, answers[0].family);
  });
}

function publicFetch(url, { method = "GET", signal } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === "https:" ? https : http;
    const request = client.request(
      target,
      {
        method,
        signal,
        agent: false,
        lookup: publicOnlyLookup,
        headers: { accept: "*/*", "user-agent": "node" },
      },
      (res) => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(res.headers))
          for (const one of [value].flat()) if (one !== undefined) headers.append(name, one);
        const empty = method === "HEAD" || [204, 205, 304].includes(res.statusCode);
        try {
          resolve(
            new Response(empty ? null : Readable.toWeb(res), {
              status: res.statusCode,
              statusText: res.statusMessage,
              headers,
            }),
          );
          if (empty) res.resume();
        } catch (error) {
          res.destroy();
          reject(error);
        }
      },
    );
    request.on("error", reject);
    request.end();
  });
}

// Tests replace `fetch` here; every default download goes through it.
export const mediaTransport = { fetch: publicFetch };

export async function fetchMedia(
  url,
  { method = "GET", signal, fetchImpl = mediaTransport.fetch } = {},
) {
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

// Stream and abort once the cap is crossed, so a lying or chunked body can't buffer past it.
export async function readCappedBody(res, maxBytes, label) {
  const declared = Number(res.headers.get("content-length"));
  if (declared > maxBytes) throw new Error(`${label}: ${declared} bytes exceeds ${maxBytes} cap`);
  const chunks = [];
  let total = 0;
  for await (const chunk of res.body) {
    total += chunk.length;
    if (total > maxBytes) throw new Error(`${label}: stream exceeds ${maxBytes} cap`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}
