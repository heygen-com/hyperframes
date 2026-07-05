import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@hyperframes\/parsers$/,
        replacement: resolve(__dirname, "../parsers/src/index.ts"),
      },
      {
        find: /^@hyperframes\/parsers\/asset-paths$/,
        replacement: resolve(__dirname, "../parsers/src/assets.ts"),
      },
      {
        find: /^@hyperframes\/parsers\/composition$/,
        replacement: resolve(__dirname, "../parsers/src/composition.ts"),
      },
      {
        find: /^@hyperframes\/parsers\/gsap-parser-acorn$/,
        replacement: resolve(__dirname, "../parsers/src/gsapParserAcorn.ts"),
      },
      {
        find: /^@hyperframes\/parsers\/slideshow$/,
        replacement: resolve(__dirname, "../parsers/src/slideshow/index.ts"),
      },
      {
        find: /^@hyperframes\/parsers\/sub-composition-validity$/,
        replacement: resolve(__dirname, "../parsers/src/subCompositionValidity.ts"),
      },
    ],
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "jsdom",
  },
});
