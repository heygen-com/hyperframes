import type { Browser, Page } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  compareTiles,
  meanFrame,
  tilesOutsideRegion,
  trailMask,
  withinSymptomBand,
  type Differential,
  type Rect,
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
import {
  INVARIANTS,
  MEASURED_LABEL_EARLY_FRESH_PAINT,
  MEASURED_SCROLL_LOSS_FRESH_PAINT,
} from "./__fixtures__/motionBlur/thresholds.js";

const FPS = 30;
const frameTime = (n: number): number => n / FPS;
const SUB_FRAME_DIVISIONS = 24;
const SHUTTER_SECONDS = 240 / 360 / FPS;
const CASE_TIMEOUT_MS = 60_000;

interface KnownBug {
  reason: string;
  /** The element whose rect every bad tile must touch. */
  regionId: string;
  /** Worst-tile MAE of the symptom where it was pinned. */
  measuredMae: number;
}

const SCROLL_LOSS: KnownBug = {
  reason: "scroll-list loses its scroll offset on a fresh first paint",
  regionId: "list",
  measuredMae: MEASURED_SCROLL_LOSS_FRESH_PAINT,
};
const LABEL_EARLY: KnownBug = {
  reason: "callbacks shows its label B before the call that sets it",
  regionId: "label",
  measuredMae: MEASURED_LABEL_EARLY_FRESH_PAINT,
};

/** Cases where blur on really differs from blur off today. They pin the symptom and fail once it is fixed. */
const KNOWN_REAL_DIFFERENCES = new Map<string, KnownBug>([
  ["outside:scroll-list@1", SCROLL_LOSS],
  ["outside:scroll-list@1.2", SCROLL_LOSS],
  ["outside:scroll-list@1.5", SCROLL_LOSS],
  ["outside:callbacks@0.2", LABEL_EARLY],
  ["outside:callbacks@0.3", LABEL_EARLY],
  ["outside:callbacks@0.4", LABEL_EARLY],
]);

/** Before the label's first call: blur on gets it wrong at these frames, so they are the known-bug cases above. */
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

async function measureOutside(
  browser: Browser,
  f: BlurFixture,
  t: number,
  regionId?: string,
): Promise<{ d: Differential; region: Rect }> {
  const { offFrames, region } = await onFreshPage(browser, f, "off", async (p) => ({
    offFrames: await captureInOrder(p, neighbourTimes(t)),
    region: await elementRect(p, regionId),
  }));
  const onFrame = await onFreshPage(browser, f, "on", (p) => captureFrame(p, t));
  const reference = offFrames[INVARIANTS.radiusFrames];
  if (!reference) throw new Error("missing reference frame");
  const d = compareTiles(reference, onFrame, trailMask(offFrames, radiusPx(f)), "outside", {
    block: INVARIANTS.block,
    maxMae: INVARIANTS.outsideMaxMae,
  });
  return { d, region };
}

async function elementRect(page: Page, id: string | undefined): Promise<Rect> {
  const box = await page.evaluate((elementId) => {
    const el = elementId ? document.getElementById(elementId) : null;
    return el ? el.getBoundingClientRect().toJSON() : null;
  }, id);
  return box ?? { x: 0, y: 0, width: 0, height: 0 };
}

const caseName = (what: string, f: BlurFixture, t: number): string => `${what}: ${f.name} at ${t}`;

let launched: Browser | undefined;
let supported = false;

function chrome(): Browser {
  if (!launched) throw new Error("Chrome did not launch");
  return launched;
}

function fixtureNamed(name: string): BlurFixture {
  const f = FIXTURES.find((x) => x.name === name);
  if (!f) throw new Error(`missing fixture ${name}`);
  return f;
}

function defineKnownBugCase(f: BlurFixture, t: number, known: KnownBug): void {
  it(
    `KNOWN BUG on main: ${known.reason} (outside, ${t} s)`,
    async (ctx) => {
      if (!supported) ctx.skip();
      const { d, region } = await measureOutside(chrome(), f, t, known.regionId);
      const fixed = `${known.reason}: this case pins a known bug; if it now passes, delete its \`outside:${f.name}@${t}\` entry from KNOWN_REAL_DIFFERENCES, which makes it an ordinary outside case`;
      expect(d.checkedFraction).toBeGreaterThanOrEqual(INVARIANTS.minCheckedFraction);
      expect(d.bad.length, fixed).toBeGreaterThan(0);
      expect(
        tilesOutsideRegion(d.bad, INVARIANTS.block, region, f.dpr),
        `a new defect outside the ${known.regionId} rect ${JSON.stringify(region)}: ${firstFive(d)}`,
      ).toEqual([]);
      expect(
        withinSymptomBand(d.worstMae, known.measuredMae),
        `the pinned symptom changed: re-measure (worst MAE ${d.worstMae.toFixed(2)}, pinned at ${known.measuredMae})`,
      ).toBe(true);
    },
    CASE_TIMEOUT_MS,
  );
}

function defineOutsideCase(f: BlurFixture, t: number): void {
  it(
    caseName("outside the trail, blur on equals blur off", f, t),
    async (ctx) => {
      if (!supported) ctx.skip();
      const { d } = await measureOutside(chrome(), f, t);
      expect(d.bad, `${f.name} ${firstFive(d)}`).toEqual([]);
      expect(d.checkedFraction).toBeGreaterThanOrEqual(INVARIANTS.minCheckedFraction);
    },
    CASE_TIMEOUT_MS,
  );
}

function defineInsideCase(f: BlurFixture, t: number): void {
  it(
    caseName("inside the trail, blur on matches the shutter average", f, t),
    async (ctx) => {
      if (!supported) ctx.skip();
      const samples = await onFreshPage(chrome(), f, "off", (p) =>
        captureInOrder(p, shutterTimes(t), { subFrameDivisions: SUB_FRAME_DIVISIONS }),
      );
      const onFrame = await onFreshPage(chrome(), f, "on", (p) => captureFrame(p, t));
      const d = compareTiles(
        meanFrame(samples),
        onFrame,
        trailMask(samples, radiusPx(f)),
        "inside",
        {
          block: INVARIANTS.block,
          maxMae: INVARIANTS.insideMaxMae,
        },
      );
      expect(d.checkedBlocks).toBeGreaterThan(0);
      expect(d.bad, `${f.name} ${firstFive(d)}`).toEqual([]);
    },
    CASE_TIMEOUT_MS,
  );
}

function defineHistoryCase(f: BlurFixture, t: number): void {
  it(
    `blur off does not depend on seek history: ${f.name} at ${t}`,
    async (ctx) => {
      if (!supported) ctx.skip();
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
      if (!supported) ctx.skip();
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
  for (const t of [...f.checkpoints, ...(EXTRA_OUTSIDE_TIMES.get(f.name) ?? [])]) {
    const known = KNOWN_REAL_DIFFERENCES.get(`outside:${f.name}@${t}`);
    if (known) defineKnownBugCase(f, t, known);
    else defineOutsideCase(f, t);
  }
  for (const t of f.moving) defineInsideCase(f, t);
}

describe.skipIf(!hasBrowser)("capture motion blur against blur off in Chrome", () => {
  beforeAll(async () => {
    ({ browser: launched, supported } = await launch());
  }, 30_000);
  afterAll(() => closeTestChrome(launched));

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
