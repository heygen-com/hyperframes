import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const HELPERS = [
  join(REPO_ROOT, "skills", "hyperframes-animation", "scripts", "animation-map.mjs"),
  join(REPO_ROOT, "skills", "hyperframes-creative", "scripts", "contrast-report.mjs"),
];

describe("HyperFrames skill helpers", () => {
  for (const helper of HELPERS)
    it(`${helper.split("/").at(-1)} bundles modular input and uses rational fps`, () => {
      const root = mkdtempSync(join(tmpdir(), "hyperframes-skill-helper-test-"));
      const packageDir = join(root, "node_modules", "@hyperframes", "producer");
      const corePackageDir = join(root, "node_modules", "@hyperframes", "core");
      const sharpPackageDir = join(root, "node_modules", "sharp");
      const compositionDir = join(root, "composition");
      mkdirSync(packageDir, { recursive: true });
      mkdirSync(corePackageDir, { recursive: true });
      mkdirSync(sharpPackageDir, { recursive: true });
      mkdirSync(compositionDir, { recursive: true });
      writeFileSync(
        join(packageDir, "package.json"),
        JSON.stringify({ name: "@hyperframes/producer", type: "module", exports: "./index.mjs" }),
      );
      writeFileSync(
        join(packageDir, "index.mjs"),
        [
          'import { readFileSync } from "node:fs";',
          'import { join } from "node:path";',
          "export async function createFileServer(options) {",
          '  const bundled = readFileSync(join(options.compiledDir, "index.html"), "utf8");',
          '  if (bundled !== "<!doctype html><main>bundled modular composition</main>") {',
          "    throw new Error(`UNEXPECTED_BUNDLE=${bundled}`);",
          "  }",
          '  return { url: "http://test", close() {} };',
          "}",
          "export async function createCaptureSession(_url, _out, options) {",
          "  throw new Error(`CAPTURE_OPTIONS=${JSON.stringify(options)}`);",
          "}",
          "export async function initializeSession() {}",
          "export async function closeCaptureSession() {}",
          "export async function getCompositionDuration() { return 0; }",
        ].join("\n"),
      );
      writeFileSync(
        join(corePackageDir, "package.json"),
        JSON.stringify({
          name: "@hyperframes/core",
          type: "module",
          exports: { ".": "./index.mjs", "./compiler": "./compiler.mjs" },
        }),
      );
      writeFileSync(
        join(corePackageDir, "index.mjs"),
        [
          "export function parseFps(input) {",
          "  if (input === '30000/1001') return { ok: true, value: { num: 30000, den: 1001 } };",
          "  if (input === '29.97') return { ok: false, reason: 'ambiguous-decimal' };",
          "  return { ok: true, value: { num: Number(input), den: 1 } };",
          "}",
        ].join("\n"),
      );
      writeFileSync(
        join(corePackageDir, "compiler.mjs"),
        [
          "export async function bundleToSingleHtml() {",
          '  return "<!doctype html><main>bundled modular composition</main>";',
          "}",
        ].join("\n"),
      );
      writeFileSync(
        join(sharpPackageDir, "package.json"),
        JSON.stringify({ name: "sharp", type: "module", exports: "./index.mjs" }),
      );
      writeFileSync(join(sharpPackageDir, "index.mjs"), "export default function sharp() {}\n");

      try {
        const result = spawnSync(
          process.execPath,
          [helper, compositionDir, "--fps", "30000/1001", "--out", join(root, "output")],
          {
            encoding: "utf8",
            env: {
              ...process.env,
              HYPERFRAMES_SKILL_NODE_MODULES: join(root, "node_modules"),
            },
          },
        );
        const output = `${result.stdout}\n${result.stderr}`;
        assert.notEqual(result.status, 0);
        assert.match(output, /CAPTURE_OPTIONS=.*"fps":\{"num":30000,"den":1001\}/);

        const invalid = spawnSync(
          process.execPath,
          [helper, compositionDir, "--fps", "29.97", "--out", join(root, "invalid-output")],
          {
            encoding: "utf8",
            env: {
              ...process.env,
              HYPERFRAMES_SKILL_NODE_MODULES: join(root, "node_modules"),
            },
          },
        );
        const invalidOutput = `${invalid.stdout}\n${invalid.stderr}`;
        assert.notEqual(invalid.status, 0);
        assert.match(invalidOutput, /Invalid --fps "29\.97": ambiguous-decimal/);
        assert.doesNotMatch(invalidOutput, /CAPTURE_OPTIONS=/);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
});

// The two package-loader.mjs copies are intentionally byte-identical (each
// skill ships standalone, so neither can import the other's) and now carry
// shared logic (initializeSessionWithRetry + FALLBACK_TRANSIENT_PATTERNS)
// that a future fix could land in one copy and silently miss in the other —
// the exact drift class the audio.mjs identity pin was born to catch.
describe("package-loader parity", () => {
  it("package-loader.mjs is byte-identical to hyperframes-creative's copy (the stated contract)", () => {
    const here = readFileSync(
      join(REPO_ROOT, "skills", "hyperframes-animation", "scripts", "package-loader.mjs"),
      "utf8",
    );
    const sibling = readFileSync(
      join(REPO_ROOT, "skills", "hyperframes-creative", "scripts", "package-loader.mjs"),
      "utf8",
    );
    assert.equal(here, sibling);
  });
});

// ── Transient-init retry (the zero-duration false-fail fix) ─────────────────
// A valid modular project's sub-composition timelines register asynchronously;
// the first initializeSession can time out with the transient "zero duration /
// Runtime ready: false" diagnostic. The render pipeline closes the crashed
// session and retries once with a fresh browser (probeStage) — the standalone
// helpers must do the same instead of reporting the project as zero-duration.

/** Write a fake node_modules with the given producer index.mjs source. */
function writeFakeEnv(root, producerIndexSource) {
  const packageDir = join(root, "node_modules", "@hyperframes", "producer");
  const corePackageDir = join(root, "node_modules", "@hyperframes", "core");
  const sharpPackageDir = join(root, "node_modules", "sharp");
  const compositionDir = join(root, "composition");
  mkdirSync(packageDir, { recursive: true });
  mkdirSync(corePackageDir, { recursive: true });
  mkdirSync(sharpPackageDir, { recursive: true });
  mkdirSync(compositionDir, { recursive: true });
  writeFileSync(
    join(packageDir, "package.json"),
    JSON.stringify({ name: "@hyperframes/producer", type: "module", exports: "./index.mjs" }),
  );
  writeFileSync(join(packageDir, "index.mjs"), producerIndexSource);
  writeFileSync(
    join(corePackageDir, "package.json"),
    JSON.stringify({
      name: "@hyperframes/core",
      type: "module",
      exports: { ".": "./index.mjs", "./compiler": "./compiler.mjs" },
    }),
  );
  writeFileSync(
    join(corePackageDir, "index.mjs"),
    "export function parseFps(input) { return { ok: true, value: { num: Number(input), den: 1 } }; }",
  );
  writeFileSync(
    join(corePackageDir, "compiler.mjs"),
    'export async function bundleToSingleHtml() { return "<!doctype html><main>x</main>"; }',
  );
  writeFileSync(
    join(sharpPackageDir, "package.json"),
    JSON.stringify({ name: "sharp", type: "module", exports: "./index.mjs" }),
  );
  writeFileSync(join(sharpPackageDir, "index.mjs"), "export default function sharp() {}\n");
  return compositionDir;
}

function runHelper(helper, root, compositionDir) {
  const result = spawnSync(process.execPath, [helper, compositionDir, "--out", join(root, "out")], {
    encoding: "utf8",
    env: { ...process.env, HYPERFRAMES_SKILL_NODE_MODULES: join(root, "node_modules") },
  });
  return `${result.stdout}\n${result.stderr}`;
}

const FAKE_PRODUCER_COMMON = [
  'export async function createFileServer() { return { url: "http://test", close() {} }; }',
  'export async function createCaptureSession() { console.error("SESSION_CREATED"); return {}; }',
  'export async function closeCaptureSession() { console.error("SESSION_CLOSED"); }',
  "export async function getCompositionDuration() { return 0; }",
].join("\n");

describe("transient-init retry", () => {
  for (const helper of HELPERS) {
    it(`${helper.split("/").at(-1)} retries a transient zero-duration init once with a fresh session`, () => {
      const root = mkdtempSync(join(tmpdir(), "hyperframes-skill-retry-test-"));
      try {
        const compositionDir = writeFakeEnv(
          root,
          [
            FAKE_PRODUCER_COMMON,
            "let initCalls = 0;",
            "export async function initializeSession() {",
            "  initCalls++;",
            "  if (initCalls === 1) {",
            // The transient shape: readiness deadline hit before async
            // sub-composition timelines landed (Runtime ready: false).
            '    throw new Error("Composition has zero duration after initialization.\\nRuntime ready: false");',
            "  }",
            '  throw new Error("INIT_ATTEMPT_2_REACHED");',
            "}",
          ].join("\n"),
        );

        const output = runHelper(helper, root, compositionDir);

        // Retried: fresh session created for attempt 2, crashed one closed.
        assert.match(output, /retrying with a fresh browser session/);
        assert.equal((output.match(/SESSION_CREATED/g) ?? []).length, 2);
        assert.equal((output.match(/SESSION_CLOSED/g) ?? []).length, 2);
        // ...and the retry genuinely re-ran init (bounded: no third attempt).
        assert.match(output, /INIT_ATTEMPT_2_REACHED/);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it(`${helper.split("/").at(-1)} does NOT retry a genuine authoring failure (Runtime ready: true)`, () => {
      const root = mkdtempSync(join(tmpdir(), "hyperframes-skill-retry-test-"));
      try {
        const compositionDir = writeFakeEnv(
          root,
          [
            FAKE_PRODUCER_COMMON,
            "export async function initializeSession() {",
            // The fast-fail shape: runtime IS ready, there is genuinely no
            // timeline/duration — an authoring bug retries can't fix.
            '  throw new Error("Composition has zero duration after initialization.\\nRuntime ready: true");',
            "}",
          ].join("\n"),
        );

        const output = runHelper(helper, root, compositionDir);

        assert.doesNotMatch(output, /retrying with a fresh browser session/);
        assert.equal((output.match(/SESSION_CREATED/g) ?? []).length, 1);
        assert.match(output, /Composition has zero duration/);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }

  it("prefers the producer's own isTransientBrowserError classifier when exported", () => {
    const root = mkdtempSync(join(tmpdir(), "hyperframes-skill-retry-test-"));
    try {
      const compositionDir = writeFakeEnv(
        root,
        [
          FAKE_PRODUCER_COMMON,
          // A message the frozen fallback patterns would NOT match — only the
          // producer-provided classifier can mark it transient.
          "export function isTransientBrowserError(err) { return String(err && err.message).includes('CUSTOM_TRANSIENT'); }",
          "let initCalls = 0;",
          "export async function initializeSession() {",
          "  initCalls++;",
          '  if (initCalls === 1) throw new Error("CUSTOM_TRANSIENT flake");',
          '  throw new Error("INIT_ATTEMPT_2_REACHED");',
          "}",
        ].join("\n"),
      );

      const output = runHelper(HELPERS[0], root, compositionDir);

      assert.match(output, /retrying with a fresh browser session/);
      assert.match(output, /INIT_ATTEMPT_2_REACHED/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
