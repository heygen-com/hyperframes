import { strict as assert } from "node:assert";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { appendRecord, readManifest } from "./lib/manifest.mjs";
import { regenerateIndex } from "./lib/index-gen.mjs";
import { getProvider } from "./lib/providers.mjs";
import { freezeLocalFile } from "./lib/freeze.mjs";
import { cachePut, cacheGet, importFromCache } from "./lib/cache.mjs";
import { validateCubeFile } from "./lib/cube-validate.mjs";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const RESOLVE_CLI = join(import.meta.dirname, "resolve.mjs");
// The "Test: skills" CI job has no ffmpeg on PATH (by design). The smart-grade
// test shells to ffmpeg, so it's skipped there and runs where ffmpeg exists.
const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
// The core-conformance test imports core's TypeScript via tsx. The dependency-free
// "Test: skills" CI job has neither tsx nor installed deps, so skip it there; it
// runs wherever the workspace is installed (locally, the main Test job).
const CAN_TSX =
  spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", "0"], {
    stdio: "ignore",
  }).status === 0;
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

function spawnResolve(args, opts = {}) {
  return spawnSync(process.execPath, [RESOLVE_CLI, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    ...opts,
  });
}

function makeFrame(dir, name, color) {
  const out = join(dir, name);
  execFileSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      `color=c=${color}:s=64x64`,
      "-frames:v",
      "1",
      "-y",
      out,
    ],
    { stdio: "pipe" },
  );
  return out;
}

function normalizeWithCoreSource(grading) {
  const sourcePath = join(REPO_ROOT, "packages/core/src/colorGrading.ts");
  const code = `
    import { normalizeHfColorGrading } from ${JSON.stringify(sourcePath)};
    const grading = JSON.parse(process.env.HF_GRADING_JSON);
    const normalized = normalizeHfColorGrading(grading);
    if (!normalized) process.exit(2);
    console.log(JSON.stringify({
      preset: normalized.preset,
      intensity: normalized.intensity,
      adjust: normalized.adjust,
      lut: normalized.lut,
      colorSpace: normalized.colorSpace
    }));
  `;
  return JSON.parse(
    execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, HF_GRADING_JSON: JSON.stringify(grading) },
    }),
  );
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
  assert.ok(out.includes("--for"));
  assert.ok(out.includes("--from"));
  assert.ok(out.includes("--local-only"));
});

test("unknown type error lists grade and lut", () => {
  try {
    runResolve(["--type", "bogus", "--intent", "x"], { stdio: "pipe" });
    assert.fail("should have exited");
  } catch (err) {
    assert.equal(err.status, 2);
    assert.match(String(err.stderr), /known: .*grade.*lut/);
  }
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

test("--doctor --json reports dependency checks and top-level ok requires ffmpeg and ffprobe", () => {
  const result = spawnResolve(["--doctor", "--json"]);
  assert.match(result.stdout.trim(), /^\{/);
  assert.equal(result.stderr, "");
  assert.ok(result.status === 0 || result.status === 1);

  const parsed = JSON.parse(result.stdout.trim());
  assert.ok(Array.isArray(parsed.checks));

  const expected = [
    "heygen on PATH",
    "heygen version",
    "heygen authenticated",
    "ffmpeg on PATH",
    "ffprobe on PATH",
    "node version",
  ];
  const byName = new Map(parsed.checks.map((check) => [check.name, check]));
  for (const name of expected) {
    assert.ok(byName.has(name), `missing check: ${name}`);
    const check = byName.get(name);
    assert.equal(typeof check.ok, "boolean", `${name}.ok`);
    assert.equal(typeof check.detail, "string", `${name}.detail`);
    assert.ok("fix" in check, `${name}.fix`);
  }

  const ffmpeg = byName.get("ffmpeg on PATH");
  const ffprobe = byName.get("ffprobe on PATH");
  const strictOk = ffmpeg.ok && ffprobe.ok;
  assert.equal(parsed.ok, strictOk);
  assert.equal(result.status, strictOk ? 0 : 1);
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

// --- color grading ---

test("grade resolves a preset-only look with no cube file", () => {
  setup();
  const out = runResolve([
    "--type",
    "grade",
    "--intent",
    "warm daylight",
    "--project",
    tmp,
    "--json",
  ]);
  const parsed = JSON.parse(out.trim());
  assert.equal(parsed.ok, true);
  assert.equal(parsed.type, "grade");
  assert.equal(parsed.grading.preset, "warm-daylight");
  assert.equal(parsed.grading.lut, undefined);
  assert.equal(parsed.path, undefined);
  assert.equal(readManifest(tmp).length, 1);
  cleanup();
});

test("grade resolves a library LUT look and freezes a validated cube", () => {
  setup();
  const out = runResolve([
    "--type",
    "grade",
    "--intent",
    "teal orange blockbuster",
    "--project",
    tmp,
    "--json",
  ]);
  const parsed = JSON.parse(out.trim());
  assert.equal(parsed.ok, true);
  assert.match(parsed.grading.lut.src, /^\.media\/luts\/grade_001\.cube$/);
  assert.equal(parsed.path, parsed.grading.lut.src);
  assert.ok(existsSync(join(tmp, parsed.grading.lut.src)));
  assert.equal(validateCubeFile(join(tmp, parsed.grading.lut.src)).ok, true);
  cleanup();
});

test("smart grade merges measured adjust and keeps stdout valid JSON", () => {
  if (!HAS_FFMPEG) {
    console.log("  (skipped: ffmpeg not on PATH)");
    return;
  }
  setup();
  const frame = makeFrame(tmp, "under.png", "0x202020");
  const proc = spawnResolve([
    "--type",
    "grade",
    "--intent",
    "warm cinematic",
    "--for",
    frame,
    "--project",
    tmp,
    "--json",
  ]);
  assert.equal(proc.status, 0, proc.stderr);
  const parsed = JSON.parse(proc.stdout);
  assert.equal(parsed.ok, true);
  assert.ok(parsed.grading.adjust.exposure > 0, "under-exposed frame should suggest lift");
  assert.match(proc.stderr, /media-use: measured/);
  cleanup();
});

test("emitted grading block survives the core normalizeHfColorGrading contract", () => {
  if (!CAN_TSX) {
    console.log("  (skipped: tsx / core source unavailable)");
    return;
  }
  setup();
  const out = runResolve([
    "--type",
    "grade",
    "--intent",
    "teal orange blockbuster",
    "--project",
    tmp,
    "--json",
  ]);
  const parsed = JSON.parse(out.trim());
  const normalized = normalizeWithCoreSource(parsed.grading);
  assert.equal(normalized.lut.src, parsed.grading.lut.src);
  assert.equal(normalized.lut.intensity, parsed.grading.lut.intensity);
  assert.equal(normalized.colorSpace, "rec709");
  cleanup();
});

test("lut resolves only the frozen cube path", () => {
  setup();
  const out = runResolve([
    "--type",
    "lut",
    "--intent",
    "teal orange blockbuster",
    "--project",
    tmp,
    "--json",
  ]);
  const parsed = JSON.parse(out.trim());
  assert.equal(parsed.ok, true);
  assert.equal(parsed.type, "lut");
  assert.match(parsed.path, /^\.media\/luts\/lut_001\.cube$/);
  assert.equal(parsed.grading, undefined);
  assert.equal(validateCubeFile(join(tmp, parsed.path)).ok, true);
  cleanup();
});

test("lut --params builds, validates, and freezes a cube", () => {
  setup();
  const params = { contrast: 0.2, temperature: -0.3 };
  const out = runResolve(["-t", "lut", "--params", JSON.stringify(params), "-p", tmp, "--json"]);
  const parsed = JSON.parse(out.trim());
  assert.equal(parsed.ok, true);
  assert.equal(parsed.type, "lut");
  assert.match(parsed.path, /^\.media\/luts\/lut_001\.cube$/);
  assert.equal(parsed.description, "custom parametric lut");
  assert.equal(parsed.provenance.provider, "cube_lut.builder");
  assert.deepEqual(parsed.provenance.params, params);
  assert.ok(existsSync(join(tmp, parsed.path)));
  assert.equal(validateCubeFile(join(tmp, parsed.path)).ok, true);
  cleanup();
});

test("grade --params returns a grading block with a frozen valid cube", () => {
  setup();
  const out = runResolve([
    "-t",
    "grade",
    "--params",
    JSON.stringify({ exposure: 0.2 }),
    "-p",
    tmp,
    "--json",
  ]);
  const parsed = JSON.parse(out.trim());
  assert.equal(parsed.ok, true);
  assert.equal(parsed.type, "grade");
  assert.equal(parsed.grading.intensity, 1);
  assert.match(parsed.grading.lut.src, /^\.media\/luts\/grade_001\.cube$/);
  assert.equal(parsed.lut.src, parsed.grading.lut.src);
  assert.equal(parsed.path, parsed.grading.lut.src);
  assert.equal(validateCubeFile(join(tmp, parsed.grading.lut.src)).ok, true);
  cleanup();
});

test("--params malformed JSON errors cleanly without freezing a cube", () => {
  setup();
  const proc = spawnResolve(["-t", "lut", "--params", "{not json", "-p", tmp, "--json"]);
  assert.equal(proc.status, 1, proc.stderr);
  const parsed = JSON.parse(proc.stdout);
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /^invalid --params JSON:/);
  assert.equal(readManifest(tmp).length, 0);
  assert.equal(existsSync(join(tmp, ".media/luts")), false);
  cleanup();
});

// buildCube clamps every accepted parameter and resolve.mjs does not expose
// the size argument, so there is no CLI input that can make --params emit a
// structurally invalid cube. Invalid cube cleanup is covered through --from.
test("--from rejects invalid lut cube without registering or leaving a frozen file", () => {
  setup();
  const broken = join(tmp, "broken.cube");
  writeFileSync(broken, "LUT_3D_SIZE 999\n");
  const proc = spawnResolve(["--from", broken, "-t", "lut", "-p", tmp, "--json"]);
  assert.equal(proc.status, 1, proc.stderr);
  const parsed = JSON.parse(proc.stdout);
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /^ingested LUT is invalid: LUT_3D_SIZE 999 exceeds max 64/);
  assert.equal(readManifest(tmp).length, 0);
  const lutDir = join(tmp, ".media/luts");
  assert.deepEqual(existsSync(lutDir) ? readdirSync(lutDir) : [], []);
  cleanup();
});

test("grade miss exits explicitly with no partial file", () => {
  setup();
  const missIntent = `zqxv imaginary neutron ${process.pid}`;
  try {
    runResolve(["--type", "grade", "--intent", missIntent, "--project", tmp, "--json"]);
    assert.fail("should have exited");
  } catch (err) {
    assert.equal(err.status, 1);
    const parsed = JSON.parse(String(err.stdout));
    assert.equal(parsed.ok, false);
    assert.match(parsed.error, /no local color grade could resolve/);
    assert.equal(readManifest(tmp).length, 0);
    assert.equal(existsSync(join(tmp, ".media/luts")), false);
  }
  cleanup();
});

test("identical grade resolve hits the project cache without re-freezing", () => {
  setup();
  const first = JSON.parse(
    runResolve([
      "--type",
      "grade",
      "--intent",
      "teal orange blockbuster",
      "--project",
      tmp,
      "--json",
    ]),
  );
  const second = JSON.parse(
    runResolve([
      "--type",
      "grade",
      "--intent",
      "teal orange blockbuster",
      "--project",
      tmp,
      "--json",
    ]),
  );
  assert.equal(second._source, "cached");
  assert.equal(second.id, first.id);
  assert.equal(second.path, first.path);
  assert.equal(readManifest(tmp).length, 1);
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
