import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    gsapParserExports: "src/gsapParserExports.ts",
    gsapParserAcorn: "src/gsapParserAcorn.ts",
    gsapWriterAcorn: "src/gsapWriterAcorn.ts",
    gsapConstants: "src/gsapConstants.ts",
    springEase: "src/springEase.ts",
    hfIds: "src/hfIds.ts",
    gsapParser: "src/gsapParser.ts",
    slideshow: "src/slideshow/index.ts",
    assets: "src/assets.ts",
    composition: "src/composition.ts",
    subCompositionValidity: "src/subCompositionValidity.ts",
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
