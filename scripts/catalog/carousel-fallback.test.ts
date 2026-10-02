import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const blocksDir = join(import.meta.dirname, "..", "..", "registry", "blocks");

// The carousels draw each card from its image variable, or from the block's own
// sample image when the variable resolves to nothing.
const FALLBACK = /varUrl\(V\[id\]\)\s*\|\|\s*([^\n]*)DATA\.cards\[i % DATA\.cards\.length\]\.file/g;

function carousels(): Array<{ block: string; prefixes: string[] }> {
  return readdirSync(blocksDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => ({
      block: name,
      html: readFileSync(join(blocksDir, name, `${name}.html`), "utf8"),
    }))
    .filter(({ html }) => html.includes("varUrl(V[id])"))
    .map(({ block, html }) => ({
      block,
      prefixes: [...html.matchAll(FALLBACK)].map((match) => match[1] ?? ""),
    }));
}

describe("carousel image fallback", () => {
  it("loads the sample image from the block's assets folder, not a bare file name", () => {
    const found = carousels();
    expect(found.length).toBeGreaterThan(0);
    for (const { block, prefixes } of found) {
      expect(prefixes.length, block).toBeGreaterThan(0);
      for (const prefix of prefixes) expect(prefix, block).toContain('"assets/carousel-images/" +');
    }
  });
});
