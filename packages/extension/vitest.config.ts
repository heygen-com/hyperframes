import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@hyperframes/core/web-capture": resolve(
        import.meta.dirname,
        "../core/src/webCaptureContract.ts",
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
