import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
