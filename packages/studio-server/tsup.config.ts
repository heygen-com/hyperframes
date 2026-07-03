import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "helpers/screenshotClip": "src/helpers/screenshotClip.ts",
    "helpers/manualEditsRenderScript": "src/helpers/manualEditsRenderScript.ts",
    "helpers/studioMotionRenderScript": "src/helpers/studioMotionRenderScript.ts",
    "helpers/draftMarkers": "src/helpers/draftMarkers.ts",
    "helpers/finiteMutation": "src/helpers/finiteMutation.ts",
    "helpers/sourceMutation": "src/helpers/sourceMutation.ts",
  },
  format: ["esm"],
  outDir: "dist",
  target: "node22",
  platform: "node",
  bundle: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: true,
});
