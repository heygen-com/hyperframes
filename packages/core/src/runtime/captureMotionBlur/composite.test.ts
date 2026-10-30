import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCompositor, type MoverFrame } from "./composite";
import { IDENTITY, translate } from "./pose";

function fakeContext() {
  const alphas: number[] = [];
  const ctx = {
    drawImage: vi.fn(() => {
      alphas.push(ctx.globalAlpha);
    }),
    alphas,
    clearRect: vi.fn(),
    setTransform: vi.fn(),
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
  };
  return ctx;
}
let offscreen: Array<ReturnType<typeof fakeContext>> = [];

beforeEach(() => {
  offscreen = [];
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      constructor(
        public width: number,
        public height: number,
      ) {}
      getContext() {
        const ctx = fakeContext();
        offscreen.push(ctx);
        return ctx;
      }
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

const capture = {} as CanvasImageSource;
const background = {} as CanvasImageSource;
const slide = (from: number, to: number, n = 16) =>
  Array.from({ length: n }, (_, k) => translate(IDENTITY, from + ((to - from) * (k + 0.5)) / n, 0));
const mover = (w: number, h: number, taps: ReturnType<typeof slide>): MoverFrame => ({
  w,
  h,
  now: translate(IDENTITY, 50, 0),
  taps,
});

describe("createCompositor", () => {
  it("keeps no crop for a mover that does not travel a pixel, and draws only the background", () => {
    const c = createCompositor(100, 100);
    const movers = [mover(10, 10, slide(0, 0.5))];
    const kept = c.plan(movers);
    expect(kept).toEqual([false]);
    c.crop(capture, movers, kept);
    const out = fakeContext();
    expect(c.draw(background, out as never, movers, kept)).toEqual({ blurred: 0, taps: 0 });
    expect(out.drawImage).toHaveBeenCalledTimes(1);
    expect(out.drawImage.mock.calls[0]?.[0]).toBe(background);
  });

  it("crops a moving mover once and lays one tap per draw over the background", () => {
    const c = createCompositor(1000, 100);
    const movers = [mover(10, 10, slide(0, 100))];
    const kept = c.plan(movers);
    expect(kept).toEqual([true]);
    c.crop(capture, movers, kept);
    const crop = offscreen.at(-1);
    expect(crop?.drawImage).toHaveBeenCalledWith(capture, 0, 0, 1000, 100);
    const out = fakeContext();
    const stats = c.draw(background, out as never, movers, kept);
    const accum = offscreen[0];
    expect(stats.blurred).toBe(1);
    expect(accum?.drawImage).toHaveBeenCalledTimes(stats.taps);
    // Whole 1/255 units, because canvas quantizes image alpha to them: the taps sum to 1 exactly.
    const units = (accum?.alphas ?? []).map((a) => Math.round(a * 255));
    expect(units).toHaveLength(stats.taps);
    expect(units.reduce((sum, u) => sum + u, 0)).toBe(255);
    // Background first, then the trail over it.
    expect(out.drawImage.mock.calls[0]).toEqual([background, 0, 0]);
    expect(out.drawImage).toHaveBeenCalledTimes(2);
  });

  it("leaves a mover sharp when its box is too big to copy every frame", () => {
    const c = createCompositor(100, 100);
    expect(c.plan([mover(1000, 1000, slide(0, 100))])).toEqual([false]);
  });

  it("works in device pixels: scaled buffers, transforms and dirty rect", () => {
    const c = createCompositor(1000, 100, 2);
    const movers = [mover(10, 10, slide(0, 100))];
    const kept = c.plan(movers);
    c.crop(capture, movers, kept);
    const crop = offscreen.at(-1);
    // now = translate(50, 0): the inverse maps the capture into the mover's local space.
    expect(crop?.setTransform.mock.calls.at(-1)?.map((v: number) => v + 0)).toEqual([
      2, 0, 0, 2, -100, 0,
    ]);
    expect(crop?.clearRect).toHaveBeenCalledWith(0, 0, 20, 20);
    expect(crop?.drawImage).toHaveBeenCalledWith(capture, 0, 0, 1000, 100);
    const out = fakeContext();
    c.draw(background, out as never, movers, kept);
    const accum = offscreen[0];
    const lastTap = accum?.setTransform.mock.calls.at(-1);
    expect(lastTap?.slice(0, 4)).toEqual([2, 0, 0, 2]);
    expect(accum?.drawImage.mock.calls[0]).toEqual([expect.anything(), 0, 0, 20, 20, 0, 0, 10, 10]);
    const [, sx, sy, sw, sh, dx, dy, dw, dh] = out.drawImage.mock.calls[1] ?? [];
    expect([sx, sy, sh, dx, dy, dh]).toEqual([2, 0, 24, 2, 0, 24]);
    expect(sw).toBe(dw);
    expect(sw).toBeGreaterThan(200);
  });
});
