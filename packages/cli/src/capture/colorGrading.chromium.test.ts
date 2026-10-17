import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { buildSync } from "esbuild";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  compileHfHueCurve,
  type HfColorGrading,
  type HfHueCurvePoint,
} from "@hyperframes/core/color-grading";
import { findSystemBrowser } from "../browser/manager.js";

interface GradingTestApi {
  setGrading(target: string, grading: HfColorGrading): boolean;
  redraw(): number;
}

declare global {
  interface Window {
    __gradingProbe: { createColorGradingRuntime(): GradingTestApi };
    __gradingTestRuntime: GradingTestApi;
  }
}

const configured = process.env.HYPERFRAMES_BROWSER_PATH ?? process.env.PUPPETEER_EXECUTABLE_PATH;
const executablePath =
  configured && existsSync(configured) ? configured : findSystemBrowser()?.executablePath;
const runsChromium =
  !!executablePath &&
  (process.platform !== "win32" || process.env.HYPERFRAMES_BROWSER_TESTS === "1");

function lumaDeltaAt(points: readonly HfHueCurvePoint[], rgb: readonly number[]): number {
  const [red = 0, green = 0, blue = 0] = rgb;
  const hue = (((green - blue) / (red - Math.min(green, blue)) + 6) % 6) / 6;
  const samples = compileHfHueCurve(points, -1, 1);
  const position = hue * samples.length;
  const lower = Math.floor(position);
  const before = samples[lower];
  const after = samples[(lower + 1) % samples.length];
  if (before === undefined || after === undefined) throw new Error("missing hue samples");
  const encoded = (value: number): number => Math.round(value * 127 + 128);
  const amount = position - lower;
  return (encoded(before) * (1 - amount) + encoded(after) * amount - 128) / 127;
}

async function setSourcePixel(page: Page, rgb: readonly number[]): Promise<void> {
  await page.evaluate(async (rgb) => {
    const source = document.createElement("canvas");
    source.width = 64;
    source.height = 32;
    const context = source.getContext("2d");
    if (!context) throw new Error("missing source context");
    context.fillStyle = "rgb(" + rgb.join(",") + ")";
    context.fillRect(0, 0, source.width, source.height);
    const image = document.getElementById("sample");
    if (!(image instanceof HTMLImageElement)) throw new Error("missing sample image");
    image.src = source.toDataURL();
    await image.decode();
  }, rgb);
}

async function renderPixel(page: Page, grading: HfColorGrading): Promise<number[]> {
  return page.evaluate((grading) => {
    const runtime = window.__gradingTestRuntime;
    if (!runtime.setGrading("#sample", grading)) throw new Error("grading unavailable");
    runtime.redraw();
    const canvas = document.querySelector("canvas.__hf_color_grading_canvas__");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("missing grading canvas");
    const output = document.createElement("canvas");
    output.width = canvas.width;
    output.height = canvas.height;
    const context = output.getContext("2d");
    if (!context) throw new Error("missing output context");
    context.drawImage(canvas, 0, 0);
    return [...context.getImageData(32, 16, 1, 1).data];
  }, grading);
}

describe.skipIf(!runsChromium)("color grading curves in Chromium", () => {
  let browser: Browser;
  let page: Page;
  const browserErrors: string[] = [];

  beforeAll(async () => {
    const bundle = buildSync({
      entryPoints: [resolve("../core/src/runtime/colorGrading.ts")],
      bundle: true,
      platform: "browser",
      format: "iife",
      globalName: "__gradingProbe",
      write: false,
    });
    const script = bundle.outputFiles[0]?.text;
    if (!script) throw new Error("missing grading runtime");
    browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: [
        "--no-sandbox",
        "--enable-unsafe-swiftshader",
        "--use-gl=angle",
        "--use-angle=swiftshader",
      ],
    });
    page = await browser.newPage();
    page.on("pageerror", (error) => browserErrors.push(String(error)));
    await page.setViewport({ width: 64, height: 32 });
    await page.setContent(
      '<body style="margin:0"><img id="sample" style="width:64px;height:32px;display:block"></body>',
    );
    await page.evaluate("self.__name = self.__name || ((fn) => fn);");
    await page.addScriptTag({ content: script });
    await setSourcePixel(page, [255, 0, 0]);
    await page.evaluate(() => {
      window.__gradingTestRuntime = window.__gradingProbe.createColorGradingRuntime();
    });
    await renderPixel(page, {
      hueCurves: {
        hueVsLuma: [
          [0, 0],
          [359, 0],
          [359.8, 0.8],
        ],
      },
    });
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
  });

  it.each([
    {
      rgb: [255, 0, 1],
      points: [
        [0, 0],
        [359, 0],
        [359.8, 0.8],
      ],
    },
    {
      rgb: [255, 0, 1],
      points: [
        [0, 0.5],
        [359, -0.5],
        [359.8, -0.5],
      ],
    },
    {
      rgb: [255, 1, 0],
      points: [
        [0, 0],
        [0.2, 0.8],
        [180, 0],
      ],
    },
  ] satisfies { rgb: number[]; points: HfHueCurvePoint[] }[])(
    "interpolates periodic hue samples for $rgb",
    async ({ rgb, points }) => {
      await setSourcePixel(page, rgb);
      const actual = await renderPixel(page, { hueCurves: { hueVsLuma: points } });
      const delta = lumaDeltaAt(points, rgb);
      const expected = rgb.map((value) =>
        Math.round(Math.min(255, Math.max(0, value + delta * 255))),
      );
      for (let channel = 0; channel < 3; channel++) {
        expect(Math.abs((actual[channel] ?? -1000) - (expected[channel] ?? 0))).toBeLessThanOrEqual(
          2,
        );
      }
      expect(actual[3]).toBe(255);
      expect(browserErrors).toEqual([]);
    },
  );

  it("keeps RGB curve endpoints clamped", async () => {
    await setSourcePixel(page, [255, 0, 0]);
    const actual = await renderPixel(page, {
      curves: {
        red: [
          [0, 0],
          [1, 0.5],
        ],
      },
    });
    expect(actual).toEqual([128, 0, 0, 255]);
    expect(browserErrors).toEqual([]);
  });
});
