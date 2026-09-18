#!/usr/bin/env tsx
// Loads every generated docs-catalog payload in real headless Chrome and
// fails on any 404 or page error a static markup scan can't see.
//
// Usage: npx tsx scripts/verify-catalog-payloads.ts [--only <item>]

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
// Import from source — bun workspace linking doesn't resolve for scripts outside packages/.
import { launchVerifyBrowser, checkPageLoads } from "../packages/producer/src/verifyStaticPage.js";
import { HOSTED_EXTENSIONS, MIME_TYPES } from "./catalog-payload-assets.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
// The generator writes every asset URL as "/public/catalog/...", matching
// Mintlify serving docs/ as the site root with public/ as an ordinary
// subfolder — so the server root here is docs/, not docs/public/.
const siteRoot = join(scriptDir, "..", "docs");
const docsPublic = join(siteRoot, "public");
const payloadRoot = join(docsPublic, "catalog");

function parseArgs(): { only: string | null } {
  const argv = process.argv.slice(2);
  const at = argv.indexOf("--only");
  return { only: at !== -1 ? (argv[at + 1] ?? null) : null };
}

function payloadFiles(only: string | null): { item: string; path: string }[] {
  return ["blocks", "components"].flatMap((kind) => {
    const dir = join(payloadRoot, kind);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => ({ item: name.slice(0, -5), path: join(dir, name) }))
      .filter(({ item }) => !only || item === only);
  });
}

// "/" is the bootstrap navigation target before setContent() replaces the
// document, and favicon.ico is Chrome's own auto-request; neither is part
// of the payload under test, so both must succeed quietly.
const BOOTSTRAP_PATHS = new Set(["/", "/favicon.ico"]);

function sendOk(
  res: import("node:http").ServerResponse,
  body: string | Buffer,
  contentType: string,
): void {
  res.writeHead(200, { "Content-Type": contentType });
  res.end(body);
}

// Mintlify serves docs/public through an extension allowlist, so anything outside
// HOSTED_EXTENSIONS 404s there; refuse it here too. `.json` is also servable (curled a
// live payload URL, got 200), and the vendor scripts under catalog/vendor/ rely on it.
const EXTRA_HOSTED_EXTENSIONS = new Set([".json"]);

function isWithinSite(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return (
    filePath.startsWith(siteRoot) &&
    (HOSTED_EXTENSIONS.has(ext) || EXTRA_HOSTED_EXTENSIONS.has(ext)) &&
    existsSync(filePath)
  );
}

function mimeFor(filePath: string): string {
  return MIME_TYPES[extname(filePath)] ?? "application/octet-stream";
}

function serveSiteFile(requestPath: string, res: import("node:http").ServerResponse): void {
  if (BOOTSTRAP_PATHS.has(requestPath)) return sendOk(res, "<!doctype html>", "text/html");
  const filePath = join(siteRoot, requestPath);
  if (!isWithinSite(filePath)) {
    res.writeHead(404);
    res.end();
    return;
  }
  sendOk(res, readFileSync(filePath), mimeFor(filePath));
}

async function startServer(): Promise<{ origin: string; close: () => void }> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    serveSiteFile(decodeURIComponent(url.pathname), res);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { origin: `http://localhost:${port}/`, close: () => server.close() };
}

async function checkAll(
  browser: Awaited<ReturnType<typeof launchVerifyBrowser>>,
  origin: string,
  items: { item: string; path: string }[],
): Promise<number> {
  let failed = 0;
  for (const { item, path } of items) {
    const { html } = JSON.parse(readFileSync(path, "utf-8")) as { html: string };
    const { failures } = await checkPageLoads(browser, origin, html);
    if (failures.length > 0) {
      failed += 1;
      console.log(`✗ ${item}`);
      for (const failure of failures) console.log(`    ${failure}`);
    } else {
      console.log(`✓ ${item}`);
    }
  }
  return failed;
}

async function main(): Promise<void> {
  const { only } = parseArgs();
  const items = payloadFiles(only);
  if (items.length === 0) {
    console.error(only ? `No payload found for "${only}".` : "No payloads found.");
    process.exit(1);
  }

  const { origin, close } = await startServer();
  console.log(`Checking ${items.length} catalog payload(s) in headless Chrome...\n`);
  const browser = await launchVerifyBrowser();
  let failed = 0;
  try {
    failed = await checkAll(browser, origin, items);
  } finally {
    await browser.close();
    close();
  }

  if (failed > 0) {
    console.error(`\n${failed} payload(s) fail to load without a 404 or page error.`);
    process.exit(1);
  }
  console.log("\nAll payloads load without a failed request or page error.");
}

main();
