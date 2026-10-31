import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { buildSync } from "esbuild";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bakeHfColorGradingCube, type HfColorGrading } from "@hyperframes/core";
import { findSystemBrowser } from "../browser/manager.js";

// The baked .cube must give what the runtime's WebGL shader draws. A 16-step lattice of 8x8 tiles,
// drawn 1:1, goes through the real runtime, and each tile centre is compared with the size-16
// bake, whose points are exactly the lattice's codes (k/15 = 17k/255).

interface GradingTestApi {
  setGrading(target: string, grading: HfColorGrading): boolean;
  redraw(): number;
}

declare global {
  interface Window {
    __bakeProbe: { createColorGradingRuntime(): GradingTestApi };
    __bakeTestRuntime: GradingTestApi;
  }
}

const configured = process.env.HYPERFRAMES_BROWSER_PATH ?? process.env.PUPPETEER_EXECUTABLE_PATH;
const executablePath =
  configured && existsSync(configured) ? configured : findSystemBrowser()?.executablePath;
const runsChromium =
  !!executablePath &&
  (process.platform !== "win32" || process.env.HYPERFRAMES_BROWSER_TESTS === "1");

const STEPS = 16;
const TILE = 8;
const TILES_PER_ROW = 64;
const SIDE = TILE * TILES_PER_ROW;

async function renderLattice(page: Page, grading: HfColorGrading): Promise<number[]> {
  return page.evaluate(
    (grading, side) => {
      const runtime = window.__bakeTestRuntime;
      if (!runtime.setGrading("#lattice", grading)) throw new Error("grading unavailable");
      runtime.redraw();
      const canvas = document.querySelector("canvas.__hf_color_grading_canvas__");
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error("missing grading canvas");
      if (canvas.width !== side || canvas.height !== side) {
        throw new Error(`grading canvas is ${canvas.width}x${canvas.height}, not ${side}`);
      }
      const output = document.createElement("canvas");
      output.width = side;
      output.height = side;
      const context = output.getContext("2d");
      if (!context) throw new Error("missing output context");
      context.drawImage(canvas, 0, 0);
      return [...context.getImageData(0, 0, side, side).data];
    },
    grading,
    SIDE,
  );
}

interface Difference {
  max: number;
  mean: number;
  /** The most the grade moved any lattice code, so an ungraded draw cannot pass. */
  moved: number;
  worst: string;
}

function compareWithBake(pixels: readonly number[], grading: HfColorGrading): Difference {
  const rows = bakeHfColorGradingCube(grading, { size: STEPS })
    .trim()
    .split("\n")
    .slice(3)
    .map((row) => row.split(" ").map((value) => Math.round(Number(value) * 255)));
  let max = 0;
  let total = 0;
  let moved = 0;
  let worst = "";
  for (let index = 0; index < STEPS ** 3; index += 1) {
    const column = index % TILES_PER_ROW;
    const row = Math.floor(index / TILES_PER_ROW);
    const offset = ((row * TILE + TILE / 2) * SIDE + column * TILE + TILE / 2) * 4;
    const expected = rows[index] ?? [];
    const source = [
      index % STEPS,
      Math.floor(index / STEPS) % STEPS,
      Math.floor(index / STEPS ** 2),
    ];
    for (let channel = 0; channel < 3; channel += 1) {
      const baked = expected[channel] ?? 0;
      const difference = Math.abs((pixels[offset + channel] ?? -1000) - baked);
      total += difference;
      moved = Math.max(moved, Math.abs(baked - (source[channel] ?? 0) * 17));
      if (difference > max) {
        max = difference;
        worst = `lattice ${index} channel ${channel}: drawn ${pixels[offset + channel]}, baked ${baked}`;
      }
    }
  }
  return { max, mean: total / (STEPS ** 3 * 3), moved, worst };
}

const PRIMARY: HfColorGrading = {
  adjust: {
    exposure: 0.2,
    contrast: 0.25,
    highlights: -0.3,
    shadows: 0.2,
    whites: 0.1,
    blacks: -0.1,
    temperature: 0.3,
    tint: -0.15,
    vibrance: 0.4,
    saturation: -0.1,
  },
};

const ADVANCED: HfColorGrading = {
  adjust: { contrast: 0.1, saturation: 0.1 },
  wheels: {
    shadows: { hue: 215, amount: 0.4, level: -0.05 },
    midtones: { hue: 100, amount: 0.15, level: 0.02 },
    highlights: { hue: 40, amount: 0.3, level: 0.04 },
  },
  curves: {
    master: [
      [0, 0],
      [0.25, 0.2],
      [0.75, 0.82],
      [1, 1],
    ],
    red: [
      [0, 0.02],
      [0.5, 0.55],
      [1, 1],
    ],
  },
  hueCurves: {
    hueVsSaturation: [
      [0, 0.3],
      [120, -0.4],
      [240, 0.2],
    ],
  },
  secondaries: [
    {
      key: {
        hue: { center: 30, range: 25, softness: 20 },
        saturation: { min: 0.15, max: 1, softness: 0.1 },
        luma: { min: 0.1, max: 0.9, softness: 0.1 },
      },
      correction: { hueShift: -10, saturation: -0.2, luma: 0.03, temperature: 0.2 },
    },
  ],
};

describe.skipIf(!runsChromium)("baked .cube against the color grading shader", () => {
  let browser: Browser;
  let page: Page;
  const browserErrors: string[] = [];

  beforeAll(async () => {
    const bundle = buildSync({
      entryPoints: [resolve("../core/src/runtime/colorGrading.ts")],
      bundle: true,
      platform: "browser",
      format: "iife",
      globalName: "__bakeProbe",
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
    await page.setViewport({ width: SIDE, height: SIDE, deviceScaleFactor: 1 });
    await page.setContent(
      `<body style="margin:0"><img id="lattice" style="width:${SIDE}px;height:${SIDE}px;display:block"></body>`,
    );
    await page.evaluate("self.__name = self.__name || ((fn) => fn);");
    await page.addScriptTag({ content: script });
    await page.evaluate(
      async (steps, tile, perRow, side) => {
        const source = document.createElement("canvas");
        source.width = side;
        source.height = side;
        const context = source.getContext("2d");
        if (!context) throw new Error("missing source context");
        const code = (step: number) => Math.round((step * 255) / (steps - 1));
        for (let index = 0; index < steps ** 3; index += 1) {
          const r = code(index % steps);
          const g = code(Math.floor(index / steps) % steps);
          const b = code(Math.floor(index / (steps * steps)));
          context.fillStyle = `rgb(${r},${g},${b})`;
          context.fillRect((index % perRow) * tile, Math.floor(index / perRow) * tile, tile, tile);
        }
        const image = document.getElementById("lattice");
        if (!(image instanceof HTMLImageElement)) throw new Error("missing lattice image");
        image.src = source.toDataURL();
        await image.decode();
        window.__bakeTestRuntime = window.__bakeProbe.createColorGradingRuntime();
      },
      STEPS,
      TILE,
      TILES_PER_ROW,
      SIDE,
    );
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
  });

  it.each([
    ["a primary-only grade", PRIMARY],
    ["wheels, an RGB curve, a hue curve and a secondary", ADVANCED],
  ] satisfies [string, HfColorGrading][])(
    "agrees within two codes for %s",
    async (_name, grading) => {
      const difference = compareWithBake(await renderLattice(page, grading), grading);
      expect(difference.moved).toBeGreaterThan(20);
      expect(difference.max, difference.worst).toBeLessThanOrEqual(2);
      expect(difference.mean).toBeLessThan(0.1);
      expect(browserErrors).toEqual([]);
    },
    60_000,
  );
});
