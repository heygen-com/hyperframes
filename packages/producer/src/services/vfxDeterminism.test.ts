import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { displacementMapSampleRef } from "../../../core/src/vfx/refs/displacementMap";
import { fractalNoiseRef } from "../../../core/src/vfx/refs/fractalNoise";
import { waveWarpSampleRef } from "../../../core/src/vfx/refs/waveWarp";

/**
 * Browser-side contract for `data-vfx-chain`, on the real runtime bundle.
 *
 * Rebuild the bundle before running this file, or it tests a stale runtime:
 *
 *     cd packages/core && bun run build:hyperframes-runtime
 *
 * `drawElementImage` lives behind `--enable-features=CanvasDrawElement`, which
 * the engine's own browser launcher already passes
 * (`packages/engine/src/services/browserManager.ts`,
 * `CANVAS_DRAW_ELEMENT_FEATURE_FLAG`).
 */
const RUNTIME_PATH = resolve(import.meta.dirname, "../../../core/dist/hyperframe.runtime.iife.js");

const HOST_W = 160;
const HOST_H = 120;
/** The red block fills the left half of `.hf-vfx-in`. */
const SQUARE_W = 80;

interface CompositeWindow extends Window {
  __hf_page_composite_pending?: boolean;
  __hf_page_composite_resolve?: () => boolean;
  __player?: { renderSeek: (t: number) => void };
  __playerReady?: boolean;
  __renderReady?: boolean;
}

function chainOf(type: string, params: Record<string, number | boolean>): string {
  return JSON.stringify({ version: 1, nodes: [{ type, id: "n1", params }] });
}

function waveWarpChain(params: Record<string, number>): string {
  return chainOf("wave-warp", {
    waveType: 1,
    direction: 0,
    speed: 0,
    pinning: 1,
    phase: 0,
    ...params,
  });
}

/**
 * A `self` host exactly as the exporter emits it: the layer content lives in a
 * `<canvas layoutsubtree>`, the kernel's output in a sibling canvas. The page
 * is blue so a transparent output pixel is distinguishable from a black one.
 *
 * `.hf-vfx-in` carries an explicit pixel box. Inside a `layoutsubtree` canvas
 * there is no containing block to resolve `inset: 0` against, so the wrapper
 * collapses to 0×0 and `drawElementImage` silently draws nothing — the same
 * collapse `engineModePageComposite.clonePinStyleFor` exists to undo.
 */
function fixture(chain: string, innerStyle = "", hostStyle = ""): string {
  return `<!doctype html>
<style>
  html, body { margin: 0; background: #0000ff; }
  #host { position: absolute; left: 0; top: 0; width: ${HOST_W}px; height: ${HOST_H}px; }
  #host > canvas { position: absolute; inset: 0; width: ${HOST_W}px; height: ${HOST_H}px; }
  /* An explicit box, not inset:0 — see the fixture note below. */
  .hf-vfx-in { position: absolute; left: 0; top: 0; width: ${HOST_W}px; height: ${HOST_H}px; }
  #square {
    position: absolute; left: 0; top: 0;
    width: ${SQUARE_W}px; height: ${HOST_H}px; background: #ff0000;
  }
</style>
<div data-composition-id="root" data-start="0" data-duration="4"
     data-width="${HOST_W}" data-height="${HOST_H}">
  <div id="host" class="clip" data-start="0" data-duration="4"
       data-vfx-chain='${chain}' style="${hostStyle}">
    <canvas layoutsubtree class="hf-vfx-src"><div class="hf-vfx-in" style="${innerStyle}"><div id="square"></div></div></canvas>
    <canvas class="hf-vfx-out"></canvas>
  </div>
</div>`;
}

/**
 * The same `self` host, except `.hf-vfx-in` is a SUB-COMPOSITION MOUNT: it
 * carries `data-composition-src`, so the runtime empties it and mounts
 * `inner.html` into it after init. The real exporter emits exactly this shape
 * for any AE layer that is a pre-comp — the mount attributes live on
 * `.hf-vfx-in` rather than the host so `resetCompositionHost` cannot take the
 * `.hf-vfx-src`/`.hf-vfx-out` canvases with it.
 */
function mountFixture(chain: string): string {
  return `<!doctype html>
<style>
  html, body { margin: 0; background: #0000ff; }
  #host { position: absolute; left: 0; top: 0; width: ${HOST_W}px; height: ${HOST_H}px; }
  #host > canvas { position: absolute; inset: 0; width: ${HOST_W}px; height: ${HOST_H}px; }
</style>
<div data-composition-id="root" data-start="0" data-duration="4"
     data-width="${HOST_W}" data-height="${HOST_H}">
  <div id="host" class="clip" data-start="0" data-duration="4" data-vfx-chain='${chain}'>
    <canvas layoutsubtree class="hf-vfx-src" width="${HOST_W}" height="${HOST_H}"><div class="hf-vfx-in" data-composition-id="inner" data-composition-src="inner.html" data-width="${HOST_W}" data-height="${HOST_H}" style="position:absolute;left:0;top:0;width:${HOST_W}px;height:${HOST_H}px;"><div id="pre-mount" style="position:absolute;left:0;top:0;width:${HOST_W}px;height:${HOST_H}px;background:rgb(0,255,0)"></div></div></canvas>
    <canvas class="hf-vfx-out"></canvas>
  </div>
</div>`;
}

/** The mounted sub-composition, in the exporter's `<template>` document shape. */
const MOUNT_INNER = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Inner</title></head>
<body>
<template>
<style>html,body{margin:0;padding:0;background:transparent}#root *{box-sizing:border-box}</style>
<div id="root" data-composition-id="inner" data-width="${HOST_W}" data-height="${HOST_H}" data-duration="4" data-fps="30" style="position:relative;overflow:hidden;width:${HOST_W}px;height:${HOST_H}px;background:transparent">
<div id="inner-square" class="clip" data-start="0" data-duration="4" style="position:absolute;left:0;top:0;width:${SQUARE_W}px;height:${HOST_H}px;background:rgb(255,0,0)"></div>
</div>
<script>
(function () {
  var tl = window.gsap ? gsap.timeline({ paused: true }) : { seek: function () {} };
  window.__timelines["inner"] = tl;
})();
</script>
</template>
</body>
</html>`;

/** A page whose only content is a sub-composition mount. */
const NESTED_HOST_MAIN = `<!doctype html>
<style>html, body { margin: 0; background: #0000ff; }</style>
<div data-composition-id="root" data-start="0" data-duration="4"
     data-width="${HOST_W}" data-height="${HOST_H}">
  <div id="outer" class="clip" data-start="0" data-duration="4" data-composition-id="inner"
       data-composition-src="inner.html" data-width="${HOST_W}" data-height="${HOST_H}"
       style="position:absolute;left:0;top:0;width:${HOST_W}px;height:${HOST_H}px"></div>
</div>`;

/** The whole vfx host lives in the sub-composition, so it enters the DOM on mount. */
const NESTED_HOST_INNER = (chain: string): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"></head><body>
<template>
<style>
  #host { position: absolute; left: 0; top: 0; width: ${HOST_W}px; height: ${HOST_H}px; }
  #host > canvas { position: absolute; inset: 0; width: ${HOST_W}px; height: ${HOST_H}px; }
</style>
<div id="root" data-composition-id="inner" data-width="${HOST_W}" data-height="${HOST_H}" data-duration="4" data-fps="30" style="position:relative;overflow:hidden;width:${HOST_W}px;height:${HOST_H}px">
  <div id="host" class="clip" data-start="0" data-duration="4" data-vfx-chain='${chain}'>
    <canvas layoutsubtree class="hf-vfx-src" width="${HOST_W}" height="${HOST_H}"><div class="hf-vfx-in" style="position:absolute;left:0;top:0;width:${HOST_W}px;height:${HOST_H}px"><div style="position:absolute;left:0;top:0;width:${SQUARE_W}px;height:${HOST_H}px;background:rgb(255,0,0)"></div></div></canvas>
    <canvas class="hf-vfx-out"></canvas>
  </div>
</div>
</template>
</body></html>`;

/** Where the two side-by-side panels sit in the chain-order fixture. */
const PANEL = { ax: 20, bx: 220, y: 30, w: HOST_W, h: HOST_H };

/** Retro-wave's Fractal Noise parameter point, opacity raised to 100 so the readback isn't flattened by alpha. */
const NOISE_PARAMS = {
  fractalType: 1,
  noiseType: 3,
  invert: false,
  contrast: 562,
  brightness: 0,
  scale: 411,
  complexity: 6,
  subInfluence: 70,
  subScaling: 56,
  evolution: 0,
  randomSeed: 0,
  opacity: 100,
};

/**
 * `fractal-noise` has `capture: "none"` — no `.hf-vfx-src`/`.hf-vfx-in`
 * wrapper, so the host is plain content with just the output canvas the
 * runtime paints into inline on `renderSeek` (no page-composite round trip).
 */
function noiseFixture(chain: string): string {
  return `<!doctype html>
<style>
  html, body { margin: 0; background: #000; }
  #host { position: absolute; left: 0; top: 0; width: ${HOST_W}px; height: ${HOST_H}px; }
  #host > canvas { position: absolute; inset: 0; width: ${HOST_W}px; height: ${HOST_H}px; }
</style>
<div data-composition-id="root" data-start="0" data-duration="4"
     data-width="${HOST_W}" data-height="${HOST_H}">
  <div id="host" class="clip" data-start="0" data-duration="4" data-vfx-chain='${chain}'>
    <canvas class="hf-vfx-out"></canvas>
  </div>
</div>`;
}

async function readNoiseBuffer(
  page: Page,
): Promise<{ width: number; height: number; data: number[] }> {
  return page.evaluate(() => {
    const out = document.querySelector("canvas.hf-vfx-out") as HTMLCanvasElement;
    const gl = out.getContext("webgl2")!;
    const buf = new Uint8Array(out.width * out.height * 4);
    gl.readPixels(0, 0, out.width, out.height, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return { width: out.width, height: out.height, data: Array.from(buf) };
  });
}

async function renderSeekOnly(page: Page, t: number): Promise<void> {
  await page.evaluate((time: number) => {
    (window as CompositeWindow).__player!.renderSeek(time);
  }, t);
}

/**
 * Chain order is nesting order. The exporter puts effects that run BEFORE the
 * chain node on `.hf-vfx-in` (inside the capture) and effects that run AFTER it
 * on the host (outside, applied by the page compositor to `.hf-vfx-out`).
 *
 * Panel A is that arrangement with an identity kernel between the two filters;
 * panel B is the same nesting as plain DOM. If the runtime honours the order,
 * the two panels are the same picture. Both sit on the same blue field with the
 * same clearance, so their filters spill into identical neighbourhoods.
 */
function chainOrderFixture(chain: string): string {
  return `<!doctype html>
<style>
  html, body { margin: 0; background: #0000ff; }
  .panel { position: absolute; top: ${PANEL.y}px; width: ${HOST_W}px; height: ${HOST_H}px; }
  #host { left: ${PANEL.ax}px; }
  #control { left: ${PANEL.bx}px; }
  #host > canvas { position: absolute; inset: 0; width: ${HOST_W}px; height: ${HOST_H}px; }
  .inner { position: absolute; left: 0; top: 0; width: ${HOST_W}px; height: ${HOST_H}px; }
  .square {
    position: absolute; left: 0; top: 0;
    width: ${SQUARE_W}px; height: ${HOST_H}px; background: #ff0000;
  }
</style>
<svg width="0" height="0" style="position:absolute">
  <filter id="tint" color-interpolation-filters="sRGB">
    <feColorMatrix type="matrix" values="0 0 0 0 0  1 0 0 0 0  0 0 0 0 0  0 0 0 1 0"/>
  </filter>
</svg>
<div data-composition-id="root" data-start="0" data-duration="4"
     data-width="400" data-height="180">
  <div id="host" class="panel clip" data-start="0" data-duration="4"
       data-vfx-chain='${chain}' style="filter: blur(2px)">
    <canvas layoutsubtree class="hf-vfx-src"><div class="hf-vfx-in inner" style="filter: url(#tint)"><div class="square"></div></div></canvas>
    <canvas class="hf-vfx-out"></canvas>
  </div>
  <div id="control" class="panel" style="filter: blur(2px)">
    <div class="inner" style="filter: url(#tint)"><div class="square"></div></div>
  </div>
</div>`;
}

interface OutSample {
  width: number;
  height: number;
  /** RGBA at a few probe points. */
  left: number[];
  right: number[];
  /** Every `[start, end)` run of red pixels in each requested row. */
  rows: [number, number][][];
  /** Alpha left behind in the capture canvas after the upload. */
  srcAlpha: number[];
}

describe("data-vfx-chain in the browser", () => {
  let browser: Browser;
  let runtime: string;

  beforeAll(async () => {
    runtime = readFileSync(RUNTIME_PATH, "utf8");
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--enable-features=CanvasDrawElement"],
    });
    const probe = await browser.newPage();
    const caps = await probe.evaluate(() => ({
      drawElementImage: typeof (
        document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D & {
          drawElementImage?: unknown;
        }
      )?.drawElementImage,
      webgl2: !!document.createElement("canvas").getContext("webgl2"),
    }));
    await probe.close();
    // A missing capability makes every assertion below meaningless, so fail
    // here — naming the build that was actually launched — rather than on a
    // pixel compare thirty lines down.
    expect({ ...caps, version: await browser.version() }).toMatchObject({
      drawElementImage: "function",
      webgl2: true,
    });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  /**
   * Loud-error collector per page. A chain the runtime refused — the shape a
   * stale `dist/hyperframe.runtime.iife.js` takes, since a kernel it has never
   * heard of is an unknown effect type — otherwise surfaces as an unreadable
   * `expected false to be true` two helpers away.
   */
  const pageErrors = new Map<Page, string[]>();

  function watchPage(page: Page): string[] {
    const errors: string[] = [];
    pageErrors.set(page, errors);
    page.on("console", (message) => {
      const text = message.text();
      if (text.includes("[HyperFrames] composition script error:")) errors.push(text);
    });
    page.on("pageerror", (error) => errors.push(error.message));
    return errors;
  }

  async function bootRuntime(page: Page, errors: string[]): Promise<void> {
    await page.addScriptTag({ content: runtime });
    await page.waitForFunction(
      () =>
        (window as CompositeWindow).__playerReady === true &&
        (window as CompositeWindow).__renderReady === true,
    );
    expect(errors).toEqual([]);
  }

  async function open(html: string, viewport = { width: 320, height: 240 }): Promise<Page> {
    const page = await browser.newPage();
    const errors = watchPage(page);
    await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
    await page.setContent(html);
    await bootRuntime(page, errors);
    return page;
  }

  /**
   * `setContent` leaves the document on `about:blank`, where the loader's
   * `fetch("<data-composition-src>")` cannot resolve — a mounted fixture needs
   * a real origin, so both files are served from the interceptor.
   */
  async function openMounted(files: Record<string, string>): Promise<Page> {
    const page = await browser.newPage();
    const errors = watchPage(page);
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const name = new URL(request.url()).pathname.slice(1);
      const body = files[name];
      if (body === undefined) {
        void request.continue();
        return;
      }
      void request.respond({ status: 200, contentType: "text/html", body });
    });
    await page.setViewport({ width: 320, height: 240, deviceScaleFactor: 1 });
    await page.goto("http://vfx.test/main.html", { waitUntil: "domcontentloaded" });
    await bootRuntime(page, errors);
    return page;
  }

  /**
   * The engine's three-phase protocol, by hand: seek (which arms the pending
   * flag), force a compositor paint with a 1×1 screenshot, then resolve.
   */
  async function seekAndResolve(page: Page, t: number): Promise<boolean> {
    const armed = await page.evaluate((time: number) => {
      (window as CompositeWindow).__player!.renderSeek(time);
      return (window as CompositeWindow).__hf_page_composite_pending === true;
    }, t);
    expect({ armed, errors: pageErrors.get(page) }).toEqual({ armed: true, errors: [] });
    await page.screenshot({ clip: { x: 0, y: 0, width: 1, height: 1 } });
    return page.evaluate(() => (window as CompositeWindow).__hf_page_composite_resolve!());
  }

  async function sample(page: Page, rows: number[]): Promise<OutSample> {
    return page.evaluate((rowList: number[]) => {
      const out = document.querySelector("canvas.hf-vfx-out") as HTMLCanvasElement;
      const gl = out.getContext("webgl2")!;
      const buf = new Uint8Array(out.width * out.height * 4);
      gl.readPixels(0, 0, out.width, out.height, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      const at = (x: number, y: number): number[] => {
        const i = (y * out.width + x) * 4;
        return [buf[i]!, buf[i + 1]!, buf[i + 2]!, buf[i + 3]!];
      };
      // Runs, not a width: a displacement can split the block in two, and a
      // shift that runs one edge off the frame leaves the width unchanged.
      const redRuns = (y: number): [number, number][] => {
        const runs: [number, number][] = [];
        let start = -1;
        for (let x = 0; x <= out.width; x++) {
          const red = x < out.width && buf[(y * out.width + x) * 4]! > 127;
          if (red && start < 0) start = x;
          if (!red && start >= 0) {
            runs.push([start, x]);
            start = -1;
          }
        }
        return runs;
      };
      const src = document.querySelector("canvas.hf-vfx-src") as HTMLCanvasElement;
      const sctx = src.getContext("2d")!;
      return {
        width: out.width,
        height: out.height,
        left: at(40, 60),
        right: at(120, 60),
        rows: rowList.map(redRuns),
        srcAlpha: [
          sctx.getImageData(40, 60, 1, 1).data[3]!,
          sctx.getImageData(120, 60, 1, 1).data[3]!,
        ],
      };
    }, rows);
  }

  it("reproduces the captured layer exactly when the kernel is an identity", async () => {
    const page = await open(fixture(waveWarpChain({ height: 0, width: 93.4 })));
    try {
      expect(await seekAndResolve(page, 0)).toBe(true);
      const s = await sample(page, [10, 60, 90]);

      expect([s.width, s.height]).toEqual([HOST_W, HOST_H]);
      expect(s.left).toEqual([255, 0, 0, 255]);
      expect(s.right).toEqual([0, 0, 0, 0]);
      expect(s.rows).toEqual([[[0, SQUARE_W]], [[0, SQUARE_W]], [[0, SQUARE_W]]]);
    } finally {
      await page.close();
    }
  }, 60_000);

  it("captures a .hf-vfx-in that is a sub-composition mount", async () => {
    const page = await openMounted({
      "main.html": mountFixture(waveWarpChain({ height: 0, width: 93.4 })),
      "inner.html": MOUNT_INNER,
    });
    try {
      // The mount replaces .hf-vfx-in's children, so the exporter's
      // preceding-effect content goes with them — and a silent 404 would leave
      // the wrapper empty, which looks exactly like the defect under test.
      expect(
        await page.evaluate(() => {
          const inner = document.querySelector(".hf-vfx-in")!;
          return {
            mounted: inner.querySelectorAll("#inner-square").length,
            preMountContentKept: !!document.getElementById("pre-mount"),
          };
        }),
      ).toEqual({ mounted: 1, preMountContentKept: false });

      expect(await seekAndResolve(page, 0)).toBe(true);
      const s = await sample(page, [10, 60, 90]);

      expect([s.width, s.height]).toEqual([HOST_W, HOST_H]);
      expect(s.left).toEqual([255, 0, 0, 255]);
      expect(s.rows).toEqual([[[0, SQUARE_W]], [[0, SQUARE_W]], [[0, SQUARE_W]]]);
    } finally {
      await page.close();
    }
  }, 60_000);

  it("registers a vfx host that arrives inside a mounted sub-composition", async () => {
    const page = await openMounted({
      "main.html": NESTED_HOST_MAIN,
      "inner.html": NESTED_HOST_INNER(waveWarpChain({ height: 0, width: 93.4 })),
    });
    try {
      expect(await page.evaluate(() => document.querySelectorAll("[data-vfx-chain]").length)).toBe(
        1,
      );
      expect(await seekAndResolve(page, 0)).toBe(true);
      const s = await sample(page, [10, 60, 90]);
      expect([s.width, s.height]).toEqual([HOST_W, HOST_H]);
      expect(s.left).toEqual([255, 0, 0, 255]);
    } finally {
      await page.close();
    }
  }, 60_000);

  it("clears the capture canvas so the unprocessed layer cannot show through", async () => {
    const page = await open(fixture(waveWarpChain({ height: 0, width: 93.4 })));
    try {
      await seekAndResolve(page, 0);
      const s = await sample(page, []);

      // The layoutsubtree canvas's CHILDREN are not painted by the page
      // compositor, but its bitmap is — and that bitmap is where the capture
      // landed. Every transparent pixel of .hf-vfx-out would otherwise reveal
      // the unwarped original underneath it.
      expect(s.srcAlpha).toEqual([0, 0]);
    } finally {
      await page.close();
    }
  }, 60_000);

  it("shifts each row by the analytic wave displacement", async () => {
    const params = {
      waveType: 1,
      direction: 0,
      speed: 0,
      pinning: 1,
      phase: 0,
      height: 20,
      width: 93.4,
    };
    const page = await open(fixture(waveWarpChain(params)));
    try {
      await seekAndResolve(page, 0);
      const rows = [30, 90];
      const s = await sample(page, rows);

      for (const [i, y] of rows.entries()) {
        // out(x, y) samples the source at x + disp, so the block's edges move
        // by −disp, and anything displaced off the source is transparent.
        const disp = waveWarpSampleRef({ x: 0, y }, 0, params).x;
        expect(Math.abs(disp)).toBeGreaterThan(1);
        expect(s.rows[i]).toHaveLength(1);
        const [first, end] = s.rows[i]![0]!;
        expect(first).toBeCloseTo(Math.max(0, -disp), -0.5);
        expect(end).toBeCloseTo(Math.min(HOST_W, SQUARE_W - disp), -0.5);
      }
    } finally {
      await page.close();
    }
  }, 60_000);

  it("displaces by its own pixels when the map layer is the layer itself", async () => {
    // Use For Horizontal = Red, maxH = 20, maxV = 0. The block is opaque red
    // (red = 1 ⇒ +20 px) and everything right of it is transparent
    // (red = 0 ⇒ −20 px), so the output reads the source from two different
    // directions and the block comes back split:
    //   x < 80  reads x + 20 ⇒ red while x < 60
    //   x ≥ 80  reads x − 20 ⇒ red while x < 100
    const params = { useH: 1, useV: 2, maxH: 20, maxV: 0, behavior: 1, edge: 0, expand: true };
    const page = await open(fixture(chainOf("displacement-map", params)));
    try {
      expect(await seekAndResolve(page, 0)).toBe(true);
      const s = await sample(page, [30, 90]);

      const opaqueRed = { r: 1, g: 0, b: 0, a: 1 };
      const transparent = { r: 0, g: 0, b: 0, a: 0 };
      const shiftInside = displacementMapSampleRef({ x: 0, y: 0 }, 0, params, () => opaqueRed).x;
      const shiftOutside = displacementMapSampleRef({ x: 0, y: 0 }, 0, params, () => transparent).x;
      expect([shiftInside, shiftOutside]).toEqual([20, -20]);

      for (const runs of s.rows) {
        expect(runs).toEqual([
          [0, SQUARE_W - shiftInside],
          [SQUARE_W, SQUARE_W - shiftOutside],
        ]);
      }
    } finally {
      await page.close();
    }
  }, 60_000);

  /**
   * Decode the page's own screenshot back inside the page and compare the two
   * panels. Keeping the compare in the browser avoids a PNG decoder in Node
   * and guarantees both panels went through one compositor pass.
   */
  async function panelPsnr(page: Page): Promise<{ mse: number; psnr: number; aCentre: number[] }> {
    const shot = await page.screenshot({ encoding: "base64" });
    const raw = await page.evaluate(
      async (base64: string, panel: typeof PANEL) => {
        const img = new Image();
        img.src = `data:image/png;base64,${base64}`;
        await img.decode();
        const scratch = document.createElement("canvas");
        scratch.width = img.width;
        scratch.height = img.height;
        const ctx = scratch.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        const a = ctx.getImageData(panel.ax, panel.y, panel.w, panel.h).data;
        const b = ctx.getImageData(panel.bx, panel.y, panel.w, panel.h).data;
        let se = 0;
        let n = 0;
        for (let i = 0; i < a.length; i += 4) {
          for (let c = 0; c < 3; c++) {
            const d = a[i + c]! - b[i + c]!;
            se += d * d;
            n += 1;
          }
        }
        const centre = ((panel.h >> 1) * panel.w + 20) * 4;
        // `Infinity` does not survive the CDP round trip, so the MSE crosses
        // and the decibels are computed on this side.
        return { mse: se / n, aCentre: [a[centre]!, a[centre + 1]!, a[centre + 2]!] };
      },
      shot,
      PANEL,
    );
    return {
      ...raw,
      psnr: raw.mse === 0 ? Number.POSITIVE_INFINITY : 10 * Math.log10((255 * 255) / raw.mse),
    };
  }

  it("captures the filters that precede the node and leaves the ones that follow outside", async () => {
    const page = await open(chainOrderFixture(waveWarpChain({ height: 0, width: 93.4 })), {
      width: PANEL.bx + PANEL.w + PANEL.ax,
      height: PANEL.y + PANEL.h + PANEL.y,
    });
    try {
      expect(await seekAndResolve(page, 0)).toBe(true);
      const { psnr, aCentre } = await panelPsnr(page);

      // The tint runs INSIDE the capture, so the block reaches the kernel green
      // rather than red — proof that drawElementImage paints the subtree's own
      // filter rather than its unfiltered source.
      expect(aCentre[0]).toBeLessThan(64);
      expect(aCentre[1]).toBeGreaterThan(160);
      // ...and the host's blur runs OUTSIDE, on the canvas the kernel wrote.
      expect(psnr).toBeGreaterThanOrEqual(40);
    } finally {
      await page.close();
    }
  }, 60_000);

  it("paints byte-identical fractal-noise output for the same seek time (determinism)", async () => {
    const page = await open(noiseFixture(chainOf("fractal-noise", NOISE_PARAMS)));
    try {
      await renderSeekOnly(page, 1.25);
      const first = await page.evaluate(() =>
        (document.querySelector("canvas.hf-vfx-out") as HTMLCanvasElement).toDataURL(),
      );

      // Seek away, then back to the same time — the paint must not carry any
      // state between calls (the determinism contract's "no state carried
      // between paints" clause).
      await renderSeekOnly(page, 0.5);
      await renderSeekOnly(page, 1.25);
      const second = await page.evaluate(() =>
        (document.querySelector("canvas.hf-vfx-out") as HTMLCanvasElement).toDataURL(),
      );

      expect(second).toBe(first);
      expect(pageErrors.get(page)).toEqual([]);
    } finally {
      await page.close();
    }
  }, 60_000);

  it("matches the CPU reference within the cross-backend PSNR bar for fractal-noise", async () => {
    const page = await open(noiseFixture(chainOf("fractal-noise", NOISE_PARAMS)));
    try {
      const frames = [0, 0.5, 1.25, 2.0];
      // 8 points spread across the 160x120 canvas.
      const samplePoints: [number, number][] = [
        [10, 10],
        [40, 30],
        [80, 60],
        [120, 90],
        [20, 100],
        [150, 5],
        [60, 60],
        [100, 20],
      ];
      let se = 0;
      let n = 0;
      for (const t of frames) {
        await renderSeekOnly(page, t);
        const buf = await readNoiseBuffer(page);
        for (const [x, y] of samplePoints) {
          // Device pixels, y measured from the bottom — readPixels' row order
          // and the shader's v_uv y-up agree, and refs/fractalNoise.ts is
          // documented against exactly that convention.
          const i = (y * buf.width + x) * 4;
          const measured = buf.data[i]!;
          const expected = Math.round(
            fractalNoiseRef({ x: x + 0.5, y: y + 0.5 }, t, NOISE_PARAMS) * 255,
          );
          const d = measured - expected;
          se += d * d;
          n += 1;
        }
      }
      const mse = se / n;
      const psnr = mse === 0 ? Number.POSITIVE_INFINITY : 10 * Math.log10((255 * 255) / mse);
      expect(psnr).toBeGreaterThanOrEqual(32);
      expect(pageErrors.get(page)).toEqual([]);
    } finally {
      await page.close();
    }
  }, 60_000);
});
