import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Every CDN reference to the player must ask for `latest`.
 *
 * A pinned line here fails silently and indefinitely. The catalog page still
 * renders on the build the pin names, so nothing looks broken: the only symptom
 * is that a fix published to npm never appears on the docs, which surfaces as
 * "that bug is still there" weeks later rather than as a red check. That is
 * exactly how the pin sat one minor line behind after a release, across 175
 * generated pages and three hand-written files nobody thought to grep.
 *
 * The reference lives in 178 places because each generated page carries a
 * self-contained `srcDoc` document, so this asserts on the whole tree rather
 * than on the four sources a reader would think to check.
 */
const ROOT = resolve(import.meta.dirname, "..");
const PLAYER_CDN = /cdn\.jsdelivr\.net\/npm\/@hyperframes\/player@([^/"'`\s]+)/g;
const TEXT_FILE = /\.(mdx?|[jt]sx?|html|json)$/;

// The generator interpolates the range, so its source reads as a template
// rather than a literal version. Its value is asserted separately below.
const TEMPLATE_REFERENCE = "${playerVersionRange}";

/**
 * Tracked files only, via git rather than a directory walk: it is one call, and
 * it skips `node_modules` and build output for free because they are ignored.
 */
function trackedTextFiles(): string[] {
  const listing = execFileSync(
    "git",
    ["ls-files", "-z", "docs", "scripts", "packages", "registry"],
    {
      cwd: ROOT,
      encoding: "utf-8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  return listing.split("\0").filter((file) => TEXT_FILE.test(file));
}

function pinnedReferences(): { file: string; version: string }[] {
  const found: { file: string; version: string }[] = [];
  for (const file of trackedTextFiles()) {
    const text = readFileSync(join(ROOT, file), "utf-8");
    for (const match of text.matchAll(PLAYER_CDN)) {
      found.push({ file, version: match[1] as string });
    }
  }
  return found;
}

test("every player CDN reference asks for latest", () => {
  const references = pinnedReferences();

  // A guard that passes because it matched nothing is worse than no guard.
  assert.ok(
    references.length > 100,
    `expected the catalog pages to reference the player CDN, found ${references.length}`,
  );

  const pinned = references.filter(
    (r) => r.version !== "latest" && r.version !== TEMPLATE_REFERENCE,
  );
  assert.deepEqual(
    pinned,
    [],
    `pinned player versions found. Use @latest instead:\n${pinned
      .map((r) => `  ${r.file}: @${r.version}`)
      .join("\n")}`,
  );
});

test("the generator emits latest, so regenerating cannot reintroduce a pin", () => {
  const generator = readFileSync(join(ROOT, "scripts/generate-catalog-pages.ts"), "utf-8");
  const range = generator.match(/const playerVersionRange = "([^"]+)"/)?.[1];
  assert.equal(range, "latest");
});
