import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

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
const SEARCH_ROOTS = ["docs", "scripts", "packages", "registry"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".next", "coverage", "images"]);
const PLAYER_CDN = /cdn\.jsdelivr\.net\/npm\/@hyperframes\/player@([^/"'`\s]+)/g;

// The generator interpolates the range, so its source reads as a template
// rather than a literal version. Its value is asserted separately below.
const TEMPLATE_REFERENCE = "${playerVersionRange}";

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(full);
      continue;
    }
    if (statSync(full).size > 5_000_000) continue;
    yield full;
  }
}

function pinnedReferences(): { file: string; version: string }[] {
  const found: { file: string; version: string }[] = [];
  for (const root of SEARCH_ROOTS) {
    for (const file of walk(join(ROOT, root))) {
      let text: string;
      try {
        text = readFileSync(file, "utf-8");
      } catch {
        continue;
      }
      for (const match of text.matchAll(PLAYER_CDN)) {
        found.push({ file: relative(ROOT, file), version: match[1] as string });
      }
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

test("the generated pages are regenerated from the current generator", () => {
  const generator = readFileSync(join(ROOT, "scripts/generate-catalog-pages.ts"), "utf-8");
  const range = generator.match(/const playerVersionRange = "([^"]+)"/)?.[1];
  assert.equal(
    range,
    "latest",
    "generate-catalog-pages.ts must emit @latest, or every page it writes reintroduces a pin",
  );
});
