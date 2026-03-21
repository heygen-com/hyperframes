import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "jsdom",
    coverage: {
      provider: "v8",
      include: ["src/runtime/**/*.ts"],
      exclude: [
        "src/runtime/**/*.test.ts",
        "src/runtime/types.ts",
        "src/runtime/window.d.ts",
        "src/runtime/entry.ts",
        "src/runtime/init.ts",
        "src/runtime/README.md",
      ],
      thresholds: {
        // Enforced in CI — these are floor values, not targets
        statements: 75,
        branches: 70,
        functions: 80,
        lines: 75,
      },
    },
  },
});
