import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseColors } from "./lib/tokens.mjs";

const workflows = ["product-launch-video", "faceless-explainer", "pr-to-video"];
const presets = [
  { name: "bold-poster", ink: "dark", canvas: "bg" },
  { name: "cartesian", ink: "text-primary", canvas: "bg-primary" },
  { name: "blue-professional", ink: "text", canvas: "bg" },
];

function brandTokens(ink, canvas) {
  return {
    colors: [canvas, ink, "#ff6b35"],
    colorStats: [
      { hex: canvas, count: 10, bgCount: 5, areaBg: 900000, maxArea: 900000 },
      { hex: ink, count: 20, textCount: 20 },
      { hex: "#ff6b35", count: 5, bgCount: 2, maxArea: 4000, textCount: 1, interactiveBg: 2 },
    ],
  };
}

function buildFrame(t, workflow, preset, tokens) {
  const project = mkdtempSync(join(tmpdir(), "frame-colors-"));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  if (tokens) {
    mkdirSync(join(project, "capture/extracted"), { recursive: true });
    writeFileSync(join(project, "capture/extracted/tokens.json"), JSON.stringify(tokens));
  }
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL(`../../${workflow}/scripts/build-frame.mjs`, import.meta.url)),
      "--preset",
      preset,
      "--hyperframes",
      project,
    ],
    { encoding: "utf8", timeout: 10000 },
  );
  assert.ifError(result.error);
  return { ...result, project };
}

for (const workflow of workflows) {
  for (const preset of presets) {
    for (const [polarity, ink, canvas] of [
      ["dark", "#ffffff", "#0a1628"],
      ["light", "#0a1628", "#ffffff"],
    ]) {
      test(`${workflow} validates ${preset.name} with a ${polarity} brand`, (t) => {
        const result = buildFrame(t, workflow, preset.name, brandTokens(ink, canvas));
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /self-check: keys preserved, ink\/canvas contrast ok/);
        const colors = new Map(parseColors(readFileSync(join(result.project, "frame.md"), "utf8")));
        assert.equal(colors.get(preset.ink), ink);
        assert.equal(colors.get(preset.canvas), canvas);
      });
    }

    test(`${workflow} keeps ${preset.name}'s palette without brand tokens`, (t) => {
      const result = buildFrame(t, workflow, preset.name);
      assert.equal(result.status, 0, result.stderr);
      const original = readFileSync(
        new URL(
          `../../hyperframes-creative/frame-presets/${preset.name}/FRAME.md`,
          import.meta.url,
        ),
        "utf8",
      );
      const output = readFileSync(join(result.project, "frame.md"), "utf8");
      assert.deepEqual(parseColors(output), parseColors(original));
    });
  }

  test(`${workflow} still rejects a brand with insufficient ink/canvas contrast`, (t) => {
    const result = buildFrame(t, workflow, "bold-poster", {
      colors: ["#101010", "#202020", "#301020"],
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ink .* and canvas .* lack contrast/);
  });
}
