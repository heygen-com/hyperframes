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
 * The reference lives in the two catalog snippets that build a preview
 * `srcDoc`; this asserts on the whole tree rather than on the sources a reader
 * would think to check.
 */
const ROOT = resolve(import.meta.dirname, "..");
const PLAYER_CDN = /cdn\.jsdelivr\.net\/npm\/@hyperframes\/player@([^/"'`\s]+)/g;
const TEXT_FILE = /\.(mdx?|[jt]sx?|html|json)$/;

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
    references.length >= 2,
    `expected the catalog snippets to reference the player CDN, found ${references.length}`,
  );

  const pinned = references.filter((r) => r.version !== "latest");
  assert.deepEqual(
    pinned,
    [],
    `pinned player versions found. Use @latest instead:\n${pinned
      .map((r) => `  ${r.file}: @${r.version}`)
      .join("\n")}`,
  );
});
