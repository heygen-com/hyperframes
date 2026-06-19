import { defineConfig } from "vitest/config";
import { resolve } from "path";

const coreRoot = resolve(new URL("..", import.meta.url).pathname, "core/src");

export default defineConfig({
  resolve: {
    alias: {
      "@hyperframes/core/slideshow": resolve(coreRoot, "slideshow/index.ts"),
    },
  },
  test: {
    environment: "happy-dom",
    setupFiles: ["./src/slideshow/test-setup.ts"],
  },
});
