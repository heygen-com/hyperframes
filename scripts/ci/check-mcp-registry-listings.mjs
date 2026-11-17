#!/usr/bin/env node
// Checks that every version of HeyGen's listings in the official MCP registry still points at the hosted
// HyperFrames MCP. The registry grants io.github.heygen-com/* to a GitHub token from any workflow in any
// heygen-com repository, so that name stays open to anyone with write access after the move to com.heygen.
// Run daily by .github/workflows/watch-mcp-registry.yml; exits 1 and names each problem.
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

const REGISTRY = "https://registry.modelcontextprotocol.io/v0";
const NAMESPACES = ["io.github.heygen-com/", "com.heygen/"];
const OUR_REMOTE = "https://mcp.heygen.com/";
// Versions published before the move; the old name gets no new ones.
const KNOWN = new Map([
  ["io.github.heygen-com/hyperframes", new Set(["1.0.0"])],
  ["com.heygen/hyperframes", null],
]);

/** Each listing is { name, versions: [server.json as the registry returns it] }. */
export function listingProblems(listings) {
  return listings.flatMap(({ name, versions }) => {
    if (!NAMESPACES.some((prefix) => name.startsWith(prefix))) return [];
    if (!KNOWN.has(name)) return [`${name} is listed under a HeyGen name we did not publish`];
    const frozen = KNOWN.get(name);
    return versions.flatMap((server) => [
      ...(frozen && !frozen.has(server.version)
        ? [`${name} ${server.version} is a version we did not publish`]
        : []),
      ...(server.remotes ?? [])
        .filter((remote) => !String(remote.url).startsWith(OUR_REMOTE))
        .map((remote) => `${name} ${server.version} points at ${remote.url}`),
      ...(server.packages?.length
        ? [`${name} ${server.version} lists packages we did not publish`]
        : []),
    ]);
  });
}

async function getJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

async function namesUnder(prefix) {
  const names = new Set();
  let cursor;
  do {
    const query = new URLSearchParams({
      search: prefix,
      limit: "100",
      ...(cursor ? { cursor } : {}),
    });
    const page = await getJson(`${REGISTRY}/servers?${query}`);
    for (const { server } of page.servers ?? [])
      if (server.name.startsWith(prefix)) names.add(server.name);
    cursor = page.metadata?.nextCursor;
  } while (cursor);
  return [...names];
}

export async function fetchListings() {
  const names = [
    ...new Set([...KNOWN.keys(), ...(await Promise.all(NAMESPACES.map(namesUnder))).flat()]),
  ];
  return Promise.all(
    names.map(async (name) => {
      const response = await fetch(`${REGISTRY}/servers/${encodeURIComponent(name)}/versions`);
      if (response.status === 404) return { name, versions: [] };
      if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
      const { servers = [] } = await response.json();
      return { name, versions: servers.map(({ server }) => server) };
    }),
  );
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  const listings = await fetchListings();
  const problems = listingProblems(listings);
  for (const { name, versions } of listings)
    console.log(`${name}: ${versions.map((server) => server.version).join(", ") || "not listed"}`);
  if (problems.length) {
    for (const problem of problems) console.log(`::error::${problem}`);
    process.exit(1);
  }
}
