#!/usr/bin/env node
/**
 * End-to-end check that `hyperframes add` reports what it installed.
 *
 * Unit tests can only assert the emit seam. `shouldTrack()` short-circuits
 * whenever `isDevMode()` is true, and that is true for any `.ts` entry — so
 * under vitest a real event and no event are indistinguishable, and nothing
 * downstream of `trackEvent` is exercised at all. This drives the BUILT CLI,
 * where the dev-mode short-circuit is off, and asserts on the HTTP body the
 * transport actually produces.
 *
 * Two fixtures, because neither case can be reached through the real registry:
 * a local registry (the origin is a first-class project setting,
 * `hyperframes.json#registry`) supplies an item with a `registryDependencies`
 * edge, which no shipped catalog item declares today; and `globalThis.fetch`
 * is wrapped so the batch is captured instead of sent. Faking a 200 is what
 * keeps this off production analytics — `flush()` only leaves events queued
 * when the request fails, and only a non-empty queue makes the exit handler
 * spawn the detached `flushSync` child that would bypass the hook.
 *
 * Usage: node scripts/ci/cli-telemetry-e2e.mjs [path/to/dist/cli.js]
 */

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cliPath = resolve(process.argv[2] ?? join(repoRoot, "packages/cli/dist/cli.js"));
if (!existsSync(cliPath)) {
  console.error(`Built CLI not found at ${cliPath} — run \`bun run build\` first.`);
  process.exit(1);
}

const BASE_COMPONENT = {
  $schema: "https://hyperframes.heygen.com/schema/registry-item.json",
  name: "e2e-base-component",
  type: "hyperframes:component",
  title: "E2E Base Component",
  description: "Dependency target",
  files: [
    {
      path: "e2e-base-component.html",
      target: "compositions/components/e2e-base-component/e2e-base-component.html",
      type: "hyperframes:snippet",
    },
  ],
};

const DEP_BLOCK = {
  $schema: "https://hyperframes.heygen.com/schema/registry-item.json",
  name: "e2e-dep-block",
  type: "hyperframes:block",
  title: "E2E Dep Block",
  description: "Block that pulls a component in behind it",
  dimensions: { width: 1920, height: 1080 },
  duration: 5,
  registryDependencies: ["e2e-base-component"],
  files: [
    {
      path: "e2e-dep-block.html",
      target: "compositions/e2e-dep-block.html",
      type: "hyperframes:composition",
    },
  ],
};

const ITEMS = { [BASE_COMPONENT.name]: BASE_COMPONENT, [DEP_BLOCK.name]: DEP_BLOCK };

// One function per route the registry client asks for — `fetchManifest`,
// `fetchItemManifest`, `fetchItemFile`. Each returns a response or null.
const json = (body) => ({ type: "application/json", body: JSON.stringify(body) });

function routeManifest(url) {
  if (!url.endsWith("/registry.json")) return null;
  return json({
    $schema: "https://hyperframes.heygen.com/schema/registry.json",
    name: "e2e-fixture",
    homepage: "https://example.invalid",
    items: Object.values(ITEMS).map((i) => ({ name: i.name, type: i.type })),
  });
}

function routeItem(url) {
  const match = /\/(blocks|components)\/([^/]+)\/registry-item\.json$/.exec(url);
  const item = match ? ITEMS[match[2]] : undefined;
  return item ? json(item) : null;
}

function routeFile(url) {
  const match = /\/(blocks|components)\/([^/]+)\/(.+)$/.exec(url);
  return match ? { type: "text/html", body: `<!-- ${match[3]} -->\n` } : null;
}

function route(url) {
  return routeManifest(url) ?? routeItem(url) ?? routeFile(url);
}

const server = createServer((req, res) => {
  const hit = route(req.url.split("?")[0]);
  if (!hit) {
    res.writeHead(404);
    return res.end("not found");
  }
  res.writeHead(200, { "Content-Type": hit.type });
  res.end(hit.body);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const registryUrl = `http://127.0.0.1:${server.address().port}`;

const sandbox = mkdtempSync(join(tmpdir(), "hf-telemetry-e2e-"));
const hookPath = join(sandbox, "capture-hook.cjs");
writeFileSync(
  hookPath,
  `const { appendFileSync, writeFileSync } = require("node:fs");
const OUT = process.env.TELEMETRY_CAPTURE_FILE;
writeFileSync(OUT, "");
const realFetch = globalThis.fetch;
globalThis.fetch = async function (input, init) {
  const url = typeof input === "string" ? input : (input && input.url) || String(input);
  if (url.includes("posthog")) {
    appendFileSync(OUT, (init && init.body) + "\\n");
    return new Response('{"status":1}', { status: 200 });
  }
  return realFetch(input, init);
};
`,
);

/** One captured PostHog request per line, each a `{ batch: [...] }` payload. */
function readBatches(capture) {
  const raw = existsSync(capture) ? readFileSync(capture, "utf-8").trim() : "";
  if (!raw) return [];
  return raw.split("\n").filter(Boolean).map(JSON.parse);
}

function addedEvents(batches) {
  return batches
    .flatMap((b) => b.batch)
    .filter((e) => e.event === "registry_item_added")
    .map((e) => ({
      item: e.properties.item,
      item_type: e.properties.item_type,
      requested: e.properties.requested,
    }));
}

// Async spawn, never spawnSync: the fixture registry is served from this very
// process, so a synchronous child would block the loop that has to answer it.
function runAdd(name, { optOut = "", doNotTrack = "" } = {}) {
  const projectDir = mkdtempSync(join(sandbox, "project-"));
  writeFileSync(
    join(projectDir, "hyperframes.json"),
    JSON.stringify({
      $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
      registry: registryUrl,
      paths: { blocks: "compositions", components: "compositions/components", assets: "assets" },
    }),
  );
  const capture = join(projectDir, "telemetry.jsonl");
  return new Promise((done) => {
    const child = spawn(
      process.execPath,
      ["--require", hookPath, cliPath, "add", name, "--dir", projectDir, "--no-clipboard"],
      {
        env: {
          ...process.env,
          HYPERFRAMES_NO_TELEMETRY: optOut,
          DO_NOT_TRACK: doNotTrack,
          TELEMETRY_CAPTURE_FILE: capture,
        },
        stdio: "ignore",
      },
    );
    child.on("close", (status) => {
      const batches = readBatches(capture);
      done({ status, projectDir, batches, added: addedEvents(batches) });
    });
  });
}

const failures = [];
function check(label, condition, detail) {
  console.log(`${condition ? "  ✓" : "  ✗"} ${label}`);
  if (!condition) {
    failures.push(label);
    if (detail !== undefined) console.log(`      got: ${JSON.stringify(detail)}`);
  }
}

console.log("add e2e-dep-block (installs a dependency behind the requested item)");
const tracked = await runAdd("e2e-dep-block");
check("install succeeded", tracked.status === 0, tracked.status);
check(
  "requested item written",
  existsSync(join(tracked.projectDir, "compositions/e2e-dep-block.html")),
);
check(
  "dependency written",
  existsSync(
    join(tracked.projectDir, "compositions/components/e2e-base-component/e2e-base-component.html"),
  ),
);
check("one event per installed item", tracked.added.length === 2, tracked.added);
check(
  "dependency reported, not as a request",
  JSON.stringify(tracked.added.find((a) => a.item === "e2e-base-component")) ===
    JSON.stringify({
      item: "e2e-base-component",
      item_type: "hyperframes:component",
      requested: false,
    }),
  tracked.added.find((a) => a.item === "e2e-base-component"),
);
check(
  "requested item reported as a request",
  JSON.stringify(tracked.added.find((a) => a.item === "e2e-dep-block")) ===
    JSON.stringify({ item: "e2e-dep-block", item_type: "hyperframes:block", requested: true }),
  tracked.added.find((a) => a.item === "e2e-dep-block"),
);

console.log("opt out");
for (const [label, env] of [
  ["HYPERFRAMES_NO_TELEMETRY=1", { optOut: "1" }],
  ["DO_NOT_TRACK=1", { doNotTrack: "1" }],
]) {
  const optedOut = await runAdd("e2e-dep-block", env);
  check(`${label} installs`, optedOut.status === 0, optedOut.status);
  // Zero BATCHES, not zero matching events: an opted-out install must make no
  // request at all, not a request that happens to omit this one event.
  check(`${label} sends nothing`, optedOut.batches.length === 0, optedOut.batches.length);
}

console.log("unknown item");
const unknown = await runAdd("e2e-item-that-does-not-exist");
check("install fails", unknown.status !== 0, unknown.status);
check("a refused install is not counted", unknown.added.length === 0, unknown.added);

server.close();
rmSync(sandbox, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll checks passed.");
