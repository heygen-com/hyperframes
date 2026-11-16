import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "happy-dom",
    // Preview tests run the real bundler (~1 s each); in the parallel monorepo run on CI that
    // contends for CPU and passes the 5 s default. Same ceiling as the CLI's config.
    testTimeout: 20_000,
  },
});
