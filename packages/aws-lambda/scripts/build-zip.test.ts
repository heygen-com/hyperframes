import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { managedChromeVersion } from "@hyperframes/engine/chrome-host-ceiling";
import * as esbuild from "esbuild";
import { BUNDLED_SHELL_DIR, BUNDLED_SHELL_PATH } from "../src/chromium.js";
import { stageChromeHeadlessShell } from "./_chromeHeadlessShell.js";
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

describe("build-zip chrome-headless-shell staging", () => {
  // @puppeteer/browsers' layout: chrome-headless-shell/linux-<version>/chrome-headless-shell-linux64/.
  function puppeteerCache(versions: Record<string, Record<string, string>>): string {
    const home = mkdtempSync(join(tmpdir(), "hf-shell-cache-"));
    for (const [version, files] of Object.entries(versions)) {
      const folder = join(home, ".cache/puppeteer/chrome-headless-shell", `linux-${version}`);
      for (const [path, body] of Object.entries(files)) {
        const file = join(folder, "chrome-headless-shell-linux64", path);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, body, { mode: path === "chrome-headless-shell" ? 0o755 : 0o644 });
      }
    }
    return home;
  }
  const pinned = managedChromeVersion("linux");

  it("stages the whole pinned shell folder where the template and the CDK stack point", () => {
    const home = puppeteerCache({
      "999.0.0.1": { "chrome-headless-shell": "newer" },
      [pinned]: {
        "chrome-headless-shell": "exe",
        "icudtl.dat": "icu",
        "headless_lib_data.pak": "pak",
        "locales/en-US.pak": "locale",
      },
    });
    const staging = mkdtempSync(join(tmpdir(), "hf-shell-staging-"));
    const checked: string[] = [];
    try {
      const isPinned = (exe: string) => checked.push(exe) > 0;
      expect(stageChromeHeadlessShell(staging, home, isPinned)).toBe(pinned);
      expect(checked).toEqual([
        join(
          home,
          ".cache/puppeteer/chrome-headless-shell",
          `linux-${pinned}`,
          "chrome-headless-shell-linux64",
          "chrome-headless-shell",
        ),
      ]);
      const shell = join(staging, BUNDLED_SHELL_DIR);
      // Without icudtl.dat beside it the shell exits at launch, so the folder ships whole.
      expect(readFileSync(join(shell, "icudtl.dat"), "utf-8")).toBe("icu");
      expect(readFileSync(join(shell, "headless_lib_data.pak"), "utf-8")).toBe("pak");
      expect(readFileSync(join(shell, "locales/en-US.pak"), "utf-8")).toBe("locale");
      expect(readFileSync(join(shell, "chrome-headless-shell"), "utf-8")).toBe("exe");
      expect(statSync(join(shell, "chrome-headless-shell")).mode & 0o111).not.toBe(0);
      expect(join("/var/task", BUNDLED_SHELL_DIR, "chrome-headless-shell")).toBe(
        BUNDLED_SHELL_PATH,
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(staging, { recursive: true, force: true });
    }
  });

  it("refuses a cached folder that does not match the pinned digest", () => {
    const home = puppeteerCache({
      [pinned]: { "chrome-headless-shell": "tampered" },
    });
    const staging = mkdtempSync(join(tmpdir(), "hf-shell-staging-"));
    try {
      expect(() => stageChromeHeadlessShell(staging, home)).toThrow(/does not match the pinned/);
      expect(existsSync(join(staging, BUNDLED_SHELL_DIR))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(staging, { recursive: true, force: true });
    }
  });

  it("names the pinned install command when only another version is cached", () => {
    const home = puppeteerCache({
      "999.0.0.1": { "chrome-headless-shell": "newer" },
    });
    try {
      expect(() => stageChromeHeadlessShell(home, home)).toThrow(
        new RegExp(
          `@puppeteer/browsers install chrome-headless-shell@${pinned.replaceAll(".", "\\.")} `,
        ),
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
