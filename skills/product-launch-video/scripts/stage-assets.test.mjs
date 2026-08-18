import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { stageAssets } from "./lib/assets.mjs";

// ── captured SVGs are stageable ──────────────────────────────────────────────
// Regression: `hyperframes capture` extracts inline SVGs into capture/assets/svgs/
// (assetDownloader.ts), and the capture manifest advertises them to the agent as
// `assets/svgs/<name>.svg`, so a frame names one in `asset_candidates` exactly as
// it names a screenshot. stageAssets only searched capture/{assets,assets/videos,
// screenshots}, so every captured SVG resolved to nothing — reported as a
// non-fatal anomaly, and the frame 404'd the logo it had been told to use.

function projectWithCapturedSvg() {
  const dir = mkdtempSync(join(tmpdir(), "product-launch-stage-assets-"));
  mkdirSync(join(dir, "capture/assets/svgs"), { recursive: true });
  mkdirSync(join(dir, "capture/screenshots"), { recursive: true });
  writeFileSync(join(dir, "capture/assets/svgs/brand-mark.svg"), "<svg/>");
  writeFileSync(join(dir, "capture/screenshots/hero.png"), "png");
  return dir;
}

const frames = [
  { extra: { asset_candidates: "assets/svgs/brand-mark.svg — the mark; assets/hero.png — hero" } },
];

test("stages an SVG that capture wrote into capture/assets/svgs/", () => {
  const dir = projectWithCapturedSvg();

  const { staged, wanted, anomalies } = stageAssets({ hyperframesDir: dir, frames });

  assert.equal(wanted.size, 2);
  assert.equal(staged, 2, `expected both assets staged, got anomalies: ${anomalies.join("; ")}`);
  assert.deepEqual(anomalies, []);
  assert.ok(existsSync(join(dir, "assets/brand-mark.svg")));
  assert.ok(existsSync(join(dir, "assets/hero.png")));
});

test("still reports an asset that exists nowhere under capture/", () => {
  const dir = projectWithCapturedSvg();

  const { staged, anomalies } = stageAssets({
    hyperframesDir: dir,
    frames: [{ extra: { asset_candidates: "assets/svgs/absent.svg — never captured" } }],
  });

  assert.equal(staged, 0);
  assert.equal(anomalies.length, 1);
  assert.match(anomalies[0], /absent\.svg/);
});
