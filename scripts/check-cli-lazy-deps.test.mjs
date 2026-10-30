import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkCliLazyDeps, listStaticLazyImports } from "./check-cli-lazy-deps.mjs";

test("flags static imports and re-exports of a lazy package, across lines", () => {
  const source = [
    'import sharp from "sharp";',
    "import {",
    "  CDPSession",
    '} from "puppeteer-core";',
    'export { transform } from "esbuild";',
    'import "esbuild/lib/main.js";',
  ].join("\n");
  assert.deepEqual(listStaticLazyImports(source, "chunk.js"), [
    "chunk.js:1 imports sharp statically",
    "chunk.js:2 imports puppeteer-core statically",
    "chunk.js:5 imports esbuild statically",
    "chunk.js:6 imports esbuild/lib/main.js statically",
  ]);
});

test("allows dynamic imports, type-only imports, look-alike names and quoted code", () => {
  const source = [
    'const { transform } = await import("esbuild");',
    'import type { Page } from "puppeteer-core";',
    'import sharpish from "sharp-ish";',
    'const doc = `import sharp from "sharp";`;',
  ].join("\n");
  assert.deepEqual(listStaticLazyImports(source), []);
});

test("scans every built file, nested ones too, and refuses a missing build", () => {
  const root = mkdtempSync(join(tmpdir(), "hf-lazy-deps-"));
  try {
    assert.match(checkCliLazyDeps(root)[0], /missing; build the CLI first/);
    mkdirSync(join(root, "packages/cli/dist/commands"), { recursive: true });
    writeFileSync(join(root, "packages/cli/dist/cli.js"), 'await import("sharp");');
    writeFileSync(join(root, "packages/cli/dist/commands/x.js"), 'import sharp from "sharp";');
    assert.deepEqual(checkCliLazyDeps(root), [
      "packages/cli/dist/commands/x.js:1 imports sharp statically",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
