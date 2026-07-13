import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("examples documentation", () => {
  it("only advertises bundled examples as always available to init", () => {
    const markdown = readFileSync(fileURLToPath(new URL("./examples.md", import.meta.url)), "utf8");
    const alwaysAvailableSection = markdown.split("## Registry examples")[0];
    const documented = [...alwaysAvailableSection.matchAll(/^## ([\w-]+)$/gm)].map(
      ([, name]) => name,
    );
    const generators = readFileSync(
      fileURLToPath(new URL("../templates/generators.ts", import.meta.url)),
      "utf8",
    );
    const bundledSection = generators.match(
      /export const BUNDLED_TEMPLATES:[\s\S]*?= \[([\s\S]*?)\n\];/,
    )?.[1];
    const bundled = [...(bundledSection ?? "").matchAll(/\bid: "([\w-]+)"/g)].map(
      ([, name]) => name,
    );

    expect(documented).toEqual(bundled);
  });
});
