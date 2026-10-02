import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { generate } from "./generate-media-use-svg-sanitize.mjs";

// The single source of truth for SVG sanitization is packages/core/src/figma/sanitizeSvg.ts;
// media-use's copy is a generated bundle (its test lane runs bare `node --test`, no install, so
// it can't import linkedom directly). This is the trip wire against hand-editing the bundle or
// forgetting to regenerate it after touching the source.
describe("media-use svg-sanitize.mjs matches a fresh regeneration", () => {
  it("is byte-identical to `node scripts/generate-media-use-svg-sanitize.mjs`", async () => {
    const committed = readFileSync(
      resolve(import.meta.dirname, "../packages/cli/src/media-use/lib/svg-sanitize.mjs"),
      "utf8",
    );
    const fresh = await generate();
    assert.equal(
      committed,
      fresh,
      "packages/cli/src/media-use/lib/svg-sanitize.mjs is stale — run: node scripts/generate-media-use-svg-sanitize.mjs",
    );
  });
});
