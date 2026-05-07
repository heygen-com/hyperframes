import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const generatorSource = readFileSync(
  resolve(here, "../../../../scripts/generate-catalog-pages.ts"),
  "utf-8",
);

describe("catalog generator texture instructions", () => {
  it("pins the unambiguous texture style-block copy instruction", () => {
    expect(generatorSource).toContain("paste the real <style> block");
    expect(generatorSource).toContain("near the bottom into the composition once");
    expect(generatorSource).toContain("real \\`<style>\\` element near the bottom");
  });
});
