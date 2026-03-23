import type { KnipConfig } from "knip";

const config: KnipConfig = {
  workspaces: {
    "packages/cli": {
      entry: ["src/cli.ts"],
    },
    "packages/core": {
      entry: ["src/index.ts", "src/lint/index.ts", "src/compiler/index.ts"],
    },
    "packages/engine": {
      entry: ["src/index.ts"],
    },
    "packages/producer": {
      entry: ["src/index.ts", "src/server.ts"],
    },
    "packages/studio": {
      entry: ["src/index.ts", "src/styles/tailwind-preset.ts"],
    },
  },
};

export default config;
