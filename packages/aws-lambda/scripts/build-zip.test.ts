import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { HANDLER_BANNER } from "./_handlerBanner.js";

// The handler ships as ESM (.mjs) but inlines CJS deps that assume Node's CJS
// globals exist at module scope: postcss et al. call top-level `require(...)`,
// and wawoff2's emscripten build reads `__dirname`. A freshly deployed stack
// crashed on every render (#1932) with "__dirname is not defined in ES module
// scope"; the fix is the require/__filename/__dirname shim in HANDLER_BANNER.
//
// This bundles a fixture touching all three globals with the REAL banner and
// imports the output, so it catches a dropped/renamed shim behaviourally
// rather than by grepping for literals (which survives a broken refactor).
//
// The import MUST run under Node, not the `bun test` runtime: Bun defines
// `__dirname`/`__filename` even in ESM, which would mask a missing shim and
// green-light a broken bundle. Lambda runs Node, so we spawn `node` (guaranteed
// present in CI alongside bun) to reproduce the deploy target faithfully.
describe("build-zip handler banner", () => {
  it("shims require/__filename/__dirname so inlined CJS deps import under Node", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-banner-test-"));
    try {
      const entry = join(dir, "fixture.ts");
      const outfile = join(dir, "out.mjs");
      // Reference each CJS global at module top level, the way inlined deps do.
      // If any shim is missing, importing `out.mjs` throws at eval time.
      writeFileSync(
        entry,
        [
          "const cjsDir = __dirname;",
          "const cjsFile = __filename;",
          "const path = require('node:path');",
          "if (typeof cjsDir !== 'string') throw new Error('__dirname missing');",
          "if (typeof cjsFile !== 'string') throw new Error('__filename missing');",
          "if (typeof path.join !== 'function') throw new Error('require missing');",
          "console.log('BANNER_OK');",
        ].join("\n"),
      );

      esbuild.buildSync({
        bundle: true,
        platform: "node",
        target: "node22",
        format: "esm",
        entryPoints: [entry],
        outfile,
        banner: { js: HANDLER_BANNER },
      });

      // Import under real Node — Lambda's runtime — not the bun test runtime.
      const res = spawnSync(
        "node",
        [
          "--input-type=module",
          "-e",
          `await import(${JSON.stringify(pathToFileURL(outfile).href)});`,
        ],
        { encoding: "utf8" },
      );

      // A missing shim surfaces as a non-zero exit + ReferenceError on stderr.
      // Guard against a silent skip if `node` isn't on PATH (it is in CI).
      expect(res.error).toBeUndefined();
      expect(res.stderr).not.toContain("is not defined in ES module scope");
      expect(res.stderr).not.toContain("Dynamic require");
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("BANNER_OK");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
