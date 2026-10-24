import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HF_COLOR_GRADING_DETAIL_KEYS, HF_COLOR_GRADING_EFFECT_KEYS } from "@hyperframes/core";
import { ensureBrowser } from "./manager.js";

// A grade compiles only the shader stages it turns on, on the software GL distributed renders use.
// Compiling the whole shader takes tens of seconds there, so each stage is checked on its own.

const RUNTIME = buildSync({
  stdin: {
    contents: `import { createColorGradingRuntime } from ${JSON.stringify(
      fileURLToPath(new URL("../../../core/src/runtime/colorGrading.ts", import.meta.url)),
    )};
window.createColorGradingRuntime = createColorGradingRuntime;`,
    resolveDir: fileURLToPath(new URL(".", import.meta.url)),
    loader: "ts",
  },
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
}).outputFiles[0]?.text;

const PAGE = `<!doctype html><body style="margin:0">
<img id="media" style="display:block;width:96px;height:64px" data-color-grading='{"adjust":{"contrast":0.2}}'>
<script>
  // Records the main shader's sources, and compiles window.extraStage into each when set.
  window.mainSources = [];
  const shaderSource = WebGLRenderingContext.prototype.shaderSource;
  WebGLRenderingContext.prototype.shaderSource = function (shader, source) {
    if (source.includes("#ifdef HF_STAGE_")) {
      if (window.extraStage) source = "#define " + window.extraStage + "\\n" + source;
      window.mainSources.push(source);
    }
    return shaderSource.call(this, shader, source);
  };
  const pattern = document.createElement("canvas");
  pattern.width = 96;
  pattern.height = 64;
  const ctx = pattern.getContext("2d");
  const ramp = ctx.createLinearGradient(0, 0, 96, 64);
  ramp.addColorStop(0, "#0b1d3a");
  ramp.addColorStop(0.5, "#d9822b");
  ramp.addColorStop(1, "#f2f0e6");
  ctx.fillStyle = ramp;
  ctx.fillRect(0, 0, 96, 64);
  ctx.fillStyle = "#2fbf71";
  ctx.fillRect(10, 8, 30, 20);
  ctx.fillStyle = "#c62f6a";
  ctx.beginPath();
  ctx.arc(64, 40, 16, 0, Math.PI * 2);
  ctx.fill();
  document.getElementById("media").src = pattern.toDataURL("image/png");
</script>
<script>${RUNTIME}</script>
</body>`;

// The grade values that turn a stage on. Everything else only tunes a stage that is on.
const STAGE_SWITCHES = new Set([
  "blur",
  "kuwahara",
  "pixelate",
  "tapeDamage",
  "chromaBleed",
  "chromaticAberration",
  "crtCurvature",
  "digitalGlitch",
  "filmArtifacts",
  "monoScreen",
  "engraving",
  "crosshatch",
  "halftone",
  "twoInkPrint",
  "dither",
  "ascii",
  "bloom",
  "scanlines",
  "grain",
  "vignette",
]);

const tuning = (keys: readonly string[]) =>
  Object.fromEntries(
    keys
      .filter((key) => !STAGE_SWITCHES.has(key))
      .map((key) => [key, key === "bloomRadius" ? 40 : key === "asciiStyle" ? 3 : 0.6]),
  );

// Every stage off, every stage's tuning on: what a compiled-in stage would read if it leaked.
const EVERY_STAGE_OFF = {
  adjust: { contrast: 0.2 },
  details: tuning(HF_COLOR_GRADING_DETAIL_KEYS),
  effects: tuning(HF_COLOR_GRADING_EFFECT_KEYS),
};

let browser: Browser;
let page: Page;

const definedStages = (source: string) =>
  [...source.matchAll(/^#define (HF_STAGE_\w+)$/gm)].map((match) => match[1]);

beforeAll(async () => {
  const { executablePath } = await ensureBrowser();
  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  page = await browser.newPage();
  await page.setContent(PAGE);
  await page.evaluate(() => (document.getElementById("media") as HTMLImageElement).decode());
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

describe("color grading shader stages on software GL", () => {
  it("draws the same pixels whether a stage the grade leaves off is compiled in or out", async () => {
    const drawn = await page.evaluate(async (grading) => {
      const draw = async (stage: string | null) => {
        Reflect.set(window, "extraStage", stage);
        const runtime = Reflect.get(window, "createColorGradingRuntime")();
        const batch = await runtime.renderPreviews("media", [{ id: "off", grading }]);
        runtime.destroy();
        const sources: string[] = Reflect.get(window, "mainSources");
        return { image: batch?.images[0]?.dataUrl ?? null, source: sources.at(-1) ?? "" };
      };
      const stagesOut = await draw(null);
      const stages = [...new Set(stagesOut.source.match(/(?<=#ifdef )HF_STAGE_\w+/g))];
      const stagesIn: Record<string, Awaited<ReturnType<typeof draw>>> = {};
      for (const stage of stages) stagesIn[stage] = await draw(stage);
      return { stagesOut, stagesIn };
    }, EVERY_STAGE_OFF);

    expect(drawn.stagesOut.image).toMatch(/^data:image\/png/);
    expect(definedStages(drawn.stagesOut.source)).toEqual([]);
    expect(Object.keys(drawn.stagesIn).length).toBeGreaterThanOrEqual(20);
    for (const [stage, { image, source }] of Object.entries(drawn.stagesIn)) {
      expect(definedStages(source), stage).toEqual([stage]);
      expect(image, stage).toBe(drawn.stagesOut.image);
    }
  }, 120_000);

  it("compiles and draws a stage that turns on mid-render", async () => {
    const frames = await page.evaluate(() => {
      Reflect.set(window, "extraStage", null);
      const runtime = Reflect.get(window, "createColorGradingRuntime")();
      const media = document.getElementById("media") as HTMLImageElement;
      const sources: string[] = Reflect.get(window, "mainSources");
      const frame = () => {
        runtime.redraw();
        const canvas = document.querySelector<HTMLCanvasElement>(
          "canvas[data-hf-color-grading-canvas]",
        );
        return { image: canvas?.toDataURL("image/png") ?? null, source: sources.at(-1) ?? "" };
      };
      runtime.refresh();
      const before = frame();
      media.style.setProperty("--hf-color-grading-blur", "0.5");
      const after = frame();
      runtime.destroy();
      return { before, after };
    });

    expect(definedStages(frames.before.source)).toEqual([]);
    expect(definedStages(frames.after.source)).toEqual(["HF_STAGE_BLUR"]);
    expect(frames.before.image).toMatch(/^data:image\/png/);
    expect(frames.after.image).not.toBe(frames.before.image);
  }, 60_000);
});
