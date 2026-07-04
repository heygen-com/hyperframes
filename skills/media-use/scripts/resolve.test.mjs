import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { appendRecord, readManifest } from "./lib/manifest.mjs";
import { regenerateIndex } from "./lib/index-gen.mjs";
import { getProvider } from "./lib/providers.mjs";
import { freezeLocalFile } from "./lib/freeze.mjs";
import { cachePut, cacheGet, importFromCache } from "./lib/cache.mjs";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const RESOLVE_CLI = join(import.meta.dirname, "resolve.mjs");
let tmp;

function setup() {
  tmp = mkdtempSync(join(tmpdir(), "mu-resolve-test-"));
}

function cleanup() {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
}

function makeRecord(overrides = {}) {
  return {
    id: "bgm_001",
    type: "bgm",
    path: ".media/audio/bgm/bgm_001.wav",
    source: "search",
    description: "soft minimal ambient",
    duration: 11,
    provenance: { provider: "test", prompt: "test prompt" },
    ...overrides,
  };
}

// Run resolve.mjs with argv passed as a literal array (no shell). Each token is
// a separate argv entry, so a value with spaces or shell metacharacters can't
// break out — never build a command string and hand it to a shell.
function runResolve(args, opts = {}) {
  return execFileSync(process.execPath, [RESOLVE_CLI, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    ...opts,
  });
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// --- manifest cache hit ---

test("project manifest hit skips providers", () => {
  setup();
  const record = makeRecord({ provenance: { prompt: "cached query", provider: "test" } });
  appendRecord(tmp, record);
  const filePath = join(tmp, record.path);
  mkdirSync(join(filePath, ".."), { recursive: true });
  writeFileSync(filePath, "cached audio");

  const out = runResolve(["--type", "bgm", "--intent", "cached query", "--project", tmp, "--json"]);
  const parsed = JSON.parse(out.trim());
  assert.equal(parsed.ok, true);
  assert.equal(parsed.id, "bgm_001");
  assert.equal(parsed._source, "cached");
  cleanup();
});

test("entity hit matches across icon/image (figma-imported brand marks)", () => {
  setup();
  const record = makeRecord({
    id: "image_001",
    type: "image",
    path: ".media/images/image_001.svg",
    description: "Acme logo",
    entity: "Acme logo",
    provenance: { source: "figma", fileKey: "KEY", nodeId: "1:2", version: "1", format: "svg" },
  });
  delete record.duration;
  appendRecord(tmp, record);
  const filePath = join(tmp, record.path);
  mkdirSync(join(filePath, ".."), { recursive: true });
  writeFileSync(filePath, "<svg/>");

  const out = runResolve([
    "--type",
    "icon",
    "--intent",
    "acme brand mark",
    "--entity",
    "Acme logo",
    "--project",
    tmp,
    "--json",
  ]);
  const parsed = JSON.parse(out.trim());
  assert.equal(parsed.ok, true);
  assert.equal(parsed.id, "image_001");
  assert.equal(parsed._source, "cached");
  cleanup();
});

// --- global cache hit ---

test("global cache hit copies to project and registers", () => {
  setup();
  const sourceFile = join(tmp, "source.wav");
  writeFileSync(sourceFile, "cached globally for resolve");
  const record = makeRecord({ provenance: { prompt: "global resolve test" } });
  cachePut(sourceFile, record);

  const cached = cacheGet("global resolve test", "bgm");
  assert.ok(cached);

  const projectDir = mkdtempSync(join(tmpdir(), "mu-resolve-proj-"));
  const imported = importFromCache(cached, projectDir, "bgm_001", ".media/audio/bgm/bgm_001.wav");
  assert.ok(imported);
  assert.ok(existsSync(join(projectDir, ".media/audio/bgm/bgm_001.wav")));

  appendRecord(projectDir, imported);
  regenerateIndex(projectDir);
  const manifest = readManifest(projectDir);
  assert.equal(manifest.length, 1);
  assert.equal(manifest[0].provenance.imported_from, cached.sha);

  rmSync(projectDir, { recursive: true, force: true });
  cleanup();
});

// --- provider interface ---

test("getProvider returns provider with type", () => {
  const p = getProvider("bgm");
  assert.equal(p.type, "bgm");
  assert.ok(typeof p.search === "function");
});

test("getProvider throws for unknown type", () => {
  assert.throws(() => getProvider("unknown_type"), /unknown media type/);
});

// --- freeze ---

test("freezeLocalFile creates parent dirs and copies", () => {
  setup();
  const src = join(tmp, "src.bin");
  writeFileSync(src, "freeze test data");
  const dest = join(tmp, "deep/nested/dir/file.bin");
  freezeLocalFile(src, dest);
  assert.ok(existsSync(dest));
  assert.equal(readFileSync(dest, "utf8"), "freeze test data");
  cleanup();
});

// --- adopt existing assets ---

test("--adopt registers existing assets/ files", () => {
  setup();
  mkdirSync(join(tmp, "assets/bgm"), { recursive: true });
  mkdirSync(join(tmp, "assets/icons"), { recursive: true });
  writeFileSync(join(tmp, "assets/bgm/track.mp3"), "fake mp3");
  writeFileSync(join(tmp, "assets/icons/logo.svg"), "fake svg");

  const out = runResolve(["--adopt", "--project", tmp, "--json"]);
  const parsed = JSON.parse(out.trim());
  assert.equal(parsed.ok, true);
  assert.equal(parsed.adopted, 2);
  assert.ok(parsed.assets.some((a) => a.path === "assets/bgm/track.mp3"));
  assert.ok(parsed.assets.some((a) => a.path === "assets/icons/logo.svg"));

  const manifest = readManifest(tmp);
  assert.equal(manifest.length, 2);
  cleanup();
});

test("--adopt skips already-registered assets", () => {
  setup();
  mkdirSync(join(tmp, "assets/bgm"), { recursive: true });
  writeFileSync(join(tmp, "assets/bgm/track.mp3"), "fake mp3");

  runResolve(["--adopt", "--project", tmp, "--json"]);
  const out = runResolve(["--adopt", "--project", tmp, "--json"]);
  const parsed = JSON.parse(out.trim());
  assert.equal(parsed.adopted, 0);

  const manifest = readManifest(tmp);
  assert.equal(manifest.length, 1);
  cleanup();
});

test("resolve finds existing unregistered asset before hitting providers", () => {
  setup();
  mkdirSync(join(tmp, "assets/bgm"), { recursive: true });
  writeFileSync(join(tmp, "assets/bgm/ambient-track.mp3"), "existing bgm");

  const out = runResolve([
    "--type",
    "bgm",
    "--intent",
    "ambient track",
    "--project",
    tmp,
    "--json",
  ]);
  const parsed = JSON.parse(out.trim());
  assert.equal(parsed.ok, true);
  assert.equal(parsed.path, "assets/bgm/ambient-track.mp3");
  assert.equal(parsed._source, "existing");
  cleanup();
});

// --- CLI interface ---

test("--help exits 0", () => {
  const out = runResolve(["--help"]);
  assert.ok(out.includes("media-use resolve"));
  assert.ok(out.includes("--type"));
});

test("missing required args exits 2", () => {
  try {
    runResolve([], { stdio: "pipe" });
    assert.fail("should have exited");
  } catch (err) {
    assert.equal(err.status, 2);
  }
});

test("--json returns error JSON on stub provider failure", () => {
  setup();
  try {
    runResolve(["--type", "bgm", "--intent", "stub fail", "--project", tmp, "--json"], {
      stdio: "pipe",
    });
    assert.fail("should have exited");
  } catch (err) {
    const output = err.stdout || "";
    const parsed = JSON.parse(output.trim());
    assert.equal(parsed.ok, false);
    assert.ok(parsed.error.includes("no provider"));
  }
  cleanup();
});

test("one-line output format matches contract", () => {
  setup();
  const record = makeRecord({ provenance: { prompt: "format test", provider: "test" } });
  appendRecord(tmp, record);
  const filePath = join(tmp, record.path);
  mkdirSync(join(filePath, ".."), { recursive: true });
  writeFileSync(filePath, "format check");

  const out = runResolve(["--type", "bgm", "--intent", "format test", "--project", tmp]);
  assert.match(out.trim(), /^resolved bgm_001 → .media\/audio\/bgm\/bgm_001\.wav \(bgm/);
  cleanup();
});

// --- run ---

async function main() {
  console.log("media-use · resolve engine tests\n");
  let passed = 0;
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      passed++;
      console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    } catch (err) {
      failed++;
      console.log(`  \x1b[31m✗\x1b[0m ${name}`);
      console.log(`    ${err.message}`);
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
