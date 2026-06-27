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
  },
});
