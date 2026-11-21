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
  type BlurWindow,
} from "./__fixtures__/motionBlur/blurPage.js";
import {
  sweepFixtureNamed,
  type SweepFixtureName,
  type Tier,
} from "./__fixtures__/motionBlur/sweepFixtures.js";
import { INVARIANTS, ORACLE, SWEEP_SYMPTOMS } from "./__fixtures__/motionBlur/thresholds.js";
import { motionBlurSampleTimes, resolveMotionBlurPlan } from "./motionBlur.js";

const FPS = 30;
const frameTime = (n: number): number => n / FPS;
const SHUTTER_DIVISIONS = 24;
const SHUTTER_SECONDS = 240 / 360 / FPS;
const RADIUS_PX = 2;
const CASE_TIMEOUT_MS = 60_000;

const ORACLE_PLAN = resolveMotionBlurPlan({
  samplesPerFrame: ORACLE.samples,
  shutterAngle: 240,
  shutterPhase: -120,
  blend: "srgb",
});

/**
 * outside: blur on equals blur off away from every trail (invariant 1).
 * inside: blur on is close to the mean of 8 blur-off shutter samples inside the trail (invariant 2).
 * oracle: blur on is close, over the whole frame, to the engine's own 32-sample sub-frame blur. It is
 * stricter than the shutter mean and sees defects too small or too spread out for the two invariants.
 */
type Check = "outside" | "inside" | "oracle";

interface KnownBug {
  finding: string;
  reason: string;
  /** Every bad tile must touch one of these rects, in CSS px. */
  regions: readonly Rect[];
  measuredMae: number;
}

interface SweepCase {
  fixture: SweepFixtureName;
  tier: Tier;
  frame: number;
  check: Check;
  bug?: KnownBug;
}

const rect = (x: number, y: number, width: number, height: number): Rect => ({
  x,
  y,
  width,
  height,
});

const S = SWEEP_SYMPTOMS;
const mover = (left: number): Rect => rect(left, 140, 120, 80);
// A trail: the mover's box widened by the 21 px it travels in one 240 degree shutter.
const trail = (left: number): Rect => rect(left - 21, 140, 162, 80);

const CASES: readonly SweepCase[] = [
  { fixture: "plain", tier: "capture", frame: 14, check: "oracle" },
  { fixture: "plain", tier: "filter", frame: 14, check: "oracle" },
  {
    fixture: "behind-panel",
    tier: "capture",
    frame: 14,
    check: "outside",
    bug: {
      finding: "A",
      reason: "a static panel in front of the mover is painted over by its trail",
      regions: [rect(260, 100, 120, 160)],
      measuredMae: S.A,
    },
  },
  {
    fixture: "blend-difference",
    tier: "capture",
    frame: 11,
    check: "inside",
    bug: {
      finding: "B",
      reason: "a mix-blend-mode mover is captured alone, so it blends with nothing",
      regions: [trail(152)],
      measuredMae: S.B,
    },
  },
  {
    fixture: "ancestor-drop-shadow",
    tier: "capture",
    frame: 14,
    check: "inside",
    bug: {
      finding: "C",
      reason: "the drop shadow an ancestor casts from the mover is missing",
      regions: [rect(227, 140, 176, 100)],
      measuredMae: S.C,
    },
  },
  ...(["pseudo-after", "pseudo-before"] as const).flatMap((fixture) =>
    (["capture", "filter"] as const).map(
      (tier): SweepCase => ({ fixture, tier, frame: 14, check: "inside" }),
    ),
  ),
  {
    fixture: "own-clip-polygon",
    tier: "filter",
    frame: 14,
    check: "oracle",
    bug: {
      finding: "E",
      reason: "the mover's own clip-path cuts its smear to a hard edge",
      regions: [trail(248)],
      measuredMae: S.E,
    },
  },
  {
    fixture: "fixed-child-left",
    tier: "capture",
    frame: 11,
    check: "outside",
    bug: {
      finding: "F",
      reason: "a fixed child of a mover that moves through left is smeared along the path",
      regions: [rect(10, 10, 60, 30)],
      measuredMae: S.F_CAPTURE,
    },
  },
  {
    fixture: "fixed-child-left",
    tier: "filter",
    frame: 11,
    check: "outside",
  },
  {
    fixture: "body-child-selector",
    tier: "capture",
    frame: 4,
    check: "outside",
    bug: {
      finding: "H",
      reason:
        "a selector through the root's parent stops matching once the root is wrapped, still frames included",
      regions: [mover(40)],
      measuredMae: S.H,
    },
  },
  {
    fixture: "last-child-selector",
    tier: "filter",
    frame: 11,
    check: "outside",
  },
  {
    fixture: "overflow-card",
    tier: "capture",
    frame: 11,
    check: "oracle",
    bug: {
      finding: "J",
      reason: "the clip edge of an overflow:hidden card travels with the mover sliding into it",
      regions: [rect(200, 140, 0, 80)],
      measuredMae: S.J,
    },
  },
  {
    fixture: "overlapping-movers",
    tier: "capture",
    frame: 15,
    check: "oracle",
    bug: {
      finding: "K",
      reason: "two crossing movers each carry a ghost of the other in their trail",
      regions: [rect(260, 150, 140, 70)],
      measuredMae: S.K,
    },
  },
  {
    fixture: "rise-from-below",
    tier: "capture",
    frame: 14,
    check: "oracle",
    bug: {
      finding: "M",
      reason: "content rising in from below the frame leaves a band at the bottom edge",
      regions: [rect(0, 350, 640, 10)],
      measuredMae: S.M,
    },
  },
  ...(["capture", "filter"] as const).map(
    (tier): SweepCase => ({
      fixture: "visibility-toggle",
      tier,
      frame: 15,
      check: "inside",
      bug: {
        finding: "O",
        reason: "a mover hidden half way through the shutter is drawn at full strength, not half",
        regions: [trail(280)],
        measuredMae: tier === "capture" ? S.O_CAPTURE : S.O_FILTER,
      },
    }),
  ),
];

function neighbourTimes(n: number): number[] {
  const r = INVARIANTS.radiusFrames;
  return Array.from({ length: 2 * r + 1 }, (_, k) => frameTime(n - r + k));
}

function shutterTimes(n: number): number[] {
  const t = frameTime(n);
  const samples = INVARIANTS.shutterSamples;
  return Array.from(
    { length: samples },
    (_, k) => t - SHUTTER_SECONDS / 2 + ((k + 0.5) * SHUTTER_SECONDS) / samples,
  );
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

async function blurOffReference(
  page: Page,
  c: SweepCase,
): Promise<{ reference: Rgba; mask: Uint8Array }> {
  if (c.check === "outside") {
    const frames = await captureInOrder(page, neighbourTimes(c.frame));
    const reference = frames[INVARIANTS.radiusFrames];
    if (!reference) throw new Error("missing reference frame");
    return { reference, mask: trailMask(frames, RADIUS_PX) };
  }
  if (c.check === "inside") {
    const samples = await captureInOrder(page, shutterTimes(c.frame), {
      subFrameDivisions: SHUTTER_DIVISIONS,
    });
    return { reference: meanFrame(samples), mask: trailMask(samples, RADIUS_PX) };
  }
  if (!ORACLE_PLAN) throw new Error("no oracle plan");
  const samples = await captureInOrder(
    page,
    motionBlurSampleTimes(ORACLE_PLAN, c.frame, FPS, ORACLE.samples),
    { subFrameDivisions: ORACLE_PLAN.subFrameDivisions },
  );
  const reference = meanFrame(samples);
  return { reference, mask: new Uint8Array(reference.width * reference.height).fill(1) };
}

const MAX_MAE: Record<Check, number> = {
  outside: INVARIANTS.outsideMaxMae,
  inside: INVARIANTS.insideMaxMae,
  oracle: ORACLE.maxMae,
};

async function measure(
  browser: Browser,
  c: SweepCase,
): Promise<{ d: Differential; tier: string | null | undefined }> {
  const f = sweepFixtureNamed(c.fixture);
  const size = { width: f.width, height: f.height };
  const off = await openFixture(browser, f.html("off", c.tier), f.dpr, size);
  let reference: { reference: Rgba; mask: Uint8Array };
  try {
    reference = await blurOffReference(off, c);
  } finally {
    await off.close();
  }
  const on = await openFixture(browser, f.html("on", c.tier), f.dpr, size);
  try {
    const onFrame = await captureFrame(on, frameTime(c.frame));
    const report = await on.evaluate(() => (window as BlurWindow).__hfMotionBlur?.probe());
    const d = compareTiles(
      reference.reference,
      onFrame,
      reference.mask,
      c.check === "outside" ? "outside" : "inside",
      {
        block: INVARIANTS.block,
        maxMae: MAX_MAE[c.check],
      },
    );
    return { d, tier: report?.tier };
  } finally {
    await on.close();
  }
}

const tilesOutsideRegions = (d: Differential, regions: readonly Rect[]): Differential["bad"] =>
  regions.reduce((bad, region) => tilesOutsideRegion(bad, INVARIANTS.block, region, 1), d.bad);

const firstFive = (d: Differential): string => JSON.stringify(d.bad.slice(0, 5));

function describeCase(c: SweepCase): string {
  const where = `${c.check}, ${c.tier} tier, ${c.fixture} frame ${c.frame}`;
  return c.bug
    ? `KNOWN BUG on main: ${c.bug.finding}: ${c.bug.reason} (${where})`
    : `blur on matches the reference (${where})`;
}

let launched: Browser | undefined;
let supported = false;

function chrome(): Browser {
  if (!launched) throw new Error("Chrome did not launch");
  return launched;
}

describe.skipIf(!hasBrowser)("capture motion blur sweep defects in Chrome", () => {
  beforeAll(async () => {
    ({ browser: launched, supported } = await launch());
  }, 30_000);
  afterAll(() => closeTestChrome(launched));

  for (const c of CASES) {
    it(
      describeCase(c),
      async (ctx) => {
        if (!supported) ctx.skip();
        const { d, tier } = await measure(chrome(), c);
        expect(tier, `${c.fixture} did not blur on the ${c.tier} tier`).toBe(c.tier);
        expect(d.checkedBlocks).toBeGreaterThan(0);
        const { bug } = c;
        if (!bug) {
          expect(d.bad, `${c.fixture} ${firstFive(d)}`).toEqual([]);
          return;
        }
        expect(
          d.bad.length,
          `${bug.finding} looks fixed: delete this case's \`bug\`, which keeps it as a check that blur on matches the reference`,
        ).toBeGreaterThan(0);
        expect(
          tilesOutsideRegions(d, bug.regions),
          `a new defect outside ${JSON.stringify(bug.regions)}: ${firstFive(d)}`,
        ).toEqual([]);
        expect(
          withinSymptomBand(d.worstMae, bug.measuredMae),
          `the pinned symptom changed: re-measure (worst MAE ${d.worstMae.toFixed(2)}, pinned at ${bug.measuredMae})`,
        ).toBe(true);
      },
      CASE_TIMEOUT_MS,
    );
  }
});
