import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer";
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

function waveWarpChain(params: Record<string, number>): string {
  return JSON.stringify({
    version: 1,
    nodes: [
      {
        type: "wave-warp",
        id: "n1",
        params: { waveType: 1, direction: 0, speed: 0, pinning: 1, phase: 0, ...params },
      },
    ],
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

interface OutSample {
  width: number;
  height: number;
  /** RGBA at a few probe points. */
  left: number[];
  right: number[];
  /** `[first red x, last red x + 1]` in each requested row, or `null`. */
  rows: ([number, number] | null)[];
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

  async function open(html: string): Promise<Page> {
    const page = await browser.newPage();
    await page.setViewport({ width: 320, height: 240, deviceScaleFactor: 1 });
    await page.setContent(html);
    await page.addScriptTag({ content: runtime });
    await page.waitForFunction(
      () =>
        (window as CompositeWindow).__playerReady === true &&
        (window as CompositeWindow).__renderReady === true,
    );
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
    expect(armed).toBe(true);
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
      // The block's two edges, not its width: a wave shifts both, but a shift
      // that runs a red column off the frame would leave the width unchanged.
      const redSpan = (y: number): [number, number] | null => {
        let first = -1;
        let last = -1;
        for (let x = 0; x < out.width; x++) {
          if (buf[(y * out.width + x) * 4]! <= 127) continue;
          if (first < 0) first = x;
          last = x;
        }
        return first < 0 ? null : [first, last + 1];
      };
      const src = document.querySelector("canvas.hf-vfx-src") as HTMLCanvasElement;
      const sctx = src.getContext("2d")!;
      return {
        width: out.width,
        height: out.height,
        left: at(40, 60),
        right: at(120, 60),
        rows: rowList.map(redSpan),
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
      expect(s.rows).toEqual([
        [0, SQUARE_W],
        [0, SQUARE_W],
        [0, SQUARE_W],
      ]);
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
        const [first, end] = s.rows[i]!;
        expect(first).toBeCloseTo(Math.max(0, -disp), -0.5);
        expect(end).toBeCloseTo(Math.min(HOST_W, SQUARE_W - disp), -0.5);
      }
    } finally {
      await page.close();
    }
  }, 60_000);
});
