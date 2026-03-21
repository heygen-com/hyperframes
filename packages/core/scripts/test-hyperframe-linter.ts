import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { lintHyperframeHtml } from "../src/lint/hyperframeLinter";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function testCleanFixturePasses() {
  const fixturePath = path.join(ROOT, "src/tests/chat-project-9/index.html");
  const html = fs.readFileSync(fixturePath, "utf8");
  const result = lintHyperframeHtml(html, { filePath: fixturePath });

  assert.equal(result.ok, true, "chat-project-9 should pass without lint errors");
  assert.equal(result.errorCount, 0, "chat-project-9 should have zero lint errors");
}

function testDetectsMissingCompositionHostId() {
  const html = `
    <html>
      <body>
        <div id="root" data-width="1080" data-height="1920">
          <div data-composition-src="compositions/overlays.html"></div>
        </div>
        <script>
          window.__timelines = {};
          const tl = gsap.timeline({ paused: true });
          window.__timelines["root"] = tl;
        </script>
      </body>
    </html>
  `;

  const result = lintHyperframeHtml(html);
  const codes = result.findings.map((finding) => finding.code);

  assert.equal(result.ok, false, "missing composition ids should fail lint");
  assert.ok(codes.includes("root_missing_composition_id"));
  assert.ok(codes.includes("host_missing_composition_id"));
}

function testDetectsOverlappingGsapTweens() {
  const html = `
    <html>
      <body>
        <div id="main" data-composition-id="main" data-width="1080" data-height="1920">
          <div id="frame"></div>
        </div>
        <script>
          window.__timelines = {};
          const tl = gsap.timeline({ paused: true });
          tl.to("#frame", { y: 15, duration: 2.5, repeat: 1, yoyo: true }, 1.5);
          tl.to("#frame", { y: 400, duration: 1.2 }, 4.5);
          window.__timelines["main"] = tl;
        </script>
      </body>
    </html>
  `;

  const result = lintHyperframeHtml(html);
  const overlapFinding = result.findings.find((finding) => finding.code === "overlapping_gsap_tweens");

  assert.ok(overlapFinding, "expected an overlapping GSAP tween warning");
  assert.equal(overlapFinding?.severity, "warning");
}

function testCliJsonOutput() {
  const fixturePath = path.join(ROOT, "src/tests/chat-project-9/index.html");
  const tsxBin = path.join(ROOT, "node_modules/.bin/tsx");
  const stdout = execFileSync(tsxBin, ["scripts/check-hyperframe-static.ts", "--json", fixturePath], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const payload = JSON.parse(stdout);

  assert.equal(payload.ok, true);
  assert.equal(typeof payload.errorCount, "number");
  assert.ok(Array.isArray(payload.findings));
}

function main() {
  testCleanFixturePasses();
  testDetectsMissingCompositionHostId();
  testDetectsOverlappingGsapTweens();
  testCliJsonOutput();
  console.log("hyperframe linter tests passed");
}

main();
