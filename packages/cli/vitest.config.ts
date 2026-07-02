import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
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
    ],
  },
  test: {
    include: ["src/**/*.test.ts"],
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
  },
});
