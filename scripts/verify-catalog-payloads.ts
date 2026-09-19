#!/usr/bin/env tsx
// Loads every generated docs-catalog payload in headless Chrome; fails on a 404 or page error.
// Usage: npx tsx scripts/verify-catalog-payloads.ts [--only <item>] [--changed <git-ref>]
// --changed checks only payloads that differ from <git-ref>, which is what CI runs.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, extname, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
// Import from source — bun workspace linking doesn't resolve for scripts outside packages/.
import { launchVerifyBrowser, checkPageLoads } from "../packages/producer/src/verifyStaticPage.js";
import { HOSTED_EXTENSIONS, MIME_TYPES } from "./catalog-payload-assets.js";
import { runAsCommand } from "./entrypoint.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
// The generator writes every asset URL as "/public/catalog/...", matching
// Mintlify serving docs/ as the site root with public/ as an ordinary
// subfolder — so the server root here is docs/, not docs/public/.
const siteRoot = join(scriptDir, "..", "docs");
const docsPublic = join(siteRoot, "public");
const payloadRoot = join(docsPublic, "catalog");

function parseArgs(): { only: string | null; changed: string | null } {
  const argv = process.argv.slice(2);
  const valueOf = (flag: string) => {
    const at = argv.indexOf(flag);
    return at !== -1 ? (argv[at + 1] ?? null) : null;
  };
  return { only: valueOf("--only"), changed: valueOf("--changed") };
}

const PAYLOAD_PATH = /^docs\/public\/catalog\/(?:blocks|components)\/([^/]+)\.json$/;

/** Item names whose payload file appears in `git diff --name-only` output. */
export function itemsFromDiff(diffOutput: string): Set<string> {
  const items = new Set<string>();
  for (const line of diffOutput.split("\n")) {
    const item = PAYLOAD_PATH.exec(line.trim())?.[1];
    if (item) items.add(item);
  }
  return items;
}

function changedItems(ref: string): Set<string> {
  const out = execFileSync(
    "git",
    ["diff", "--name-only", "--diff-filter=ACMR", `${ref}...HEAD`, "--", "docs/public/catalog"],
    { encoding: "utf-8", cwd: join(scriptDir, "..") },
  );
  return itemsFromDiff(out);
}

function payloadFiles(
  only: string | null,
  changed: Set<string> | null,
): { item: string; path: string }[] {
  return ["blocks", "components"].flatMap((kind) => {
    const dir = join(payloadRoot, kind);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => ({ item: name.slice(0, -5), path: join(dir, name) }))
      .filter(({ item }) => (!only || item === only) && (!changed || changed.has(item)));
  });
}

/** The page error a WebGPU piece throws in a browser with no adapter. */
export const MISSING_ADAPTER = /no WebGPU adapter/i;

/** Whether the item's manifest declares the "webgpu" tag, the one owner of "needs a WebGPU adapter". */
export function declaresWebgpu(kindDir: string, item: string): boolean {
  const manifest = join(scriptDir, "..", "registry", kindDir, item, "registry-item.json");
  if (!existsSync(manifest)) return false;
  const { tags } = JSON.parse(readFileSync(manifest, "utf-8")) as { tags?: string[] };
  return tags?.includes("webgpu") ?? false;
}

/** A WebGPU piece cannot draw in a CI browser with no adapter, and whatever library reports that
 * does so in its own words. So a declared piece's page errors and console errors are the environment;
 * its failed or 404 requests still count, as does every failure of an undeclared piece. */
export function withoutWebgpuRuntimeErrors(webgpu: boolean, failures: string[]): string[] {
  if (!webgpu) return failures;
  return failures.filter((failure) => !/^(pageerror|console\.error): /.test(failure));
}

/** Chrome aborts a media element's first request when it reissues it as range requests (or when
 * the page closes mid-stream). That is playback, not a broken URL; a 404 or DNS failure still counts. */
export function withoutAbortedMedia(failures: string[]): string[] {
  return failures.filter(
    (failure) => !/^request failed: \S+\.(mp4|m4a|webm|mov) \(net::ERR_ABORTED\)$/i.test(failure),
  );
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

type VerifyBrowser = Awaited<ReturnType<typeof launchVerifyBrowser>>;

/** Loads one payload and prints its result; true when it failed. A marker payload has nothing to load. */
async function checkOne(browser: VerifyBrowser, origin: string, item: string, path: string) {
  const payload = JSON.parse(readFileSync(path, "utf-8")) as {
    html?: string;
    unsupported?: string;
  };
  if (payload.html === undefined) {
    console.log(`- ${item} (no live payload: ${payload.unsupported})`);
    return false;
  }
  const checked = await checkPageLoads(browser, origin, payload.html);
  const declared = declaresWebgpu(basename(dirname(path)), item);
  const failures = withoutAbortedMedia(withoutWebgpuRuntimeErrors(declared, checked.failures));
  console.log(`${failures.length > 0 ? "✗" : "✓"} ${item}`);
  for (const failure of failures) console.log(`    ${failure}`);
  return failures.length > 0;
}

async function checkAll(
  browser: VerifyBrowser,
  origin: string,
  items: { item: string; path: string }[],
): Promise<number> {
  let failed = 0;
  for (const { item, path } of items) {
    if (await checkOne(browser, origin, item, path)) failed += 1;
  }
  return failed;
}

function reportNoPayloads(only: string | null, changed: string | null): void {
  if (changed) {
    console.log(`No catalog payload differs from ${changed}; nothing to verify.`);
    return;
  }
  console.error(only ? `No payload found for "${only}".` : "No payloads found.");
  process.exit(1);
}

async function main(): Promise<void> {
  const { only, changed } = parseArgs();
  const items = payloadFiles(only, changed ? changedItems(changed) : null);
  if (items.length === 0) return reportNoPayloads(only, changed);

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

runAsCommand(import.meta.url, main);
