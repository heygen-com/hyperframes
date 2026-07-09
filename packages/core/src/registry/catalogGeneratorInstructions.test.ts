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

describe("catalog generator motion primitives group", () => {
  it("groups shadcn-style remocn UI primitives before motion primitives", () => {
    expect(generatorSource).toContain('"UI Primitives"');
    expect(generatorSource).toContain('tags.includes("ui-primitive")');
  });

  it("groups composed remocn UI flows after low-level UI primitives", () => {
    expect(generatorSource).toContain('"UI Flows"');
    expect(generatorSource).toContain('tags.includes("ui-flow")');
  });

  it("groups transitions.dev-style microinteractions before broader motion primitives", () => {
    expect(generatorSource).toContain('"Transition Primitives"');
    expect(generatorSource).toContain('tags.includes("transition-primitive")');
  });

  it("groups web-native motion primitive components before generic effects", () => {
    expect(generatorSource).toContain('"Motion Primitives"');
    expect(generatorSource).toContain('tags.includes("motion-primitive")');
  });

  it("preserves existing code snippet and text effect catalog families", () => {
    expect(generatorSource).toContain('"Text Effects"');
    expect(generatorSource).toContain('"Code Snippets"');
    expect(generatorSource).toContain('tags.includes("text-effect")');
    expect(generatorSource).toContain('entry.name.startsWith("code-snippet-")');
  });

  it("keeps the public catalog index on its existing four-space JSON style", () => {
    expect(generatorSource).toContain("JSON.stringify(catalogIndex, null, 4)");
  });
});
