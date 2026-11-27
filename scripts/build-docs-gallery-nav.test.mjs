import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";

const ROOT = join(import.meta.dirname, "..");

it("builds the nav when invoked through a path containing spaces", () => {
  const dir = mkdtempSync(join(tmpdir(), "docs gallery nav "));
  try {
    const scripts = join(dir, "scripts");
    const docs = join(dir, "docs");
    mkdirSync(join(docs, "snippets"), { recursive: true });
    cpSync(
      join(ROOT, "scripts/build-docs-gallery-nav.mjs"),
      join(scripts, "build-docs-gallery-nav.mjs"),
    );
    cpSync(join(ROOT, "scripts/docs-catalog-shared.mjs"), join(scripts, "docs-catalog-shared.mjs"));
    writeFileSync(
      join(docs, "snippets/catalog-gallery-data.mdx"),
      'export const catalogGalleryData = { "groups": [], "items": [] };',
    );
    writeFileSync(
      join(docs, "docs.json"),
      JSON.stringify({ navigation: { tabs: [{ tab: "Catalog", groups: [] }] } }),
    );

    const result = spawnSync(
      process.execPath,
      [join(scripts, "build-docs-gallery-nav.mjs"), docs],
      {
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Rebuilt Catalog nav/);
    const config = JSON.parse(readFileSync(join(docs, "docs.json"), "utf8"));
    assert.deepEqual(config.navigation.tabs[0].groups, [
      { group: "Catalog", pages: ["catalog/index"] },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
