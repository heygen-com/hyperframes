import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkPublishedSkillLinks, existsWithExactCase } from "./check-skill-links.mjs";

function withFixture(run) {
  const root = mkdtempSync(join(tmpdir(), "hf-skill-links-"));
  try {
    const entry = join(root, "hyperframes");
    const refs = join(entry, "references");
    const other = join(root, "figma");
    mkdirSync(refs, { recursive: true });
    mkdirSync(other, { recursive: true });
    writeFileSync(join(refs, "guide.md"), "# Guide\n");
    writeFileSync(join(refs, "guide with space.md"), "# Guide\n");
    writeFileSync(join(other, "SKILL.md"), "# Figma\n");
    run({ root, entry });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("repository-local Markdown links in published skills resolve", () => {
  assert.deepEqual(checkPublishedSkillLinks(), []);
});

test("resolves valid local and cross-skill links, ignoring URLs, site paths, and code fences", () => {
  withFixture(({ root, entry }) => {
    writeFileSync(
      join(entry, "SKILL.md"),
      [
        "[guide](references/guide.md)",
        "[guide anchor](references/guide.md#overview)",
        '[title](references/guide.md "Guide")',
        "[percent encoded](references/guide%20with%20space.md)",
        "[angle target](<references/guide with space.md>)",
        "[cross-skill](../figma/SKILL.md)",
        "[external](https://example.com/guide.md)",
        "[site](/docs/guide.md)",
        "[outside](../../CONTRIBUTING.md)",
        "```md",
        "[code example](references/nonexistent.md)",
        "```",
        "~~~md",
        "[other example](references/nonexistent.md)",
        "~~~",
      ].join("\n"),
    );
    assert.deepEqual(checkPublishedSkillLinks(root), []);
  });
});

test("catches missing and wrong-case paths regardless of host filesystem", () => {
  withFixture(({ root, entry }) => {
    writeFileSync(
      join(entry, "SKILL.md"),
      [
        "# Links",
        "[missing](references/not-here.md)",
        "[wrong case](references/Guide.md)",
        "[not a directory](references/guide.md/nested.md)",
      ].join("\n"),
    );
    assert.equal(existsWithExactCase(root, join(entry, "references", "guide.md")), true);
    assert.equal(existsWithExactCase(root, join(entry, "references", "Guide.md")), false);
    assert.deepEqual(checkPublishedSkillLinks(root), [
      "hyperframes/SKILL.md:2: missing or mis-cased local link references/not-here.md",
      "hyperframes/SKILL.md:3: missing or mis-cased local link references/Guide.md",
      "hyperframes/SKILL.md:4: missing or mis-cased local link references/guide.md/nested.md",
    ]);
  });
});
