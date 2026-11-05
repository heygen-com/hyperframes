import { defineConfig } from "vitest/config";

// Tests that drive a real Chrome run alone, after everything else: a Chrome sharing the
// runner with the ffmpeg tests got starved past vitest's hook limit on 4-core Windows.
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          exclude: ["**/node_modules/**", "**/dist/**", "src/**/*.browser.test.ts"],
          sequence: { groupOrder: 1 },
        },
      },
      {
        extends: true,
        test: {
          name: "browser",
          include: ["src/**/*.browser.test.ts"],
          hookTimeout: 30_000,
          fileParallelism: false,
          sequence: { groupOrder: 2 },
        },
      },
    ],
  },
});
