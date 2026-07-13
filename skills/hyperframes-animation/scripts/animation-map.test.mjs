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
    it(`${helper.split("/").at(-1)} passes a rational frame rate`, () => {
      const root = mkdtempSync(join(tmpdir(), "hyperframes-skill-helper-test-"));
      const packageDir = join(root, "node_modules", "@hyperframes", "producer");
      const sharpPackageDir = join(root, "node_modules", "sharp");
      const compositionDir = join(root, "composition");
      mkdirSync(packageDir, { recursive: true });
      mkdirSync(sharpPackageDir, { recursive: true });
      mkdirSync(compositionDir, { recursive: true });
      writeFileSync(
        join(packageDir, "package.json"),
        JSON.stringify({ name: "@hyperframes/producer", type: "module", exports: "./index.mjs" }),
      );
      writeFileSync(
        join(packageDir, "index.mjs"),
        [
          'export async function createFileServer() { return { url: "http://test", close() {} }; }',
          "export async function createCaptureSession(_url, _out, options) {",
          "  throw new Error(`CAPTURE_OPTIONS=${JSON.stringify(options)}`);",
          "}",
          "export async function initializeSession() {}",
          "export async function closeCaptureSession() {}",
          "export async function getCompositionDuration() { return 0; }",
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
          [helper, compositionDir, "--fps", "24", "--out", join(root, "output")],
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
        assert.match(output, /CAPTURE_OPTIONS=.*"fps":\{"num":24,"den":1\}/);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
});
