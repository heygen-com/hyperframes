import type { Browser, Page } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  compareTiles,
  meanFrame,
  trailMask,
  type Differential,
  type Rgba,
} from "./__fixtures__/blurDifferential.js";
import { closeTestChrome } from "./__fixtures__/loopback.js";
import {
  captureFrame,
  hasBrowser,
  launch,
  openFixture,
} from "./__fixtures__/motionBlur/blurPage.js";
import { FIXTURES, type BlurFixture } from "./__fixtures__/motionBlur/fixtures.js";
import { INVARIANTS } from "./__fixtures__/motionBlur/thresholds.js";

const FPS = 30;
const frameTime = (n: number): number => n / FPS;
const SUB_FRAME_DIVISIONS = 24;
const SHUTTER_SECONDS = 240 / 360 / FPS;
const CASE_TIMEOUT_MS = 60_000;

/** Cases where blur on really differs from blur off today: they stay expected-fail until fixed. */
const KNOWN_REAL_DIFFERENCES = new Map<string, string>([
  // The scroll offset is lost when blur's first paint moves the root.
  ["outside:scroll-list@1", "scroll offset lost on first paint"],
  ["outside:scroll-list@1.2", "scroll offset lost on first paint"],
  ["outside:scroll-list@1.5", "scroll offset lost on first paint"],
  // Blur on shows the label "B" before the timeline's call has run: blur off shows "A".
  ["outside:callbacks@0.2", "label B before its call"],
  ["outside:callbacks@0.3", "label B before its call"],
  ["outside:callbacks@0.4", "label B before its call"],
]);

/** Known-failing times. Frames 13 and 14 pass only because their neighbourhood masks the label. */
const EXTRA_OUTSIDE_TIMES = new Map<string, readonly number[]>([
  ["callbacks", [frameTime(6), frameTime(9), frameTime(12)]],
]);

const radiusPx = (f: BlurFixture): number => Math.ceil(2 * f.dpr);
const sizeOf = (f: BlurFixture): { width: number; height: number } => ({
  width: f.width,
  height: f.height,
});

async function onFreshPage<T>(
  browser: Browser,
  f: BlurFixture,
  blur: "on" | "off",
  use: (page: Page) => Promise<T>,
): Promise<T> {
  const page = await openFixture(browser, f.html(blur), f.dpr, sizeOf(f));
  try {
    return await use(page);
  } finally {
    await page.close();
  }
}

async function captureInOrder(
  page: Page,
  times: readonly number[],
  options?: { subFrameDivisions?: number },
): Promise<Rgba[]> {
  const frames: Rgba[] = [];
  for (const t of times) frames.push(await captureFrame(page, t, options));
  return frames;
}

function neighbourTimes(t: number): number[] {
  const n = Math.round(t * FPS);
  const { radiusFrames } = INVARIANTS;
  return Array.from({ length: 2 * radiusFrames + 1 }, (_, k) => frameTime(n - radiusFrames + k));
}

function shutterTimes(t: number): number[] {
  const { shutterSamples } = INVARIANTS;
  return Array.from(
    { length: shutterSamples },
    (_, k) => t - SHUTTER_SECONDS / 2 + ((k + 0.5) * SHUTTER_SECONDS) / shutterSamples,
  );
}

function firstFive(d: Differential): string {
  return JSON.stringify(d.bad.slice(0, 5));
}

const caseName = (what: string, f: BlurFixture, t: number): string => `${what}: ${f.name} at ${t}`;
const caseTest = (key: string): typeof it => (KNOWN_REAL_DIFFERENCES.has(key) ? it.fails : it);

describe.skipIf(!hasBrowser)("capture motion blur against blur off in Chrome", () => {
  let browser: Browser;
  let supported = false;

  beforeAll(async () => {
    ({ browser, supported } = await launch());
  }, 30_000);
  afterAll(() => closeTestChrome(browser));

  const blurring = FIXTURES.filter((f) => f.blurs);

  for (const f of blurring) {
    for (const t of [...f.checkpoints, ...(EXTRA_OUTSIDE_TIMES.get(f.name) ?? [])]) {
      const name = caseName("outside the trail, blur on equals blur off", f, t);
      caseTest(`outside:${f.name}@${t}`)(
        name,
        async (ctx) => {
          if (!supported) ctx.skip();
          const offFrames = await onFreshPage(browser, f, "off", (p) =>
            captureInOrder(p, neighbourTimes(t)),
          );
          const onFrame = await onFreshPage(browser, f, "on", (p) => captureFrame(p, t));
          const reference = offFrames[INVARIANTS.radiusFrames];
          if (!reference) throw new Error("missing reference frame");
          const mask = trailMask(offFrames, radiusPx(f));
          const d = compareTiles(reference, onFrame, mask, "outside", {
            block: INVARIANTS.block,
            maxMae: INVARIANTS.outsideMaxMae,
          });
          expect(d.bad, `${f.name} ${firstFive(d)}`).toEqual([]);
          expect(d.checkedFraction).toBeGreaterThanOrEqual(INVARIANTS.minCheckedFraction);
        },
        CASE_TIMEOUT_MS,
      );
    }

    for (const t of f.moving) {
      const name = caseName("inside the trail, blur on matches the shutter average", f, t);
      caseTest(`inside:${f.name}@${t}`)(
        name,
        async (ctx) => {
          if (!supported) ctx.skip();
          const samples = await onFreshPage(browser, f, "off", (p) =>
            captureInOrder(p, shutterTimes(t), { subFrameDivisions: SUB_FRAME_DIVISIONS }),
          );
          const onFrame = await onFreshPage(browser, f, "on", (p) => captureFrame(p, t));
          const reference = meanFrame(samples);
          const mask = trailMask(samples, radiusPx(f));
          const d = compareTiles(reference, onFrame, mask, "inside", {
            block: INVARIANTS.block,
            maxMae: INVARIANTS.insideMaxMae,
          });
          expect(d.bad, `${f.name} ${firstFive(d)}`).toEqual([]);
        },
        CASE_TIMEOUT_MS,
      );
    }
  }

  describe("the blur-off reference is a valid yardstick", () => {
    const BY_NAME = ["held-card", "callbacks"];
    for (const fixtureName of BY_NAME) {
      const f = FIXTURES.find((x) => x.name === fixtureName);
      if (!f) throw new Error(`missing fixture ${fixtureName}`);
      for (const t of f.checkpoints) {
        it(
          `blur off does not depend on seek history: ${f.name} at ${t}`,
          async (ctx) => {
            if (!supported) ctx.skip();
            const inSequence = await onFreshPage(browser, f, "off", async (p) =>
              (await captureInOrder(p, neighbourTimes(t))).at(-1),
            );
            const firstPaint = await onFreshPage(browser, f, "off", (p) => captureFrame(p, t));
            expect(inSequence).toBeDefined();
            const same = Buffer.from(inSequence?.data ?? []).equals(Buffer.from(firstPaint.data));
            expect(same).toBe(true);
          },
          CASE_TIMEOUT_MS,
        );
      }
    }

    it(
      "renderSeek honours sub-frame times",
      async (ctx) => {
        if (!supported) ctx.skip();
        const f = FIXTURES.find((x) => x.name === "held-card");
        if (!f) throw new Error("missing fixture held-card");
        const t = 0.2;
        const [a, mid, b] = await onFreshPage(browser, f, "off", (p) =>
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
