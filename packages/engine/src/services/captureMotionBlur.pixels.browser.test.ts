import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodePng } from "../utils/alphaBlit.js";
import { resolveHeadlessShellPath } from "./browserManager.js";
import { closeTestChrome } from "./__fixtures__/loopback.js";
import { acceleratedCanvasTrackerSource } from "@hyperframes/core";
import { waitForPendingSeekCompletion } from "./frameCapture.js";

const RUNTIME = resolve(import.meta.dirname, "../../../core/dist/hyperframe.runtime.iife.js");
const chromePath = resolveHeadlessShellPath();
const hasBrowser =
  chromePath !== undefined &&
  existsSync(RUNTIME) &&
  spawnSync(chromePath, ["--version"]).status === 0;

const W = 320;
const H = 180;
const FPS = 30;
/** One of the 16 taps is 255 / 16: a plateau may wobble by that much. */
const TAP = 16;

interface Frame {
  width: number;
  data: Uint8Array;
}
type Win = Window & {
  __player?: { renderSeek?: (t: number) => void };
  __hf_page_composite_pending?: boolean;
  __hf_page_composite_prepare?: () => Promise<boolean>;
  __hf_page_composite_resolve?: () => boolean;
  __hfMotionBlur?: {
    report: () => { state: string; tier: string | null; reasonCode: string | null; movers: number };
  };
};

/** 40 px box moving 60 px per frame (1800 px over the 1 s composition). */
const STYLE = `
  @keyframes run { to { transform: translateX(1800px) } }
  @keyframes flip { to { transform: rotateY(180deg) } }
  @keyframes hide { from, to { backface-visibility: hidden } }
  @keyframes blink { 0%, 44% { backface-visibility: visible } 46%, 49% { backface-visibility: hidden } 51%, 100% { backface-visibility: visible } }
  .box { position: absolute; width: 40px; height: 40px; background: #f00; animation: run 1s linear both }
`;
const BOX = `<div class="box" id="box" style="left:20px;top:20px"></div>`;
const STRIPES = `<div id="stripes" style="position:absolute;left:200px;top:100px;width:40px;height:40px;background:repeating-linear-gradient(90deg,#000 0 2px,#fff 2px 4px)"></div>`;
const CENTERED = `<div class="box" id="centered" style="left:50%;top:50%;translate:-50% -50%"></div>`;
const FLIP = `<div style="position:absolute;left:100px;top:40px;width:100px;height:100px;perspective:400px"><div id="card" style="width:100px;height:100px;background:#06c;backface-visibility:hidden;animation:flip 1s linear both"></div></div>`;

/** A card whose backface-visibility, if any, comes only from the given animation. */
const card = (animation: string, perspective = "perspective:400px") =>
  `<div style="position:absolute;left:100px;top:40px;width:100px;height:100px;${perspective}"><div id="card" style="width:100px;height:100px;background:#06c;${animation}"></div></div>`;
const WAAPI = `<script>document.getElementById("card").animate([{backfaceVisibility:"hidden"},{backfaceVisibility:"hidden"}],1000)</script>`;
const same = (a: Frame, b: Frame): boolean => Buffer.from(a.data).equals(Buffer.from(b.data));

type Tier = "capture" | "filter";

function composition(body: string, blur: boolean, tier?: Tier): string {
  const attrs = blur
    ? ` data-motion-blur="on" data-motion-blur-shutter="360"${tier ? ` data-motion-blur-tier="${tier}"` : ""}`
    : "";
  return `<!doctype html><html><head><style>html,body{margin:0}${STYLE}</style></head><body>
    <div id="root" data-composition-id="root" data-start="0" data-duration="1" data-width="${W}" data-height="${H}"${attrs}
      style="position:relative;width:${W}px;height:${H}px;background:#fff;overflow:hidden">${body}</div></body></html>`;
}

const px = (f: Frame, x: number, y: number): [number, number, number] => {
  const i = (y * f.width + x) * 4;
  return [f.data[i] ?? 0, f.data[i + 1] ?? 0, f.data[i + 2] ?? 0];
};

/** How far a pixel is from white along white-to-red: 0 for white, 255 for pure red. */
const redness = (f: Frame, x: number, y: number): number => 255 - px(f, x, y)[1];

const row = (f: Frame, y: number): number[] =>
  Array.from({ length: W }, (_, x) => redness(f, x, y));

/** Columns that are neither the background nor the pure box colour. */
const intermediate = (values: number[]): number[] =>
  values.flatMap((v, x) => (v > 0 && v < 255 ? [x] : []));

/** Total redness: a blur spreads the box's ink along the path without adding or losing any. */
const ink = (values: number[]): number => values.reduce((s, v) => s + v, 0);

const centroid = (values: number[]): number => {
  const total = values.reduce((s, v) => s + v, 0);
  return values.reduce((s, v, x) => s + v * (x + 0.5), 0) / total;
};

describe.skipIf(!hasBrowser)("capture motion blur pixels in Chrome", () => {
  let browser: Browser;
  let supported = false;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-features=CanvasDrawElement"],
    });
    const probe = await browser.newPage();
    supported = await probe.evaluate(
      () =>
        typeof Reflect.get(CanvasRenderingContext2D.prototype, "drawElementImage") === "function",
    );
    await probe.close();
  }, 30_000);
  afterAll(() => closeTestChrome(browser));

  async function open(body: string, blur: boolean, tier?: Tier): Promise<Page> {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await page.evaluate(acceleratedCanvasTrackerSource());
    await page.setContent(composition(body, blur, tier));
    await page.addScriptTag({ content: `window.__HF_EXPORT_RENDER_SEEK_CONFIG={fps:${FPS}};` });
    await page.addScriptTag({ content: readFileSync(RUNTIME, "utf8") });
    await page.waitForFunction(() => {
      const w = window as Win & { __playerReady?: boolean; __renderReady?: boolean };
      return w.__playerReady === true && w.__renderReady === true;
    });
    return page;
  }

  /** One frame the way the engine takes it: seek, wait for the page, composite, screenshot. */
  async function capture(page: Page, t: number): Promise<Frame> {
    const pending = await page.evaluate((time) => {
      const w = window as Win;
      w.__player?.renderSeek?.(time);
      return w.__hf_page_composite_pending === true;
    }, t);
    await waitForPendingSeekCompletion(page);
    if (pending) {
      await page.evaluate(async () => {
        const w = window as Win;
        await w.__hf_page_composite_prepare?.();
      });
      const cdp = await page.createCDPSession();
      await cdp.send("Page.captureScreenshot", {
        format: "jpeg",
        quality: 1,
        clip: { x: 0, y: 0, width: 1, height: 1, scale: 1 },
      });
      await cdp.detach();
      await page.evaluate(() => (window as Win).__hf_page_composite_resolve?.());
    }
    const png = Buffer.from(await page.screenshot({ type: "png" }));
    const { width, data } = decodePng(png);
    return { width, data };
  }

  async function frameOf(body: string, blur: boolean, t: number, tier?: Tier) {
    const page = await open(body, blur, tier);
    try {
      const frame = await capture(page, t);
      const report = await page.evaluate(() => (window as Win).__hfMotionBlur?.report() ?? null);
      return { frame, report };
    } finally {
      await page.close();
    }
  }

  const FRAME = 2 / FPS;

  it("keeps a rotating or scaling mover where it is, blurred, not at the origin or gone", async (ctx) => {
    if (!supported) ctx.skip();
    const style = `<style>@keyframes spin{to{transform:rotate(360deg)}}@keyframes grow{to{transform:scale(3)}}</style>`;
    const tile = (animation: string) =>
      `<div style="position:absolute;left:120px;top:50px;width:80px;height:80px;background:#131109;box-shadow:0 8px 16px -8px rgba(19,17,9,.4);animation:${animation} 1s linear both"></div>${style}`;
    const inked = (f: Frame): number => {
      let n = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (px(f, x, y)[0] < 128) n++;
      return n;
    };
    for (const animation of ["spin", "grow"]) {
      const blurred = await frameOf(tile(animation), true, 0.3, "capture");
      const sharp = await frameOf(tile(animation), false, 0.3);
      expect(blurred.report).toMatchObject({ state: "on", movers: 1, failedFrames: 0 });
      expect(same(blurred.frame, sharp.frame)).toBe(false);
      expect(inked(blurred.frame)).toBeGreaterThan(inked(sharp.frame) * 0.5);
      expect(px(blurred.frame, 160, 90)[0]).toBeLessThan(60);
      expect(px(blurred.frame, 5, 5)).toEqual([255, 255, 255]);
    }
  });

  const TIERS: Tier[] = ["capture", "filter"];

  it.each(TIERS)("leaves a trail along the motion line, in the %s tier", async (tier, ctx) => {
    if (!supported) ctx.skip();
    const blurred = await frameOf(BOX, true, FRAME, tier);
    const sharp = await frameOf(BOX, false, FRAME);
    expect(blurred.report).toMatchObject({ state: "on", tier, movers: 1 });

    const sharpRow = row(sharp.frame, 40);
    expect(sharpRow.filter((v) => v === 255)).toHaveLength(40);
    expect(intermediate(sharpRow)).toEqual([]);

    const trail = row(blurred.frame, 40);
    const span = intermediate(trail);
    expect(span.length).toBeGreaterThanOrEqual(40);
    const [first = 0] = span;
    const last = span[span.length - 1] ?? 0;
    expect(first).toBeLessThan(140);
    expect(last).toBeGreaterThan(180);
    const rising = trail.slice(first, 150);
    const falling = trail.slice(170, last + 1);
    expect(rising.every((v, i) => i === 0 || v >= (rising[i - 1] ?? 0) - TAP)).toBe(true);
    expect(falling.every((v, i) => i === 0 || v <= (falling[i - 1] ?? 0) + TAP)).toBe(true);
    expect(Math.max(...trail)).toBeGreaterThan(120);
    expect(Math.abs(centroid(trail) - 160)).toBeLessThan(0.5);
    expect(ink(trail) / ink(sharpRow)).toBeGreaterThan(0.97);
    expect(ink(trail) / ink(sharpRow)).toBeLessThan(1.03);
  });

  it.each(TIERS)(
    "leaves what does not move exactly as the sharp frame has it, in the %s tier",
    async (tier, ctx) => {
      if (!supported) ctx.skip();
      const blurred = await frameOf(BOX + STRIPES, true, FRAME, tier);
      const sharp = await frameOf(BOX + STRIPES, false, FRAME);
      expect(blurred.report).toMatchObject({ state: "on" });
      let differing = 0;
      for (let y = 100; y < 140; y++) {
        for (let x = 200; x < 240; x++) {
          if (px(blurred.frame, x, y).join() !== px(sharp.frame, x, y).join()) differing++;
        }
      }
      expect(differing).toBe(0);
      expect(
        new Set(Array.from({ length: 40 }, (_, x) => px(sharp.frame, 200 + x, 110)[0])),
      ).toEqual(new Set([0, 255]));
    },
  );

  it.each(TIERS)(
    "leaves the backdrop under a see-through mover where it is, in the %s tier",
    async (tier, ctx) => {
      if (!supported) ctx.skip();
      const body = `<div style="position:absolute;left:0;top:0;width:${W}px;height:100px;background:repeating-linear-gradient(90deg,#000 0 2px,#fff 2px 4px)"></div>
      <div class="box" style="left:20px;top:30px;background:transparent">
        <div style="position:absolute;left:16px;top:16px;width:8px;height:8px;background:#f00"></div>
      </div>`;
      const blurred = await frameOf(body, true, FRAME, tier);
      const sharp = await frameOf(body, false, FRAME);
      expect(blurred.report).toMatchObject({ state: "on", tier, movers: 1 });
      // Row 34 is inside the mover's box but clear of the dot it carries: its backdrop must not move.
      let moved = 0;
      for (let x = 0; x < W; x++) {
        if (px(blurred.frame, x, 34).join() !== px(sharp.frame, x, 34).join()) moved++;
      }
      expect(moved).toBe(0);
      expect(Math.max(...row(blurred.frame, 50))).toBeGreaterThan(120);
    },
  );

  it.each(TIERS)(
    "carries a glow that paints outside the mover's box along with it, in the %s tier",
    async (tier, ctx) => {
      if (!supported) ctx.skip();
      const body = `<div class="box" style="left:20px;top:80px;box-shadow:0 0 24px 0 #f00"></div>`;
      const blurred = await frameOf(body, true, FRAME, tier);
      const sharp = await frameOf(body, false, FRAME);
      expect(blurred.report).toMatchObject({ state: "on", tier, movers: 1 });
      // 10 px above the box, mid-trail: the glow is there in the sharp frame, so it must be here too.
      const glow = (f: Frame): number => Math.max(...row(f, 70).slice(120, 200));
      expect(glow(sharp.frame)).toBeGreaterThan(40);
      expect(glow(blurred.frame)).toBeGreaterThan(glow(sharp.frame) * 0.5);
    },
  );

  it("keeps a visibility:hidden child of a mover out of the trail", async (ctx) => {
    if (!supported) ctx.skip();
    const body = `<div class="box" style="left:20px;top:80px"><div style="position:absolute;left:10px;top:10px;width:20px;height:20px;background:#0f0;visibility:hidden"></div></div>`;
    const blurred = await frameOf(body, true, FRAME, "capture");
    expect(blurred.report).toMatchObject({ state: "on", tier: "capture", movers: 1 });
    let green = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const [r = 0, g = 0, b = 0] = px(blurred.frame, x, y);
        if (g - r > 30 && g - b > 30) green++;
      }
    }
    expect(green).toBe(0);
  });

  it("blurs with filters where capture cannot run, over a page that has a WebGL canvas", async (ctx) => {
    if (!supported) ctx.skip();
    const gl = `<canvas id="gl" width="64" height="36" style="position:absolute;left:0;top:0;width:${W}px;height:${H}px"></canvas><script>document.getElementById("gl").getContext("webgl")</script>`;
    const blurred = await frameOf(gl + BOX, true, FRAME);
    const sharp = await frameOf(gl + BOX, false, FRAME);
    expect(blurred.report).toMatchObject({
      state: "on",
      tier: "filter",
      reasonCode: "accelerated-canvas",
      movers: 1,
    });
    const trail = row(blurred.frame, 40);
    expect(intermediate(trail).length).toBeGreaterThanOrEqual(40);
    expect(Math.abs(centroid(trail) - centroid(row(sharp.frame, 40)))).toBeLessThan(2);
    expect(ink(trail) / ink(row(sharp.frame, 40))).toBeGreaterThan(0.9);
    expect(ink(trail) / ink(row(sharp.frame, 40))).toBeLessThan(1.1);
  });

  it.each(TIERS)(
    "blurs a box centred with translate around where it really is, in the %s tier",
    async (tier, ctx) => {
      if (!supported) ctx.skip();
      const blurred = await frameOf(CENTERED, true, 1 / FPS, tier);
      const sharp = await frameOf(CENTERED, false, 1 / FPS);
      const trail = row(blurred.frame, 90);
      expect(intermediate(trail).length).toBeGreaterThanOrEqual(40);
      const trueCentre = centroid(row(sharp.frame, 90));
      expect(trueCentre).toBeCloseTo(220, 0);
      expect(Math.abs(centroid(trail) - trueCentre)).toBeLessThan(0.5);
      const column = Array.from({ length: H }, (_, y) => redness(blurred.frame, 220, y));
      expect(Math.abs(centroid(column) - 90)).toBeLessThan(0.5);
    },
  );

  it("blocks a backface-hidden card in a 3D flip and renders the plain frame", async (ctx) => {
    if (!supported) ctx.skip();
    const blurred = await frameOf(FLIP, true, 0.4);
    const sharp = await frameOf(FLIP, false, 0.4);
    expect(blurred.report).toMatchObject({ tier: "filter", reasonCode: "backface-visibility" });
    expect(Buffer.from(blurred.frame.data).equals(Buffer.from(sharp.frame.data))).toBe(true);
  });

  it("blocks a face whose backface-visibility only arrives through animation", async (ctx) => {
    if (!supported) ctx.skip();
    const sharp = await frameOf(BOX + card(""), false, 0.4);
    for (const body of [BOX + card("animation: hide 1s both"), BOX + card("") + WAAPI]) {
      const blurred = await frameOf(body, true, 0.4);
      expect(blurred.report).toMatchObject({ tier: "filter", reasonCode: "backface-visibility" });
      // The 3D card is not a mover for either tier: it is drawn as the sharp frame has it.
      let differing = 0;
      for (let y = 40; y < 140; y++) {
        for (let x = 100; x < 200; x++) {
          if (px(blurred.frame, x, y).join() !== px(sharp.frame, x, y).join()) differing++;
        }
      }
      expect(differing).toBe(0);
    }
  });

  it("renders only the frame plain where an animated face flips between scan samples", async (ctx) => {
    if (!supported) ctx.skip();
    const slow = BOX.replace("top:20px", "top:20px;animation-duration:6s");
    const body = slow + card("animation: blink 1s both");
    for (const [frame, plain] of [
      [14, true],
      [5, false],
    ] as const) {
      const t = frame / FPS;
      const [blurred, sharp] = [
        await frameOf(body, true, t, "capture"),
        await frameOf(body, false, t),
      ];
      expect(blurred.report).toMatchObject({ state: "on" });
      expect(same(blurred.frame, sharp.frame)).toBe(plain);
    }
  });

  it("leaves a flat animated backface-visibility hack blurred", async (ctx) => {
    if (!supported) ctx.skip();
    const { report } = await frameOf(BOX + card("animation: hide 1s both", ""), true, 0.4);
    expect(report).toMatchObject({ state: "on", movers: 1 });
  });
});
