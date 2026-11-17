import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { generate } from "./generate-media-use-terminal-text.mjs";

// packages/core/src/terminalText.ts is the one escaper; media-use's copy is a generated bundle because
// the engine runs unbundled and cannot import core. This trips on a hand edit or a missed regeneration.
describe("media-use terminal-text.mjs matches a fresh regeneration", () => {
  it("is byte-identical to `node scripts/generate-media-use-terminal-text.mjs`", async () => {
    const committed = readFileSync(
      resolve(import.meta.dirname, "../packages/cli/src/media-use/lib/terminal-text.mjs"),
      "utf8",
    );
    assert.equal(
      committed,
      await generate(),
      "packages/cli/src/media-use/lib/terminal-text.mjs is stale — run: node scripts/generate-media-use-terminal-text.mjs",
    );
  });
});
