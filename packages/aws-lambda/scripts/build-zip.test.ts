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
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { headlessShellDigest, managedChromeVersion } from "@hyperframes/engine/chrome-host-ceiling";
import * as esbuild from "esbuild";
import { BUNDLED_SHELL_DIR } from "../src/chromium.js";
import { stageChromeHeadlessShell } from "./_chromeHeadlessShell.js";
import { stageFfmpeg } from "./_ffmpeg.js";
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
  const shellFolder = (home: string, version: string) =>
    join(
      home,
      ".cache/puppeteer/chrome-headless-shell",
      `linux-${version}`,
      "chrome-headless-shell-linux64",
    );

  it("stages the whole pinned shell folder", () => {
    const home = puppeteerCache({
      "999.0.0.1": { "chrome-headless-shell": "newer" },
      [pinned]: {
        "chrome-headless-shell": "exe",
        "icudtl.dat": "icu",
        "headless_lib_data.pak": "pak",
        "locales/en-US.pak": "locale",
        "debug.log": "written by a run",
      },
    });
    const staging = mkdtempSync(join(tmpdir(), "hf-shell-staging-"));
    try {
      const digests = { [pinned]: [headlessShellDigest(shellFolder(home, pinned))!] };
      expect(stageChromeHeadlessShell(staging, home, digests)).toBe(pinned);
      const shell = join(staging, BUNDLED_SHELL_DIR);
      // The digest leaves out what Chrome writes as it runs, so none of that ships.
      expect(existsSync(join(shell, "debug.log"))).toBe(false);
      // Without icudtl.dat beside it the shell exits at launch, so the folder ships whole.
      expect(readFileSync(join(shell, "icudtl.dat"), "utf-8")).toBe("icu");
      expect(readFileSync(join(shell, "headless_lib_data.pak"), "utf-8")).toBe("pak");
      expect(readFileSync(join(shell, "locales/en-US.pak"), "utf-8")).toBe("locale");
      expect(readFileSync(join(shell, "chrome-headless-shell"), "utf-8")).toBe("exe");
      expect(statSync(join(shell, "chrome-headless-shell")).mode & 0o111).not.toBe(0);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(staging, { recursive: true, force: true });
    }
  });

  it("refuses a folder whose digest is pinned only for another build", () => {
    const home = puppeteerCache({ [pinned]: { "chrome-headless-shell": "exe" } });
    const staging = mkdtempSync(join(tmpdir(), "hf-shell-staging-"));
    try {
      const digests = { "150.0.7871.124": [headlessShellDigest(shellFolder(home, pinned))!] };
      expect(() => stageChromeHeadlessShell(staging, home, digests)).toThrow(
        /does not match the pinned/,
      );
      expect(existsSync(join(staging, BUNDLED_SHELL_DIR))).toBe(false);
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

describe("build-zip ffmpeg staging", () => {
  // A Linux x86-64 ELF header, so only the digest can tell this binary from the real one.
  const elfX64 = (tail: string) => {
    const head = Buffer.alloc(20);
    Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2]).copy(head);
    head.writeUInt16LE(0x3e, 18);
    return Buffer.concat([head, Buffer.from(tail)]);
  };
  function modules(ffmpeg: Buffer, version = "5.3.0") {
    const root = mkdtempSync(join(tmpdir(), "hf-ffmpeg-modules-"));
    const ffmpegModule = join(root, "ffmpeg-static");
    const ffprobeModule = join(root, "ffprobe-static");
    mkdirSync(ffmpegModule, { recursive: true });
    writeFileSync(join(ffmpegModule, "package.json"), JSON.stringify({ version }));
    writeFileSync(join(ffmpegModule, "ffmpeg"), ffmpeg);
    mkdirSync(join(ffprobeModule, "bin/linux/x64"), { recursive: true });
    writeFileSync(join(ffprobeModule, "bin/linux/x64/ffprobe"), "probe");
    return { root, ffmpegModule, ffprobeModule };
  }
  const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

  it("refuses an ffmpeg whose bytes differ from the pinned digest", () => {
    // fails without the fix: any file with a Linux x86-64 ELF header was copied into bin/ffmpeg.
    const { root, ffmpegModule, ffprobeModule } = modules(elfX64("swapped"));
    try {
      expect(() => stageFfmpeg(root, ffmpegModule, ffprobeModule)).toThrow(
        /ffmpeg-static 5\.3\.0 binary .* has sha256 [0-9a-f]{64}, not the pinned e7e7fb30/,
      );
      expect(existsSync(join(root, "bin/ffmpeg"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses an ffmpeg-static version with no pinned digest", () => {
    const binary = elfX64("next");
    const { root, ffmpegModule, ffprobeModule } = modules(binary, "5.4.0");
    try {
      expect(() =>
        stageFfmpeg(root, ffmpegModule, ffprobeModule, { "5.3.0": sha256(binary) }),
      ).toThrow(/ffmpeg-static 5\.4\.0 has no pinned sha256/);
      expect(existsSync(join(root, "bin/ffmpeg"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("stages an ffmpeg that matches its version's pinned digest", () => {
    const binary = elfX64("real");
    const { root, ffmpegModule, ffprobeModule } = modules(binary);
    try {
      stageFfmpeg(root, ffmpegModule, ffprobeModule, { "5.3.0": sha256(binary) });
      expect(readFileSync(join(root, "bin/ffmpeg")).equals(binary)).toBe(true);
      expect(statSync(join(root, "bin/ffmpeg")).mode & 0o111).not.toBe(0);
      expect(readFileSync(join(root, "bin/ffprobe"), "utf-8")).toBe("probe");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
