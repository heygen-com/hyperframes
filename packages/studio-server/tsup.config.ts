import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "helpers/screenshotClip": "src/helpers/screenshotClip.ts",
    "helpers/mediaCodecMap": "src/helpers/mediaCodecMap.ts",
    "helpers/proxyTranscoder": "src/helpers/proxyTranscoder.ts",
    "helpers/mediaProxyPreview": "src/helpers/mediaProxyPreview.ts",
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
  // Split shared chunks so every entry (index + helper subpaths) imports ONE
  // copy of stateful modules — proxyTranscoder's in-flight dedupe, transcode
  // semaphore, and negative cache must be process-global, not per-entry.
  // With splitting off, each entry inlined its own copy and a pre-warm from
  // media-proxy-preview couldn't dedupe against a route's proxy-transcoder.
  splitting: true,
  sourcemap: true,
  clean: true,
  dts: true,
});
