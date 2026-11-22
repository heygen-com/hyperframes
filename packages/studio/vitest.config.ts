import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

// A Chrome started beside the unit tests on a busy runner can miss its launch window, so these run alone, after.
export default mergeConfig(
  viteConfig,
  defineConfig({
    esbuild: { define: { "import.meta.hot": "undefined" } },
    test: {
      projects: [
        {
          extends: true,
          test: { name: "unit", exclude: ["**/*.browser.test.ts"], sequence: { groupOrder: 1 } },
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
