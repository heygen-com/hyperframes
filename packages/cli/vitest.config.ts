import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defineConfig } from "vitest/config";
// Before workers fork, as below: the test run gets a home folder of its own.
import "./scripts/test-home.mjs";

// Windows: sharp's first text render builds Fontconfig's cache for every OS font (about 9 s on a
// fresh runner). Set here, before workers fork, because an in-process env write never reaches it.
if (process.platform === "win32") {
  const dir = mkdtempSync(join(tmpdir(), "hf-vitest-fontconfig-"));
  process.once("exit", () => rmSync(dir, { recursive: true, force: true }));
  copyFileSync(
    join(process.env.WINDIR ?? "C:\\Windows", "Fonts", "arial.ttf"),
    join(dir, "arial.ttf"),
  );
  const file = join(dir, "fonts.conf");
  writeFileSync(
    file,
    `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>${dir}</dir><cachedir>${dir}</cachedir></fontconfig>`,
  );
  process.env.FONTCONFIG_FILE = file;
}

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@hyperframes\/studio-server\/history$/,
        replacement: resolve(__dirname, "../studio-server/src/history/index.ts"),
      },
      // Resolve the bare @hyperframes/core entry to TypeScript source, not built
      // dist. The published dist intentionally omits runtime/entry.ts, so the
      // dist build of loadHyperframeRuntimeSource() returns null — which makes
      // studioServer.test.ts's runtime-source equality assertion diverge. Tests
      // run under bun against source; subpath imports (@hyperframes/core/*) keep
      // resolving via the package's export conditions.
      {
        find: /^@hyperframes\/core$/,
        replacement: resolve(__dirname, "../core/src/index.ts"),
      },
      // Same reason the tsup build aliases this specifier to source: the CLI
      // bundles the producer rather than depending on it at runtime, so its
      // dist is not built for the test job. Without the alias, vite's import
      // analysis resolves studioServer.ts's `import("@hyperframes/producer")`
      // against an unbuilt package and the whole suite fails to collect.
      {
        find: /^@hyperframes\/producer$/,
        replacement: resolve(__dirname, "../producer/src/index.ts"),
      },
    ],
  },
  test: {
    // Many CLI tests cold-import a heavy command module graph via dynamic
    // `import()` (e.g. render.js, auth/status.js, telemetry/system.js). Under
    // the full parallel monorepo run (`bun run --filter '!@hyperframes/producer'
    // test`) that cold load contends for CPU and routinely blows vitest's 5s
    // default test timeout / 10s hook timeout on CI runners — a recurring
    // flake that has failed unrelated PRs (see PRs #1843, #1850). These
    // generous ceilings absorb the contention while still catching a genuine
    // hang. Prefer this one config knob over per-test/per-hook timeout bandaids.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // Tests that drive a real Chrome (the four *.process.test.ts named here start one) run alone, after
    // everything else: a Chrome beside hundreds of parallel files was starved past its 30 s launch limit.
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          exclude: [
            "**/node_modules/**",
            "**/dist/**",
            "src/**/*.{browser,chromium}.test.ts",
            "src/**/{chromeOrphans,launch,checkDeadline,warmCheck}.process.test.ts",
          ],
          sequence: { groupOrder: 1 },
        },
      },
      {
        extends: true,
        test: {
          name: "chrome",
          include: [
            "src/**/*.{browser,chromium}.test.ts",
            "src/**/{chromeOrphans,launch,checkDeadline,warmCheck}.process.test.ts",
          ],
          fileParallelism: false,
          sequence: { groupOrder: 2 },
        },
      },
    ],
  },
});
