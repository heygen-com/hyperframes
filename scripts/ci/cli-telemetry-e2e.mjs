#!/usr/bin/env node
/**
 * End-to-end check that `hyperframes add` reports what it installed, and that
 * `hyperframes render` reports what it rendered.
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
import { spawn, spawnSync } from "node:child_process";
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
const fixtureTransportUrl = `http://127.0.0.1:${server.address().port}`;
const registryUrl = `https://registry-${server.address().port}.fixture.invalid`;

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
  // Test-only transport mapping: exercise the HTTPS registry contract without
  // provisioning TLS. Redirect enforcement has separate transport unit tests.
  const parsed = new URL(url);
  if (parsed.origin === ${JSON.stringify(registryUrl)}) {
    return realFetch(${JSON.stringify(fixtureTransportUrl)} + parsed.pathname + parsed.search, init);
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

// `render` telemetry: a real composition through the real pipeline. One fixture
// sets every probed property and its pair sets none, so each is asserted on
// both sides. ffmpeg/browser_version_major's Docker-absent side has no runtime
// here; events.test.ts covers that side instead.

// This harness's own HF_ vars would read back as operator overrides in the rendered
// event, so every render below starts from an environment carrying none of them.
const HF_ENV_RE = /^(HF|HYPERFRAMES)_/;
function withoutHfEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !HF_ENV_RE.test(k)));
}

const PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8DwHwAFAAH/RVeu5AAAAABJRU5ErkJggg==";

/** The size the composition declares. The mismatched fixture's CSS sits far enough below
 * it to land in the 51+ delta bucket; the matched fixture's CSS is this exact size. */
const COMPOSITION_SIZE = { width: 800, height: 450 };
const MISMATCHED_CSS_SIZE = { width: 640, height: 360 };

const MEDIA_MARKUP = `<img src="pixel.png" data-start="0" data-duration="1" alt="" />
      <audio src="tone.wav" data-start="0" data-duration="1" data-volume="0.3"></audio>`;

function fixtureHtml(cssSize, media) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${cssSize.width}px; height: ${cssSize.height}px; overflow: hidden; background: #111; }
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="e2e-render"
      data-start="0"
      data-duration="1"
      data-width="${COMPOSITION_SIZE.width}"
      data-height="${COMPOSITION_SIZE.height}"
      data-no-timeline
    >
      ${media}
    </div>
  </body>
</html>
`;
}

function writeFixtureMedia(dir) {
  writeFileSync(join(dir, "pixel.png"), Buffer.from(PIXEL_PNG_BASE64, "base64"));
  const ffmpeg = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000",
      "-t",
      "1",
      "-y",
      join(dir, "tone.wav"),
    ],
    { stdio: "inherit" },
  );
  if (ffmpeg.status !== 0) {
    throw new Error(`fixture audio generation failed (ffmpeg exit ${ffmpeg.status})`, {
      cause: ffmpeg.error,
    });
  }
}

function writeRenderFixture(dir, { mismatched, withMedia }) {
  const cssSize = mismatched ? MISMATCHED_CSS_SIZE : COMPOSITION_SIZE;
  const media = withMedia ? MEDIA_MARKUP : "";
  writeFileSync(join(dir, "index.html"), fixtureHtml(cssSize, media));
  if (withMedia) writeFixtureMedia(dir);
}

function renderCompleteEvents(batches) {
  return batches.flatMap((b) => b.batch).filter((e) => e.event === "render_complete");
}

function runRender(fixtureDir, { extraEnv = {}, skill } = {}) {
  const capture = join(fixtureDir, "telemetry.jsonl");
  const outputPath = join(fixtureDir, "out.mp4");
  const args = [
    "render",
    fixtureDir,
    "--quality",
    "draft",
    "--workers",
    "1",
    "--output",
    outputPath,
  ];
  if (skill) args.push("--skill", skill);
  return new Promise((done) => {
    const child = spawn(process.execPath, ["--require", hookPath, cliPath, ...args], {
      env: { ...withoutHfEnv(process.env), TELEMETRY_CAPTURE_FILE: capture, ...extraEnv },
      stdio: "ignore",
    });
    child.on("close", (status) => {
      const batches = readBatches(capture);
      done({ status, outputPath, batches, completeEvents: renderCompleteEvents(batches) });
    });
  });
}

console.log(
  "render: positive fixture (media present, root/body mismatched, skill flag, env override)",
);
const posDir = mkdtempSync(join(sandbox, "render-pos-"));
writeRenderFixture(posDir, { mismatched: true, withMedia: true });
const pos = await runRender(posDir, {
  extraEnv: { HYPERFRAMES_E2E_MARKER: "1" },
  skill: "e2e-smoke-test",
});
const posEvent = pos.completeEvents[0]?.properties ?? {};
check("render succeeded", pos.status === 0, pos.status);
check("output file written", existsSync(pos.outputPath));
check(
  "exactly one render_complete event",
  pos.completeEvents.length === 1,
  pos.completeEvents.length,
);
check("audio_count is 1", posEvent.audio_count === 1, posEvent.audio_count);
check("image_count is 1", posEvent.image_count === 1, posEvent.image_count);
check(
  "root_body_mismatch is true",
  posEvent.root_body_mismatch === true,
  posEvent.root_body_mismatch,
);
check(
  "root_body_delta_px_bucket is 51+",
  posEvent.root_body_delta_px_bucket === "51+",
  posEvent.root_body_delta_px_bucket,
);
check(
  "authoring_skill_source is flag",
  posEvent.authoring_skill_source === "flag",
  posEvent.authoring_skill_source,
);
check(
  "hf_env_overrides includes the injected var",
  Array.isArray(posEvent.hf_env_overrides) &&
    posEvent.hf_env_overrides.includes("HYPERFRAMES_E2E_MARKER"),
  posEvent.hf_env_overrides,
);
check(
  "ffmpeg_version_major is a positive number",
  typeof posEvent.ffmpeg_version_major === "number" && posEvent.ffmpeg_version_major > 0,
  posEvent.ffmpeg_version_major,
);
check(
  "browser_version_major is a positive number",
  typeof posEvent.browser_version_major === "number" && posEvent.browser_version_major > 0,
  posEvent.browser_version_major,
);

console.log("render: negative fixture (no media, root/body matched, no skill flag, clean env)");
const negDir = mkdtempSync(join(sandbox, "render-neg-"));
writeRenderFixture(negDir, { mismatched: false, withMedia: false });
const neg = await runRender(negDir);
const negEvent = neg.completeEvents[0]?.properties ?? {};
check("render succeeded", neg.status === 0, neg.status);
check("audio_count is 0", negEvent.audio_count === 0, negEvent.audio_count);
check("image_count is 0", negEvent.image_count === 0, negEvent.image_count);
check(
  "root_body_mismatch is false",
  negEvent.root_body_mismatch === false,
  negEvent.root_body_mismatch,
);
check(
  "root_body_delta_px_bucket is 0",
  negEvent.root_body_delta_px_bucket === "0",
  negEvent.root_body_delta_px_bucket,
);
check(
  "authoring_skill_source is absent, not a falsy placeholder",
  !("authoring_skill_source" in negEvent),
  negEvent.authoring_skill_source,
);
check(
  "hf_env_overrides is an empty array",
  Array.isArray(negEvent.hf_env_overrides) && negEvent.hf_env_overrides.length === 0,
  negEvent.hf_env_overrides,
);

server.close();
rmSync(sandbox, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll checks passed.");
