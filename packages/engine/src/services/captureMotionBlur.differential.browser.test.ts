import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Rgba } from "./__fixtures__/blurDifferential.js";
import { captureFrame, hasBrowser } from "./__fixtures__/motionBlur/blurPage.js";
import {
  SUB_FRAME_DIVISIONS,
  captureInOrder,
  chrome,
  defineOutsideCase,
  fixtureNamed,
  frameTime,
  isSupported,
  neighbourTimes,
  onFreshPage,
  startChrome,
  stopChrome,
  FPS,
  CASE_TIMEOUT_MS,
} from "./__fixtures__/motionBlur/differentialPage.js";
import { FIXTURES, type BlurFixture } from "./__fixtures__/motionBlur/fixtures.js";
import { INVARIANTS } from "./__fixtures__/motionBlur/thresholds.js";

/** Before the label's first call: a regression guard that a scan leaves no call's DOM behind to show it early. */
const EXTRA_OUTSIDE_TIMES = new Map<string, readonly number[]>([
  ["callbacks", [frameTime(6), frameTime(9), frameTime(12)]],
]);

function defineHistoryCase(f: BlurFixture, t: number): void {
  it(
    `blur off does not depend on seek history: ${f.name} at ${t}`,
    async (ctx) => {
      if (!isSupported()) ctx.skip();
      const inSequence = await onFreshPage(
        chrome(),
        f,
        "off",
        async (p) => (await captureInOrder(p, neighbourTimes(t)))[INVARIANTS.radiusFrames],
      );
      const firstPaint = await onFreshPage(chrome(), f, "off", (p) => captureFrame(p, t));
      expect(inSequence).toBeDefined();
      expect(Buffer.from(inSequence?.data ?? []).equals(Buffer.from(firstPaint.data))).toBe(true);
    },
    CASE_TIMEOUT_MS,
  );
}

function defineSubFrameCase(): void {
  it(
    "renderSeek honours sub-frame times",
    async (ctx) => {
      if (!isSupported()) ctx.skip();
      const t = 0.2;
      const [a, mid, b] = await onFreshPage(chrome(), fixtureNamed("held-card"), "off", (p) =>
        captureInOrder(p, [t, t + 0.5 / FPS, t + 1 / FPS], {
          subFrameDivisions: SUB_FRAME_DIVISIONS,
        }),
      );
      const left = [a, mid, b].map((frame) => (frame ? cardLeftEdge(frame) : -1));
      expect(left[0]).toBeGreaterThanOrEqual(0);
      expect(left[1]).toBeGreaterThan(left[0] ?? Infinity);
      expect(left[1]).toBeLessThan(left[2] ?? -Infinity);
    },
    CASE_TIMEOUT_MS,
  );
}

function defineFixtureCases(f: BlurFixture): void {
  const times = [...f.checkpoints, ...(EXTRA_OUTSIDE_TIMES.get(f.name) ?? [])].sort(
    (a, b) => a - b,
  );
  for (const t of times) defineOutsideCase(f, t);
}

describe.skipIf(!hasBrowser)("capture motion blur against blur off in Chrome", () => {
  beforeAll(startChrome, 30_000);
  afterAll(stopChrome);

  for (const f of FIXTURES) defineFixtureCases(f);

  describe("the blur-off reference is a valid yardstick", () => {
    for (const name of ["held-card", "callbacks"]) {
      const f = fixtureNamed(name);
      for (const t of f.checkpoints) defineHistoryCase(f, t);
    }
    defineSubFrameCase();
  });
});

/** First column of the card's amber on the card's middle row; -1 when the card is off screen. */
function cardLeftEdge(frame: Rgba): number {
  const y = Math.floor(frame.height / 2);
  for (let x = 0; x < frame.width; x++) {
    const i = (y * frame.width + x) * 4;
    const [r, g, b] = [frame.data[i] ?? 0, frame.data[i + 1] ?? 0, frame.data[i + 2] ?? 0];
    if (r > 200 && g > 130 && g < 190 && b < 100) return x;
  }
  return -1;
}
