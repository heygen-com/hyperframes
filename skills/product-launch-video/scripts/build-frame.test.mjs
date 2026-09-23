import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const buildFrameScript = new URL("./build-frame.mjs", import.meta.url).pathname;

// Regression: build-frame.mjs derived a preset's ground/text roles from key-name heuristics
// ("ink" = dark text, "cream/paper/bg" = light ground). broadside's declared register is the
// opposite — its ground key is literally named "ink-black" and its text key "cream" — so the
// heuristic read it as light-ground and inverted every dark-mode brand onto a white frame.

function runBuildFrame(preset, tokens) {
  const dir = mkdtempSync(join(tmpdir(), "build-frame-test-"));
  mkdirSync(join(dir, "capture", "extracted"), { recursive: true });
  writeFileSync(join(dir, "capture", "extracted", "tokens.json"), JSON.stringify(tokens));
  const r = spawnSync(
    process.execPath,
    [buildFrameScript, "--preset", preset, "--hyperframes", dir],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, `build-frame ${preset} failed:\n${r.stdout}\n${r.stderr}`);
  return { stdout: r.stdout, frameMd: readFileSync(join(dir, "frame.md"), "utf8") };
}

const DARK_BRAND_TOKENS = {
  colors: ["#FFFFFF", "#08090B", "#1A5FDF", "#FFB800"],
  colorStats: [
    { hex: "#08090B", areaBg: 900000, maxArea: 900000, bgCount: 40, textCount: 0, interactiveBg: 0 },
    { hex: "#FFFFFF", areaBg: 0, maxArea: 0, bgCount: 2, textCount: 120, interactiveBg: 0 },
    { hex: "#1A5FDF", areaBg: 0, maxArea: 0, bgCount: 0, textCount: 4, interactiveBg: 30 },
    { hex: "#FFB800", areaBg: 0, maxArea: 0, bgCount: 0, textCount: 1, interactiveBg: 2 },
  ],
  fonts: [
    { family: "Inter", weights: [400, 500, 600, 700] },
    { family: "Sora", weights: [400, 600, 700] },
  ],
};

const LIGHT_BRAND_TOKENS = {
  colors: ["#111111", "#FAFAF7", "#2563EB", "#F59E0B"],
  colorStats: [
    { hex: "#FAFAF7", areaBg: 900000, maxArea: 900000, bgCount: 40, textCount: 0, interactiveBg: 0 },
    { hex: "#111111", areaBg: 0, maxArea: 0, bgCount: 2, textCount: 120, interactiveBg: 0 },
    { hex: "#2563EB", areaBg: 0, maxArea: 0, bgCount: 0, textCount: 4, interactiveBg: 30 },
    { hex: "#F59E0B", areaBg: 0, maxArea: 0, bgCount: 0, textCount: 1, interactiveBg: 2 },
  ],
  fonts: [{ family: "Inter", weights: [400, 500, 600, 700] }],
};

test("broadside + a dark-mode brand keeps the dark ground (no inversion)", () => {
  const { stdout, frameMd } = runBuildFrame("broadside", DARK_BRAND_TOKENS);
  assert.doesNotMatch(stdout, /INVERTED/);
  const m = /ink-black:\s*"(#[0-9A-Fa-f]{6})"/.exec(frameMd);
  assert.ok(m, "ink-black key missing from frame.md");
  // ink-black is broadside's declared ground key — it must map to the brand's dark color
  // (#08090B, the largest-area background), not the brand's light color (#FFFFFF).
  assert.equal(m[1].toUpperCase(), "#08090B");
});

test("a light-ground preset (capsule) still inverts onto a dark-mode brand", () => {
  const { stdout, frameMd } = runBuildFrame("capsule", DARK_BRAND_TOKENS);
  assert.match(stdout, /INVERTED/);
  const m = /\bink:\s*"(#[0-9A-Fa-f]{6})"/.exec(frameMd);
  assert.ok(m, "ink key missing from frame.md");
  // capsule's "ink" key is its dark text color; on a dark brand the whole palette flips so
  // "ink" (dark in the preset) takes the brand's light value.
  assert.equal(m[1].toUpperCase(), "#FFFFFF");
});

test("a light-ground preset (capsule) onto a light-mode brand is not inverted", () => {
  const { stdout } = runBuildFrame("capsule", LIGHT_BRAND_TOKENS);
  assert.doesNotMatch(stdout, /INVERTED/);
});

test("broadside's cream-muted stays a neutral grey, not the brand's saturated accent", () => {
  const { frameMd } = runBuildFrame("broadside", DARK_BRAND_TOKENS);
  const m = /cream-muted:\s*"(#[0-9A-Fa-f]{6})"/.exec(frameMd);
  assert.ok(m, "cream-muted key missing from frame.md");
  // #FFB800 is the brand's literal accent2 — forced in before the fix.
  assert.notEqual(m[1].toUpperCase(), "#FFB800");
});
