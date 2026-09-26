import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const blocksDir = join(import.meta.dirname, "..", "..", "registry", "blocks");

// The carousels draw each card from its image variable, or from the block's own
// sample image when the variable resolves to nothing.
const FALLBACK = /varUrl\(V\[id\]\)\s*\|\|\s*([^\n]*)DATA\.cards\[i % DATA\.cards\.length\]\.file/g;

function fallbacks(): Array<{ block: string; prefix: string }> {
  return readdirSync(blocksDir).flatMap((block) => {
    const html = readFileSync(join(blocksDir, block, `${block}.html`), "utf8");
    return [...html.matchAll(FALLBACK)].map((match) => ({ block, prefix: match[1] ?? "" }));
  });
}

describe("carousel image fallback", () => {
  it("loads the sample image from the block's assets folder, not a bare file name", () => {
    const found = fallbacks();
    expect(found.length).toBeGreaterThan(0);
    for (const { block, prefix } of found) {
      expect(prefix, block).toContain('"assets/carousel-images/" +');
    }
  });
});
