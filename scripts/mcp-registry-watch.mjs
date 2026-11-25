// Fails when the MCP registry lists a server under a HeyGen namespace at a name and version server.json never held.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const REGISTRY = "https://registry.modelcontextprotocol.io/v0.1/servers";
// heygen.com and every subdomain (the registry's DNS and HTTP logins grant both), and the GitHub org.
const OURS = ["com.heygen/", "com.heygen.", "io.github.heygen-com/"];

/** Every name@version among server.json's texts. @param {string[]} texts */
export function publishedListings(texts) {
  const published = new Set();
  for (const text of texts) {
    try {
      const { name, version } = JSON.parse(text);
      if (name && version) published.add(`${name}@${version}`);
    } catch {}
  }
  return published;
}

/** @param {{ server: { name: string, version: string } }[]} servers @param {Set<string>} published */
export function unexpectedListings(servers, published) {
  return servers
    .map(({ server }) => `${server.name}@${server.version}`)
    .filter((id) => OURS.some((prefix) => id.startsWith(prefix)) && !published.has(id));
}

function serverJsonHistory() {
  const git = (...args) =>
    execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return git("log", "--format=%H", "--", "server.json")
    .split("\n")
    .filter(Boolean)
    .map((sha) => {
      try {
        return git("show", `${sha}:server.json`);
      } catch {
        return "";
      }
    });
}

async function registryListings() {
  const servers = [];
  let cursor = "";
  do {
    const url = new URL(REGISTRY);
    url.searchParams.set("search", "heygen");
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    const page = await response.json();
    servers.push(...page.servers);
    cursor = page.metadata?.nextCursor ?? "";
  } while (cursor);
  return servers;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const servers = await registryListings();
  const unexpected = unexpectedListings(servers, publishedListings(serverJsonHistory()));
  if (unexpected.length) {
    console.error(
      `::error::the MCP registry lists HeyGen servers server.json never held: ${unexpected.join(", ")}`,
    );
    process.exit(1);
  }
  console.log(
    `${servers.length} listing(s) checked; every HeyGen one is a name and version server.json held`,
  );
}
