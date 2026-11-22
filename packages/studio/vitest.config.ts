import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

// Tests that drive a real Chrome run alone, after the unit tests: a Chrome started beside them on a
// CI runner missed its 20 s launch window twice, failing the whole suite.
export default mergeConfig(
  viteConfig,
  defineConfig({
    esbuild: { define: { "import.meta.hot": "undefined" } },
    test: {
      projects: [
        {
          extends: true,
          test: {
            name: "unit",
            exclude: ["**/*.browser.test.ts"],
            sequence: { groupOrder: 1 },
          },
        },
        {
          extends: true,
          test: {
            name: "browser",
            include: ["**/*.browser.test.ts"],
            fileParallelism: false,
            sequence: { groupOrder: 2 },
          },
        },
      ],
    },
  }),
);
