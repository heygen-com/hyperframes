import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { carriedSectionsFrom } from "../../../../scripts/generate-catalog-pages.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");
const generatorSource = readFileSync(join(repoRoot, "scripts/generate-catalog-pages.ts"), "utf-8");

describe("catalog generator texture instructions", () => {
  it("pins the unambiguous texture style-block copy instruction", () => {
    expect(generatorSource).toContain("paste the real <style> block");
    expect(generatorSource).toContain("near the bottom into the composition once");
    expect(generatorSource).toContain("real \\`<style>\\` element near the bottom");
  });
});

// docs/AGENTS.md requires every Catalog page to end with `## Related topics`.
// The generator emits it (see RELATED_TOPICS); this asserts the committed output
// still honours the rule, so a regeneration that drops it fails CI here.
describe("catalog pages keep the required reader continuation", () => {
  const catalogDir = join(repoRoot, "docs/catalog");
  const pages = (["blocks", "components"] as const).flatMap((sub) =>
    readdirSync(join(catalogDir, sub))
      .filter((f) => f.endsWith(".mdx"))
      .map((f) => ({ sub, file: f, path: join(catalogDir, sub, f) })),
  );

  it("generates at least one page in each catalog subdirectory", () => {
    expect(pages.length).toBeGreaterThan(0);
  });

  it.each(pages)("$sub/$file ends with a Related topics section", ({ path }) => {
    const body = readFileSync(path, "utf-8").trimEnd();
    const lastHeading = body
      .split("\n")
      .filter((l) => l.startsWith("## "))
      .at(-1);
    expect(lastHeading).toBe("## Related topics");
  });
});

// The carry-forward path is the subtler half: a regeneration must preserve every
// hand-written section, including one whose heading (## Usage) the generator once
// emitted and whose first line looks like generated prose, and one appended below
// the generated footer marker.
describe("carriedSectionsFrom preserves hand-written sections", () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-catalog-carry-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const write = (name: string, body: string) => {
    const p = join(dir, name);
    writeFileSync(p, body, "utf-8");
    return p;
  };

  it("keeps a custom Usage section that opens like generated prose", () => {
    const page = write(
      "usage.mdx",
      [
        "## Install",
        "",
        "```bash Terminal",
        "npx hyperframes add sample",
        "```",
        "",
        "## Usage",
        "",
        // deliberately opens with a phrase an old generated Usage used
        "After installing, add the block — but here is our own hand-written guidance the author cares about.",
        "",
        "{/* hf:generated-footer */}",
        "",
        "Tagged `sample`.",
        "",
      ].join("\n"),
    );
    const carried = carriedSectionsFrom(page);
    const joined = carried.sections.join("\n");
    expect(joined).toContain("## Usage");
    expect(joined).toContain("hand-written guidance the author cares about");
    expect(carried.hasCustomUsage).toBe(true);
    // The generated Install section is owned by the template and not carried.
    expect(joined).not.toContain("## Install");
  });

  it("keeps a hand-written section appended below the generated footer", () => {
    const page = write(
      "below-footer.mdx",
      [
        "## Install",
        "",
        "text",
        "",
        "{/* hf:generated-footer */}",
        "",
        "Tagged `sample`.",
        "",
        "## Related topics",
        "",
        "- [Browse the complete Catalog](/catalog)",
        "",
        "## Field notes",
        "",
        "A section a human added after the generated tail.",
        "",
      ].join("\n"),
    );
    const joined = carriedSectionsFrom(page).sections.join("\n");
    expect(joined).toContain("## Field notes");
    expect(joined).toContain("A section a human added after the generated tail.");
    // The generator's own Related topics is not carried (it re-emits it).
    expect(joined).not.toContain("## Related topics");
  });
});
