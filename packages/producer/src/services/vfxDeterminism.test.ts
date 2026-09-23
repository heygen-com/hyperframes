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
/** Clearance between the two hosts of `twoHostFixture`. */
const GAP = 20;
/** Opaque red — what a correctly painted identity chain puts at the probe point. */
const red = [255, 0, 0, 255];

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
 * TWO `self` hosts, so a per-host sequential wait costs twice as many frames
 * as a single-host one. One host can be painted by luck; two cannot.
 */
function twoHostFixture(chain: string): string {
  const host = (side: string): string => `
  <div id="host-${side}" class="vfx-host clip" data-start="0" data-duration="4"
       data-vfx-chain='${chain}'>
    <canvas layoutsubtree class="hf-vfx-src"><div class="hf-vfx-in"><div class="square"></div></div></canvas>
    <canvas class="hf-vfx-out"></canvas>
  </div>`;
  return `<!doctype html>
<style>
  html, body { margin: 0; background: #0000ff; }
  .vfx-host { position: absolute; top: 0; width: ${HOST_W}px; height: ${HOST_H}px; }
  #host-a { left: 0; }
  #host-b { left: ${HOST_W + GAP}px; }
  .vfx-host > canvas { position: absolute; inset: 0; width: ${HOST_W}px; height: ${HOST_H}px; }
  .hf-vfx-in { position: absolute; left: 0; top: 0; width: ${HOST_W}px; height: ${HOST_H}px; }
  .square {
    position: absolute; left: 0; top: 0;
    width: ${SQUARE_W}px; height: ${HOST_H}px; background: #ff0000;
  }
</style>
<div data-composition-id="root" data-start="0" data-duration="4"
     data-width="${HOST_W * 2 + GAP}" data-height="${HOST_H}">${host("a")}${host("b")}
</div>`;
}

/**
 * What `seekCompositionTimeline` does, by hand: dispatch the seek, drain the
 * seek-completion barrier, then ONE settle race — `setTimeout(100)` against a
 * double rAF, copied from the CLI's default `animationFrameSettle: "race"`
 * (`packages/cli/src/capture/captureCompositionFrame.ts`). Whatever has not
 * painted by the time this returns is what `hyperframes snapshot` screenshots
 * as blank.
 */
async function seekAndDrainBarrier(page: Page, t: number): Promise<void> {
  await page.evaluate((time: number) => {
    (window as CompositeWindow).__player!.renderSeek(time);
  }, t);
  // Asserted, not optional-chained: a bundle that never exposed the barrier
  // would make the whole case a no-op that passes.
  const drained = await page.evaluate(async () => {
    const wait = Reflect.get(window, "__hfWaitForSeekCompletion");
    if (typeof wait !== "function") return false;
    await Reflect.apply(wait, window, []);
    return true;
  });
  expect(drained).toBe(true);
}

/**
 * The CLI's default `animationFrameSettle: "race"`, copied verbatim from
 * `packages/cli/src/capture/captureCompositionFrame.ts`: a 100 ms timeout
 * against a double rAF, whichever lands first. This is all the slack a real
 * snapshot leaves between the barrier and the screenshot.
 */
async function settleRace(page: Page): Promise<void> {
  await page.evaluate(`new Promise(function(r) {
      var settled = false;
      function finish() { if (settled) return; settled = true; r(); }
      window.setTimeout(finish, 100);
      requestAnimationFrame(function() { requestAnimationFrame(finish); });
    })`);
}

/** RGBA at one interior point of every `.hf-vfx-out` on the page. */
async function sampleEveryOut(page: Page): Promise<number[][]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("canvas.hf-vfx-out")].map((node) => {
      const gl = (node as HTMLCanvasElement).getContext("webgl2");
      if (!gl) return [];
      const px = new Uint8Array(4);
      gl.readPixels(40, 60, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return [...px];
    }),
  );
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

/**
 * `backdrop` capture: two stacked (not side-by-side) colored blocks live in a
 * `<canvas layoutsubtree class="hf-vfx-src" data-vfx-for="host">` SIBLING of
 * the host, per interface v1.1 and `resolveCaptureSource`/`findBackdropWrapper`
 * in `packages/core/src/runtime/vfx.ts`. `#control` renders the same two
 * blocks as plain DOM at `PANEL.bx` so `panelPsnr` can compare the two.
 */
function backdropStackedFixture(chain: string): string {
  const blocks = `
    <div style="position:absolute;left:0;top:0;width:${PANEL.w}px;height:${PANEL.h / 2}px;background:#ff0000"></div>
    <div style="position:absolute;left:0;top:${PANEL.h / 2}px;width:${PANEL.w}px;height:${PANEL.h / 2}px;background:#00ff00"></div>`;
  return `<!doctype html>
<style>
  html, body { margin: 0; background: #0000ff; }
  .panel { position: absolute; top: ${PANEL.y}px; width: ${PANEL.w}px; height: ${PANEL.h}px; }
  #host { left: ${PANEL.ax}px; }
  #host > canvas { position: absolute; inset: 0; width: ${PANEL.w}px; height: ${PANEL.h}px; }
  #wrap { position: absolute; left: ${PANEL.ax}px; top: ${PANEL.y}px; width: ${PANEL.w}px; height: ${PANEL.h}px; }
  .hf-vfx-in { position: absolute; left: 0; top: 0; width: ${PANEL.w}px; height: ${PANEL.h}px; }
  #control { left: ${PANEL.bx}px; }
</style>
<div data-composition-id="root" data-start="0" data-duration="4"
     data-width="${PANEL.bx + PANEL.w + PANEL.ax}" data-height="${PANEL.y + PANEL.h + PANEL.y}">
  <canvas id="wrap" layoutsubtree class="hf-vfx-src" data-vfx-for="host"><div class="hf-vfx-in">${blocks}</div></canvas>
  <div id="host" class="panel clip" data-start="0" data-duration="4" data-vfx-chain='${chain}'>
    <canvas class="hf-vfx-out"></canvas>
  </div>
  <div id="control" class="panel">${blocks}</div>
</div>`;
}

/**
 * The same two stacked blocks, but the host reading them through `backdrop`
 * is OUTSIDE its own `data-start`/`data-duration` window at the seek time
 * under test — the real way a host goes invisible (the clip runtime owns
 * `visibility` for `.clip` elements and forces it back to `visible` inside
 * the window, which is what made a plain CSS `visibility:hidden` override on
 * an in-window host a no-op when this fixture was first written).
 * `capturePassThrough` keeps the captured bitmap ON the wrapper canvas itself
 * rather than clearing it, because the wrapper's children never paint on
 * their own — it is the only thing left that can still show the layers below
 * a switched-off adjustment layer.
 */
function hiddenBackdropFixture(chain: string): string {
  return `<!doctype html>
<style>
  html, body { margin: 0; background: #0000ff; }
  #wrap { position: absolute; left: 20px; top: 30px; width: ${HOST_W}px; height: ${HOST_H}px; }
  .hf-vfx-in { position: absolute; left: 0; top: 0; width: ${HOST_W}px; height: ${HOST_H}px; }
  #host { position: absolute; left: 20px; top: 30px; width: ${HOST_W}px; height: ${HOST_H}px; }
  #host > canvas { position: absolute; inset: 0; width: ${HOST_W}px; height: ${HOST_H}px; }
</style>
<div data-composition-id="root" data-start="0" data-duration="20" data-width="240" data-height="180">
  <canvas id="wrap" layoutsubtree class="hf-vfx-src" data-vfx-for="host">
    <div class="hf-vfx-in">
      <div style="position:absolute;left:0;top:0;width:${HOST_W}px;height:${HOST_H / 2}px;background:#ff0000"></div>
      <div style="position:absolute;left:0;top:${HOST_H / 2}px;width:${HOST_W}px;height:${HOST_H / 2}px;background:#00ff00"></div>
    </div>
  </canvas>
  <div id="host" class="clip" data-start="10" data-duration="4" data-vfx-chain='${chain}'>
    <canvas class="hf-vfx-out"></canvas>
  </div>
</div>`;
}

/**
 * `luma-matte`: the host's own content is an opaque white square (so the
 * kernel's output is coverage alone), and a `matte` `ref` param names a
 * second element — `#matte` — wrapped in its own `.hf-vfx-src` capture, per
 * `resolveRefSource`. Four vertical strips give four coverage samples.
 */
function lumaMatteFixture(chain: string, matteStrips: string): string {
  return `<!doctype html>
<style>
  html, body { margin: 0; background: #000; }
  #host { position: absolute; left: 0; top: 0; width: ${HOST_W}px; height: ${HOST_H}px; }
  #host > canvas { position: absolute; inset: 0; width: ${HOST_W}px; height: ${HOST_H}px; }
  #matte { position: absolute; left: 0; top: 200px; width: ${HOST_W}px; height: ${HOST_H}px; }
  .hf-vfx-in { position: absolute; left: 0; top: 0; width: ${HOST_W}px; height: ${HOST_H}px; }
</style>
<div data-composition-id="root" data-start="0" data-duration="4" data-width="${HOST_W}" data-height="320">
  <div id="host" class="clip" data-start="0" data-duration="4" data-vfx-chain='${chain}'>
    <canvas layoutsubtree class="hf-vfx-src"><div class="hf-vfx-in"><div style="position:absolute;left:0;top:0;width:${HOST_W}px;height:${HOST_H}px;background:#ffffff"></div></div></canvas>
    <canvas class="hf-vfx-out"></canvas>
  </div>
  <div id="matte">
    <canvas layoutsubtree class="hf-vfx-src"><div class="hf-vfx-in">${matteStrips}</div></canvas>
  </div>
</div>`;
}

/**
 * `displacement-map` with an EXTERNAL map: the host holds the same red block
 * as `fixture`, and `#map` — a second element with its own `.hf-vfx-src`
 * capture — supplies `u_src2`. The map is a solid opaque BLACK panel, not a
 * gradient: a CSS gradient's interpolation is implementation-defined, while a
 * flat panel gives an exact texel and therefore an exact displacement.
 */
function displacementRefFixture(chain: string, mapVisible = false, mapW = HOST_W): string {
  const visible = mapVisible ? " data-vfx-ref-visible" : "";
  return `<!doctype html>
<style>
  html, body { margin: 0; background: #0000ff; }
  #host { position: absolute; left: 0; top: 0; width: ${HOST_W}px; height: ${HOST_H}px; }
  #host > canvas { position: absolute; inset: 0; width: ${HOST_W}px; height: ${HOST_H}px; }
  #host .hf-vfx-in { position: absolute; left: 0; top: 0; width: ${HOST_W}px; height: ${HOST_H}px; }
  #map { position: absolute; left: 0; top: 200px; width: ${mapW}px; height: ${HOST_H}px; }
  #map > canvas { width: ${mapW}px; height: ${HOST_H}px; }
  #map .hf-vfx-in { position: absolute; left: 0; top: 0; width: ${mapW}px; height: ${HOST_H}px; }
</style>
<div data-composition-id="root" data-start="0" data-duration="4" data-width="${HOST_W}" data-height="320">
  <div id="host" class="clip" data-start="0" data-duration="4" data-vfx-chain='${chain}'>
    <canvas layoutsubtree class="hf-vfx-src"><div class="hf-vfx-in"><div style="position:absolute;left:0;top:0;width:${SQUARE_W}px;height:${HOST_H}px;background:#ff0000"></div></div></canvas>
    <canvas class="hf-vfx-out"></canvas>
  </div>
  <div id="map">
    <canvas layoutsubtree class="hf-vfx-src"${visible}><div class="hf-vfx-in"><div style="position:absolute;left:0;top:0;width:${mapW}px;height:${HOST_H}px;background:#000000"></div></div></canvas>
  </div>
</div>`;
}

/**
 * `luma-matte` with a VISIBLE matte whose box is twice the host's. Two claims
 * at once: the wrapper's bitmap survives the capture (the layer still paints),
 * and the kernel still reads it scaled into the host's box.
 */
function visibleMatteFixture(chain: string, matteW: number): string {
  const strips = [0, 85 / 255, 170 / 255, 1]
    .map(
      (a, i) =>
        `<div style="position:absolute;left:${(i * matteW) / 4}px;top:0;width:${matteW / 4}px;height:${HOST_H}px;background:rgba(0,0,0,${a})"></div>`,
    )
    .join("");
  return `<!doctype html>
<style>
  html, body { margin: 0; background: #000; }
  #host { position: absolute; left: 0; top: 0; width: ${HOST_W}px; height: ${HOST_H}px; }
  #host > canvas { position: absolute; inset: 0; width: ${HOST_W}px; height: ${HOST_H}px; }
  #host .hf-vfx-in { position: absolute; left: 0; top: 0; width: ${HOST_W}px; height: ${HOST_H}px; }
  #matte { position: absolute; left: 0; top: 200px; width: ${matteW}px; height: ${HOST_H}px; }
  #matte > canvas { width: ${matteW}px; height: ${HOST_H}px; }
  #matte .hf-vfx-in { position: absolute; left: 0; top: 0; width: ${matteW}px; height: ${HOST_H}px; }
</style>
<div data-composition-id="root" data-start="0" data-duration="4" data-width="${matteW}" data-height="320">
  <div id="host" class="clip" data-start="0" data-duration="4" data-vfx-chain='${chain}'>
    <canvas layoutsubtree class="hf-vfx-src"><div class="hf-vfx-in"><div style="position:absolute;left:0;top:0;width:${HOST_W}px;height:${HOST_H}px;background:#ffffff"></div></div></canvas>
    <canvas class="hf-vfx-out"></canvas>
  </div>
  <div id="matte">
    <canvas layoutsubtree class="hf-vfx-src" data-vfx-ref-visible><div class="hf-vfx-in">${strips}</div></canvas>
  </div>
</div>`;
}

/** Four strips of constant luma (black) with alpha 0, 1/3, 2/3, 1 — isolates the Alpha/Alpha Inverted modes from Luma. */
function alphaMatteStrips(): string {
  return [0, 85 / 255, 170 / 255, 1]
    .map(
      (a, i) =>
        `<div style="position:absolute;left:${i * 40}px;top:0;width:40px;height:${HOST_H}px;background:rgba(0,0,0,${a})"></div>`,
    )
    .join("");
}

/** Four strips of constant alpha (opaque) with luma 0, 1/3, 2/3, 1 — isolates the Luma/Luma Inverted modes from Alpha. */
function lumaMatteStrips(): string {
  return [0, 85, 170, 255]
    .map(
      (g, i) =>
        `<div style="position:absolute;left:${i * 40}px;top:0;width:40px;height:${HOST_H}px;background:rgb(${g},${g},${g})"></div>`,
    )
    .join("");
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

  /**
   * `hyperframes snapshot` (and `check`/`compare`/`validate`/`layout`, and
   * Studio's thumbnail capture) seek through the same `renderSeek` the engine
   * does, but never read
   * `__hf_page_composite_pending` and never call `__hf_page_composite_resolve`
   * — so arming the protocol alone left every `self` chain unpainted and
   * silent there. No `page.screenshot` in this case ON PURPOSE: a screenshot
   * is the engine's phase-2 paint force, and taking one would test the engine
   * protocol again by the back door instead of the runtime's own fallback.
   */
  it("paints a self-capture host when nobody ever resolves the composite", async () => {
    const page = await open(fixture(waveWarpChain({ height: 0, width: 93.4 })));
    try {
      const armed = await page.evaluate(() => {
        (window as CompositeWindow).__player!.renderSeek(0);
        return (window as CompositeWindow).__hf_page_composite_pending === true;
      });
      expect({ armed, errors: pageErrors.get(page) }).toEqual({ armed: true, errors: [] });

      await page.waitForFunction(
        () => {
          const out = document.querySelector("canvas.hf-vfx-out") as HTMLCanvasElement;
          const gl = out.getContext("webgl2");
          if (!gl) return false;
          const px = new Uint8Array(4);
          gl.readPixels(40, 60, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          return px[3] === 255;
        },
        { timeout: 5_000 },
      );

      const s = await sample(page, [10, 60, 90]);
      expect([s.width, s.height]).toEqual([HOST_W, HOST_H]);
      expect(s.left).toEqual([255, 0, 0, 255]);
      expect(s.right).toEqual([0, 0, 0, 0]);
      expect(s.rows).toEqual([[[0, SQUARE_W]], [[0, SQUARE_W]], [[0, SQUARE_W]]]);
      // The engine contract is untouched: the flag stays armed, so a host that
      // DOES run the three-phase protocol still gets its authoritative capture.
      expect(
        await page.evaluate(() => (window as CompositeWindow).__hf_page_composite_pending),
      ).toBe(true);
      expect(pageErrors.get(page)).toEqual([]);
    } finally {
      await page.close();
    }
  }, 60_000);

  /**
   * The same snapshot-family path, but joined rather than raced. Every
   * `hyperframes` seek caller (`snapshot`/`check`/`compare`/`validate`/
   * `layout`) drains `__hfWaitForSeekCompletion` and then allows exactly one
   * settle race before screenshotting. The preview-side capture used to be
   * fire-and-forget AND sequential per host, so N hosts cost up to 2N frames
   * while the settle bought about two — the screenshot landed on hosts that
   * had not painted yet, and which ones varied run to run.
   *
   * Two hosts, so one host finishing in time cannot hide the defect. No
   * `page.screenshot` before the read: that is the engine's phase-2 paint
   * force, and taking one would test the engine protocol by the back door.
   */
  it("has every self-capture host painted the moment the CLI's seek barrier returns", async () => {
    const page = await open(twoHostFixture(waveWarpChain({ height: 0, width: 93.4 })), {
      width: HOST_W * 2 + GAP,
      height: HOST_H + GAP,
    });
    try {
      expect(await page.evaluate(() => document.querySelectorAll("[data-vfx-chain]").length)).toBe(
        2,
      );

      await seekAndDrainBarrier(page, 0);

      // Read immediately — no waitForFunction, no extra rAF. Measured on the
      // pre-fix bundle this is `[[0,0,0,0],[0,0,0,0]]`: the barrier returned
      // with neither host painted, and only the settle race that follows
      // happened to cover them. That slack is not a guarantee — it is two
      // frames against a cost that grows with host count — so the contract is
      // pinned here, where the barrier's promise is the only thing holding.
      const atBarrier = await sampleEveryOut(page);
      await settleRace(page);
      const atScreenshot = await sampleEveryOut(page);

      expect({ atBarrier, atScreenshot, errors: pageErrors.get(page) }).toEqual({
        atBarrier: [red, red],
        atScreenshot: [red, red],
        errors: [],
      });
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

  /**
   * RGBA at arbitrary points of `canvas.hf-vfx-out`, via `readPixels`. Safe
   * for content that varies only along x (a vertical readback flip cannot
   * change what column a pixel is in) — `screenshotPixels` below is used
   * instead wherever a fixture varies along y.
   */
  async function sampleOutPoints(page: Page, points: [number, number][]): Promise<number[][]> {
    return page.evaluate((pts: [number, number][]) => {
      const out = document.querySelector("canvas.hf-vfx-out") as HTMLCanvasElement;
      const gl = out.getContext("webgl2")!;
      const buf = new Uint8Array(out.width * out.height * 4);
      gl.readPixels(0, 0, out.width, out.height, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      return pts.map(([x, y]) => {
        const i = (y * out.width + x) * 4;
        return [buf[i]!, buf[i + 1]!, buf[i + 2]!, buf[i + 3]!];
      });
    }, points);
  }

  /**
   * RGBA at arbitrary points of the page's own screenshot, decoded back
   * inside the page (same technique as `panelPsnr`). Used wherever a fixture
   * varies along y, so the WebGL readback's vertical flip cannot bite —
   * the browser's own compositor produced this pixel, top-down, the way the
   * page actually looks.
   */
  async function screenshotPixels(page: Page, points: [number, number][]): Promise<number[][]> {
    const shot = await page.screenshot({ encoding: "base64" });
    return page.evaluate(
      async (base64: string, pts: [number, number][]) => {
        const img = new Image();
        img.src = `data:image/png;base64,${base64}`;
        await img.decode();
        const scratch = document.createElement("canvas");
        scratch.width = img.width;
        scratch.height = img.height;
        const ctx = scratch.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        return pts.map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data));
      },
      shot,
      points,
    );
  }

  describe("backdrop capture (Task 2.6)", () => {
    it("composites an identity backdrop kernel back over the two stacked blocks below it", async () => {
      const chain = chainOf("noise", { amount: 0 });
      const page = await open(backdropStackedFixture(chain), {
        width: PANEL.bx + PANEL.w + PANEL.ax,
        height: PANEL.y + PANEL.h + PANEL.y,
      });
      try {
        expect(await seekAndResolve(page, 0)).toBe(true);
        const [top, bottom] = await screenshotPixels(page, [
          [PANEL.ax + 80, PANEL.y + 30],
          [PANEL.ax + 80, PANEL.y + 90],
        ]);
        expect(top!.slice(0, 3)).toEqual([255, 0, 0]);
        expect(bottom!.slice(0, 3)).toEqual([0, 255, 0]);

        const { psnr } = await panelPsnr(page);
        expect(psnr).toBeGreaterThanOrEqual(40);
        expect(pageErrors.get(page)).toEqual([]);
      } finally {
        await page.close();
      }
    }, 60_000);

    it("keeps a hidden backdrop host's captured layers on the wrapper canvas's own bitmap", async () => {
      const page = await open(hiddenBackdropFixture(chainOf("noise", { amount: 0 })), {
        width: 240,
        height: 180,
      });
      try {
        expect(await seekAndResolve(page, 0)).toBe(true);
        const pixels = await page.evaluate(() => {
          const wrap = document.querySelector("canvas.hf-vfx-src") as HTMLCanvasElement;
          const ctx = wrap.getContext("2d")!;
          return {
            top: Array.from(ctx.getImageData(40, 10, 1, 1).data),
            bottom: Array.from(ctx.getImageData(40, 90, 1, 1).data),
          };
        });
        expect(pixels.top).toEqual([255, 0, 0, 255]);
        expect(pixels.bottom).toEqual([0, 255, 0, 255]);
        expect(pageErrors.get(page)).toEqual([]);
      } finally {
        await page.close();
      }
    }, 60_000);
  });

  describe("luma-matte (Task 2.7)", () => {
    const points: [number, number][] = [
      [20, 60],
      [60, 60],
      [100, 60],
      [140, 60],
    ];
    const ALPHA_TOLERANCE = 4;

    it.each([
      [1, [0, 85, 170, 255]],
      [2, [255, 170, 85, 0]],
    ] as const)(
      "mode %i (Alpha/Alpha Inverted) follows the matte's alpha",
      async (mode, expected) => {
        const chain = chainOf("luma-matte", { matte: "matte", mode });
        const page = await open(lumaMatteFixture(chain, alphaMatteStrips()), {
          width: HOST_W,
          height: 320,
        });
        try {
          expect(await seekAndResolve(page, 0)).toBe(true);
          const samples = await sampleOutPoints(page, points);
          samples.forEach((px, i) => {
            expect(Math.abs(px[3]! - expected[i]!)).toBeLessThanOrEqual(ALPHA_TOLERANCE);
          });
          expect(pageErrors.get(page)).toEqual([]);
        } finally {
          await page.close();
        }
      },
      60_000,
    );

    it.each([
      [3, [0, 85, 170, 255]],
      [4, [255, 170, 85, 0]],
    ] as const)(
      "mode %i (Luma/Luma Inverted) follows the matte's luma",
      async (mode, expected) => {
        const chain = chainOf("luma-matte", { matte: "matte", mode });
        const page = await open(lumaMatteFixture(chain, lumaMatteStrips()), {
          width: HOST_W,
          height: 320,
        });
        try {
          expect(await seekAndResolve(page, 0)).toBe(true);
          const samples = await sampleOutPoints(page, points);
          samples.forEach((px, i) => {
            expect(Math.abs(px[3]! - expected[i]!)).toBeLessThanOrEqual(ALPHA_TOLERANCE);
          });
          expect(pageErrors.get(page)).toEqual([]);
        } finally {
          await page.close();
        }
      },
      60_000,
    );
  });

  describe("noise (Task 2.7)", () => {
    it("leaves the source untouched when amount is 0", async () => {
      const page = await open(fixture(chainOf("noise", { amount: 0 })));
      try {
        expect(await seekAndResolve(page, 0)).toBe(true);
        const s = await sample(page, [10, 60, 90]);
        expect([s.width, s.height]).toEqual([HOST_W, HOST_H]);
        expect(s.left).toEqual([255, 0, 0, 255]);
        expect(s.right).toEqual([0, 0, 0, 0]);
        expect(pageErrors.get(page)).toEqual([]);
      } finally {
        await page.close();
      }
    }, 60_000);

    it("paints byte-identical output for the same seek time (determinism)", async () => {
      const page = await open(fixture(chainOf("noise", { amount: 50 })));
      try {
        expect(await seekAndResolve(page, 1.25)).toBe(true);
        const first = await page.evaluate(() =>
          (document.querySelector("canvas.hf-vfx-out") as HTMLCanvasElement).toDataURL(),
        );

        // Seek away, then back to the same time — no state may carry between paints.
        expect(await seekAndResolve(page, 0.5)).toBe(true);
        expect(await seekAndResolve(page, 1.25)).toBe(true);
        const second = await page.evaluate(() =>
          (document.querySelector("canvas.hf-vfx-out") as HTMLCanvasElement).toDataURL(),
        );

        expect(second).toBe(first);
        expect(pageErrors.get(page)).toEqual([]);
      } finally {
        await page.close();
      }
    }, 60_000);

    it("changes the pattern when the seek time — its only seed — changes", async () => {
      const page = await open(fixture(chainOf("noise", { amount: 50 })));
      try {
        expect(await seekAndResolve(page, 1.25)).toBe(true);
        const a = await page.evaluate(() =>
          (document.querySelector("canvas.hf-vfx-out") as HTMLCanvasElement).toDataURL(),
        );
        expect(await seekAndResolve(page, 2.0)).toBe(true);
        const b = await page.evaluate(() =>
          (document.querySelector("canvas.hf-vfx-out") as HTMLCanvasElement).toDataURL(),
        );
        expect(b).not.toBe(a);
        expect(pageErrors.get(page)).toEqual([]);
      } finally {
        await page.close();
      }
    }, 60_000);
  });

  /**
   * The `map` ref (plan Backlog, "one-line def change after Task 2.6"). The
   * discriminator is that a SELF map gives a visibly different picture: a
   * black external map displaces every pixel by the same −maxH, translating
   * the block right as one run, while the layer's own pixels displace the red
   * half one way and the transparent half the other, splitting it in two.
   */
  describe("displacement-map with an external map (Task 2.6 backlog)", () => {
    const MAX_H = 20;
    const mapParams = { useH: 1, maxH: MAX_H, useV: 11, maxV: 0, behavior: 1, edge: 0 };
    const BLACK = { r: 0, g: 0, b: 0, a: 1 };

    it("reads a named map element as u_src2", async () => {
      const chain = chainOf("displacement-map", { ...mapParams, map: "map" });
      const page = await open(displacementRefFixture(chain), { width: HOST_W, height: 320 });
      try {
        expect(await seekAndResolve(page, 0)).toBe(true);
        // Through the CPU reference, with the constant sampler the fixture
        // paints: an opaque black map reads 0 on Red, so d = (0 − 0.5)·2·maxH.
        const probe = { x: 40, y: 60 };
        const shift = probe.x - displacementMapSampleRef(probe, 0, mapParams, () => BLACK).x;
        expect(shift).toBe(MAX_H);

        const s = await sample(page, [60]);
        expect(s.rows).toEqual([[[shift, SQUARE_W + shift]]]);
        expect(pageErrors.get(page)).toEqual([]);
      } finally {
        await page.close();
      }
    }, 60_000);

    it("displaces by the layer's own pixels when no map is named", async () => {
      const chain = chainOf("displacement-map", mapParams);
      const page = await open(displacementRefFixture(chain), { width: HOST_W, height: 320 });
      try {
        expect(await seekAndResolve(page, 0)).toBe(true);
        const s = await sample(page, [60]);
        // Two runs, not one: the self-referential form is a different picture,
        // which is what makes the case above a real check of the binding.
        expect(s.rows[0]!.length).toBe(2);
        expect(pageErrors.get(page)).toEqual([]);
      } finally {
        await page.close();
      }
    }, 60_000);
  });

  /**
   * A ref source that also paints (retro-wave `Logo Anim` layer 5 is layer 4's
   * displacement map AND an enabled, opaque layer). Both halves of the rule in
   * one page: the wrapper keeps its bitmap, and the kernel still reads it
   * scaled into the host's box even though the two boxes differ.
   */
  describe("a visible ref source (data-vfx-ref-visible)", () => {
    const MATTE_W = HOST_W * 2;

    it("keeps the matte on screen and still mattes the host with it", async () => {
      const chain = chainOf("luma-matte", { matte: "matte", mode: 1 });
      const page = await open(visibleMatteFixture(chain, MATTE_W), {
        width: MATTE_W,
        height: 320,
      });
      try {
        expect(await seekAndResolve(page, 0)).toBe(true);

        // 1. The wrapper's own bitmap still holds the strips — an invisible
        //    ref would have been cleared to nothing after its upload.
        const bitmap = await page.evaluate((w: number) => {
          const canvas = document.querySelector("#matte canvas.hf-vfx-src") as HTMLCanvasElement;
          const ctx = canvas.getContext("2d")!;
          const at = (x: number): number => ctx.getImageData(x, 60, 1, 1).data[3]!;
          return { width: canvas.width, alphas: [at(w / 8), at((w * 7) / 8)] };
        }, MATTE_W);
        expect(bitmap.width).toBe(MATTE_W);
        expect(bitmap.alphas[0]).toBe(0);
        expect(bitmap.alphas[1]).toBe(255);

        // 2. And the kernel read it across the host's box, not 1:1 — the four
        //    strips of a 320px matte land as four 40px bands in a 160px host.
        const samples = await sampleOutPoints(page, [
          [20, 60],
          [60, 60],
          [100, 60],
          [140, 60],
        ]);
        [0, 85, 170, 255].forEach((expected, i) => {
          expect(Math.abs(samples[i]![3]! - expected)).toBeLessThanOrEqual(4);
        });
        expect(pageErrors.get(page)).toEqual([]);
      } finally {
        await page.close();
      }
    }, 60_000);

    it("clears an ordinary ref's bitmap, so an invisible matte stays invisible", async () => {
      const chain = chainOf("luma-matte", { matte: "matte", mode: 1 });
      const page = await open(lumaMatteFixture(chain, alphaMatteStrips()), {
        width: HOST_W,
        height: 320,
      });
      try {
        expect(await seekAndResolve(page, 0)).toBe(true);
        const alphas = await page.evaluate(() => {
          const canvas = document.querySelector("#matte canvas.hf-vfx-src") as HTMLCanvasElement;
          const ctx = canvas.getContext("2d")!;
          return [40, 140].map((x) => ctx.getImageData(x, 60, 1, 1).data[3]!);
        });
        expect(alphas).toEqual([0, 0]);
        expect(pageErrors.get(page)).toEqual([]);
      } finally {
        await page.close();
      }
    }, 60_000);
  });
});
