import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    environmentOptions: {
      happyDOM: { settings: { enableIframePageLoading: true } },
    },
  },
});
