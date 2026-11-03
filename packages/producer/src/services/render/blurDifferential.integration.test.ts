// Page motion blur through a real multi-worker render (#6967): outside the trail of everything
// that moved, a blur-on render must equal the blur-off render frame by frame. A PNG sequence is
// lossless and does not encode while capturing, so each of the 4 workers captures one contiguous
// block of frames and every block but the first starts mid-film. Needs Chrome + ffmpeg: integration lane.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodePng, distributeFrames, getFfmpegBinary, resolveConfig } from "@hyperframes/engine";
import {
  compareTiles,
  trailMask,
  type Differential,
  type Rgba,
} from "../../../../engine/src/services/__fixtures__/blurDifferential.js";
import {
  FIXTURES,
  type BlurFixture,
} from "../../../../engine/src/services/__fixtures__/motionBlur/fixtures.js";
import {
  INVARIANTS,
  RENDER_OUTSIDE_MAX_MAE,
} from "../../../../engine/src/services/__fixtures__/motionBlur/thresholds.js";
import { createRenderJob, executeRenderJob } from "../renderOrchestrator.js";

const FFMPEG = getFfmpegBinary();
const HAS_FFMPEG = spawnSync(FFMPEG, ["-version"], { encoding: "utf-8" }).status === 0;

const FPS = 30;
const WORKERS = 4;
/**
 * `callbacks` calls at frames 15, 16 and 30. A worker whose block starts on a call
 * sees the bug only by timing; one starting strictly between the calls always does (#6967).
 * 7 workers over 60 frames start at 0, 9, 18, 27, 36, 45 and 54.
 */
const WORKERS_BY_FIXTURE = new Map<string, number>([["callbacks", 7]]);
/** Block starts the partition must have, at least `count` of them in [from, to]. */
const REQUIRED_STARTS = new Map<string, { from: number; to: number; count: number }>([
  ["callbacks", { from: 18, to: 28, count: 2 }],
  ["scroll-list", { from: 28, to: Infinity, count: 2 }],
]);
const MIN_SECONDS = 1.2;
const RENDER_TIMEOUT_MS = 600_000;
const REGION_TOLERANCE_PX = 2;

const FIXTURE_NAMES = [
  "callbacks",
  "scroll-list",
  "nested-canvas-offset",
  "held-card",
  "overflow-wordmark",
] as const;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface KnownBug {
  reason: string;
  /** The element whose rect the bad tiles must touch, in CSS px from the fixture's markup. */
  regionId: string;
  region: (f: BlurFixture) => Rect;
  /** Output frames in which blur on really differs from blur off today. */
  frames: (n: number) => boolean;
}

const markupOf = (f: BlurFixture, id: string): string =>
  new RegExp(`<[^>]*id="${id}"[^>]*>`).exec(f.html("off"))?.[0] ?? "";

function cssPx(f: BlurFixture, id: string, property: string): number {
  const px = new RegExp(`(?:^|[;"\\s])${property}:\\s*(-?[\\d.]+)px`).exec(markupOf(f, id))?.[1];
  if (px === undefined) throw new Error(`#${id} in ${f.name} has no ${property} in px`);
  return Number(px);
}

/** The element's box from its inline left, top, width and height. */
const boxFromMarkup = (f: BlurFixture, id: string): Rect => ({
  x: cssPx(f, id, "left"),
  y: cssPx(f, id, "top"),
  width: cssPx(f, id, "width"),
  height: cssPx(f, id, "height"),
});

/** One glyph of the element's text: left and top from its inline style; a monospace advance is 0.6 em, a line 1.2 em. */
function glyphFromMarkup(f: BlurFixture, id: string): Rect {
  const size = Number(/font:\s*\d+\s+([\d.]+)px/.exec(markupOf(f, id))?.[1]);
  if (Number.isNaN(size)) throw new Error(`#${id} in ${f.name} has no font size in px`);
  return { x: cssPx(f, id, "left"), y: cssPx(f, id, "top"), width: 0.6 * size, height: 1.2 * size };
}

/** Cases where blur on really differs from blur off today. They pin the symptom and fail once it is fixed. */
const KNOWN_REAL_DIFFERENCES = new Map<string, KnownBug>([
  [
    "scroll-list",
    {
      reason: "scroll-list loses its scroll offset after a worker's first wrap",
      regionId: "list",
      region: (f) => boxFromMarkup(f, "list"),
      frames: (n) => n >= 28,
    },
  ],
  [
    "callbacks",
    {
      reason: "callbacks shows its label B before the call that sets it",
      regionId: "label",
      region: (f) => glyphFromMarkup(f, "label"),
      frames: (n) => n < 15,
    },
  ],
]);

interface Renders {
  off: Rgba[];
  off2: Rgba[];
  on: Rgba[];
}

interface FrameResult {
  frame: number;
  outside: Differential;
  noise: Differential;
  insideMae: number;
}

let root = "";

const fixtureNamed = (name: string): BlurFixture => {
  const f = FIXTURES.find((x) => x.name === name);
  if (!f) throw new Error(`missing fixture ${name}`);
  return f;
};

async function renderFixture(f: BlurFixture, blur: "on" | "off", tag: string): Promise<Rgba[]> {
  const projectDir = join(root, `${f.name}-${tag}`);
  const outputDir = join(projectDir, "frames");
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, "index.html"), f.html(blur));
  const job = createRenderJob({
    fps: FPS,
    format: "png-sequence",
    quality: "standard",
    hdrMode: "force-sdr",
    useGpu: false,
    workers: workersFor(f),
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    producerConfig: resolveConfig({ browserGpuMode: "software" }),
  });
  await executeRenderJob(job, projectDir, outputDir);
  const frames = readdirSync(outputDir)
    .filter((file) => file.endsWith(".png"))
    .sort()
    .map((file) => decodePng(readFileSync(join(outputDir, file))));
  rmSync(projectDir, { recursive: true, force: true });
  return frames;
}

async function renderAll(f: BlurFixture): Promise<Renders> {
  const off = await renderFixture(f, "off", "off");
  const off2 = await renderFixture(f, "off", "off2");
  const on = await renderFixture(f, "on", "on");
  return { off, off2, on };
}

const workersFor = (f: BlurFixture): number => WORKERS_BY_FIXTURE.get(f.name) ?? WORKERS;

function blockStarts(f: BlurFixture): number[] {
  const frames = Math.round(f.durationSeconds * FPS);
  return distributeFrames(frames, workersFor(f), "", 0).map((task) => task.startFrame);
}

const radiusPx = (f: BlurFixture): number => Math.ceil(2 * f.dpr);

/** Frames whose `radiusFrames` neighbours on both sides exist. */
function comparedFrames(count: number): number[] {
  const { radiusFrames } = INVARIANTS;
  return Array.from({ length: Math.max(0, count - 2 * radiusFrames) }, (_, k) => k + radiusFrames);
}

function at(frames: readonly Rgba[], n: number): Rgba {
  const frame = frames[n];
  if (!frame) throw new Error(`missing frame ${n}`);
  return frame;
}

function compareFrame(f: BlurFixture, r: Renders, n: number): FrameResult {
  const { radiusFrames, block } = INVARIANTS;
  const neighbours = r.off.slice(n - radiusFrames, n + radiusFrames + 1);
  const mask = trailMask(neighbours, radiusPx(f));
  const options = { block, maxMae: RENDER_OUTSIDE_MAX_MAE };
  return {
    frame: n,
    outside: compareTiles(at(r.off, n), at(r.on, n), mask, "outside", options),
    noise: compareTiles(at(r.off, n), at(r.off2, n), mask, "outside", options),
    insideMae: compareTiles(at(r.off, n), at(r.on, n), mask, "inside", options).worstMae,
  };
}

function compareFixture(f: BlurFixture, r: Renders): FrameResult[] {
  expect(r.off).toHaveLength(Math.round(f.durationSeconds * FPS));
  expect(r.off2).toHaveLength(r.off.length);
  expect(r.on).toHaveLength(r.off.length);
  return comparedFrames(r.off.length).map((n) => compareFrame(f, r, n));
}

function firstBad(results: readonly FrameResult[]): string {
  return JSON.stringify(
    results
      .filter((x) => x.outside.bad.length > 0)
      .slice(0, 5)
      .map((x) => ({ frame: x.frame, bad: x.outside.bad.slice(0, 3) })),
  );
}

function tileTouches(tile: { x: number; y: number }, block: number, rect: Rect): boolean {
  const left = rect.x - REGION_TOLERANCE_PX;
  const top = rect.y - REGION_TOLERANCE_PX;
  const right = rect.x + rect.width + REGION_TOLERANCE_PX;
  const bottom = rect.y + rect.height + REGION_TOLERANCE_PX;
  return tile.x < right && tile.x + block > left && tile.y < bottom && tile.y + block > top;
}

function expectKnownBug(f: BlurFixture, known: KnownBug, results: readonly FrameResult[]): void {
  const pinned = results.filter((x) => known.frames(x.frame));
  const rest = results.filter((x) => !known.frames(x.frame));
  const fixed = `${known.reason}: this case pins a known bug; if it now passes, delete the case and assert zero bad tiles`;
  const region = known.region(f);
  const bad = pinned.flatMap((x) => x.outside.bad);
  expect(bad.length, fixed).toBeGreaterThan(0);
  expect(Math.max(...pinned.map((x) => x.outside.worstMae)), fixed).toBeGreaterThan(
    RENDER_OUTSIDE_MAX_MAE,
  );
  expect(
    bad.some((tile) => tileTouches(tile, INVARIANTS.block, region)),
    `bad tiles ${firstBad(pinned)} miss the ${known.regionId} rect ${JSON.stringify(region)}`,
  ).toBe(true);
  expect(
    rest.flatMap((x) => x.outside.bad),
    `${f.name} outside the pinned frames ${firstBad(rest)}`,
  ).toEqual([]);
}

function expectEqualOutsideTrail(f: BlurFixture, results: readonly FrameResult[]): void {
  expect(
    results.flatMap((x) => x.outside.bad),
    `${f.name} ${firstBad(results)}`,
  ).toEqual([]);
}

function defineFixtureCases(f: BlurFixture): void {
  describe(f.name, () => {
    let results: FrameResult[] = [];

    beforeAll(async () => {
      expect(f.durationSeconds).toBeGreaterThanOrEqual(MIN_SECONDS);
      results = compareFixture(f, await renderAll(f));
    }, RENDER_TIMEOUT_MS);

    const required = REQUIRED_STARTS.get(f.name);
    if (required) {
      it("partitions the frames so workers start where the bug shows", () => {
        const starts = blockStarts(f).filter((n) => n >= required.from && n <= required.to);
        expect(starts.length, `block starts ${blockStarts(f)}`).toBeGreaterThanOrEqual(
          required.count,
        );
      });
    }

    it("renders blur off the same way twice", () => {
      expect(Math.max(...results.map((x) => x.noise.worstMae))).toBeLessThanOrEqual(
        RENDER_OUTSIDE_MAX_MAE,
      );
    });

    it("checks most of every frame", () => {
      for (const x of results) {
        expect(x.outside.checkedFraction, `frame ${x.frame}`).toBeGreaterThanOrEqual(
          INVARIANTS.minCheckedFraction,
        );
      }
    });

    const known = KNOWN_REAL_DIFFERENCES.get(f.name);
    if (known) {
      it(`KNOWN BUG on main: ${known.reason}`, () => expectKnownBug(f, known, results));
    } else {
      it("outside the trail, blur on equals blur off in every frame", () =>
        expectEqualOutsideTrail(f, results));
    }

    if (f.name === "held-card") {
      it("blurs the card, so the comparison is not vacuous", () => {
        expect(Math.max(...results.map((x) => x.insideMae))).toBeGreaterThan(
          RENDER_OUTSIDE_MAX_MAE,
        );
      });
    }
  });
}

describe.skipIf(!HAS_FFMPEG)("page motion blur through a 4-worker render", () => {
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "hf-blur-differential-"));
  });

  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  for (const name of FIXTURE_NAMES) defineFixtureCases(fixtureNamed(name));
});
