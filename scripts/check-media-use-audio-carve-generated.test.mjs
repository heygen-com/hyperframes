import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { generate } from "./generate-media-use-audio-carve.mjs";

// The carve analysis lives in packages/core/src/audioCarve.ts and audioFx.ts; the skill's copy is a generated
// bundle. This trips on a hand edit of the bundle or a source change that was not regenerated.
describe("media-use audio-carve.mjs matches a fresh regeneration", () => {
  it("is byte-identical to `node scripts/generate-media-use-audio-carve.mjs`", async () => {
    const committed = readFileSync(
      resolve(import.meta.dirname, "../skills/media-use/audio/scripts/lib/audio-carve.mjs"),
      "utf8",
    );
    assert.equal(
      committed,
      await generate(),
      "skills/media-use/audio/scripts/lib/audio-carve.mjs is stale. Run: node scripts/generate-media-use-audio-carve.mjs",
    );
  });
});
