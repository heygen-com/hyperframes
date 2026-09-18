/**
 * One real `--motion-blur` render, end to end.
 *
 * This is the only test that proves the flag's whole path: that the CLI's
 * option reaches `RenderConfig.motionBlur`, that the producer picks PNG capture
 * and the screenshot route from it, and that the engine's sub-frame
 * accumulation then reproduces After Effects' shutter geometry on real frames.
 * Every other test in this series mocks the producer or the browser, so none of
 * them can see any of that.
 *
 * The oracle is the registry's own AE reference
 * (`src/registry/__fixtures__/motion-blur-ae-reference.json`), reused rather
 * than restated: its measured claim is that a 720-degree shutter's window ends
 * land exactly on the neighbouring frames' positions — one frame before, one
 * frame after the frame time (`windowFramesBefore` / `windowFramesAfter`), over
 * 16 sub-intervals. A bar translating at a known constant velocity lets that
 * claim be checked as a pixel span, which is exact, rather than as a pixel
 * similarity score, which is not.
 *
 * Needs Chrome and ffmpeg, so it skips wherever either is absent — which
 * includes the `Test` job's environment, where no chrome-headless-shell is
 * cached. Set `HYPERFRAMES_E2E_MOTION_BLUR=0` to skip it explicitly.
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  decodePng,
  getFfmpegBinary,
  resolveConfig,
  resolveHeadlessShellPath,
} from "@hyperframes/engine";
import { createRenderJob, executeRenderJob } from "@hyperframes/producer";
import { parseMotionBlurArg } from "../../utils/renderArgs.js";
import reference from "../../registry/__fixtures__/motion-blur-ae-reference.json" with { type: "json" };

const FPS = 10;
const DURATION_SECONDS = 6;
const WIDTH = 320;
const HEIGHT = 180;
/** The bar's own geometry, and its constant velocity in px per second. */
const BAR_WIDTH = 60;
const BAR_HEIGHT = 40;
const BAR_SPEED_PX_PER_S = 40;
/** Pixels of travel per output frame — the unit every assertion below counts in. */
const PX_PER_FRAME = BAR_SPEED_PX_PER_S / FPS;

const FRAME_UNDER_TEST = 11; // zero-based; well inside the linear ramp, away from either end

/** The shutter the AE reference was measured at, in the flag's own micro-syntax. */
const REFERENCE_ANGLE_DEG = 360 * (reference.windowFramesBefore + reference.windowFramesAfter);
const REFERENCE_PHASE_DEG = -360 * reference.windowFramesBefore;

const COMPOSITION = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; background: #000; }
    #bar { position: absolute; top: ${(HEIGHT - BAR_HEIGHT) / 2}px; left: 0; width: ${BAR_WIDTH}px; height: ${BAR_HEIGHT}px; background: #fff; }
  </style>
</head>
<body>
  <div
    id="root"
    data-composition-id="motion-blur-e2e"
    data-start="0"
    data-duration="${DURATION_SECONDS}"
    data-width="${WIDTH}"
    data-height="${HEIGHT}"
    data-fps="${FPS}"
  >
    <div id="bar" class="clip"></div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <script>
    var tl = gsap.timeline({ paused: true });
    // Linear, so the bar's position at any sub-frame time is exactly
    // BAR_SPEED_PX_PER_S * t: the sub-frame sampling the assertions depend on
    // has no easing term to model.
    tl.to("#bar", { x: ${BAR_SPEED_PX_PER_S * DURATION_SECONDS}, duration: ${DURATION_SECONDS}, ease: "none" }, 0);
    window.__timelines = window.__timelines || {};
    window.__timelines["motion-blur-e2e"] = tl;
  </script>
</body>
</html>
`;

/** A cached chrome-headless-shell, which this test needs and CI does not have. */
function hasCachedBrowser(): boolean {
  try {
    return resolveHeadlessShellPath() !== undefined;
  } catch {
    return false;
  }
}

const HAS_BROWSER =
  hasCachedBrowser() ||
  (process.env.PRODUCER_HEADLESS_SHELL_PATH !== undefined &&
    existsSync(process.env.PRODUCER_HEADLESS_SHELL_PATH));
const HAS_FFMPEG = (() => {
  try {
    return existsSync(getFfmpegBinary());
  } catch {
    return false;
  }
})();
const ENABLED = process.env.HYPERFRAMES_E2E_MOTION_BLUR !== "0" && HAS_BROWSER && HAS_FFMPEG;

/**
 * Alpha column coverage: the mean alpha of each column, as a fraction of full
 * opacity.
 *
 * The accumulation pass averages its sub-frame samples *premultiplied by
 * alpha*, so a column the shutter swept across for part of the window comes out
 * at a fractional alpha proportional to how long it was covered — which is the
 * quantity the shutter model below predicts, and the only one that can see the
 * sub-interval staircase. A binary occupied/empty count would collapse it to
 * "fully covered" and lose exactly the signal the assertions are about.
 */
function columnCoverage(png: Buffer): Float64Array {
  const { width, height, data } = decodePng(png);
  const coverage = new Float64Array(width);
  for (let x = 0; x < width; x++) {
    let alpha = 0;
    for (let y = 0; y < height; y++) alpha += (data[(y * width + x) * 4 + 3] as number) / 255;
    coverage[x] = alpha / height;
  }
  return coverage;
}

/** First and last columns with any coverage at all. */
function inkSpan(coverage: Float64Array): { first: number; last: number } {
  let first = -1;
  let last = -1;
  for (let x = 0; x < coverage.length; x++) {
    if ((coverage[x] as number) > 0) {
      if (first < 0) first = x;
      last = x;
    }
  }
  if (first < 0) throw new Error("frame carries no ink");
  return { first, last };
}

/**
 * Columns whose coverage is strictly between empty and the bar's full height —
 * i.e. the columns the shutter swept a partial sub-interval across.
 *
 * This is the direct pixel reading of the reference's `subIntervalsPerWindow`:
 * one partial column per sub-interval the window is divided into, with none at
 * all on the unblurred frame.
 */
function partialColumns(coverage: Float64Array, fullCoverage: number): number[] {
  const partial: number[] = [];
  for (let x = 0; x < coverage.length; x++) {
    const value = coverage[x] as number;
    if (value > 0 && value < fullCoverage - 1e-9) partial.push(x);
  }
  return partial;
}

/** Luma standard deviation of the alpha channel — the non-constant-frame guard. */
function alphaStdev(coverage: Float64Array): number {
  const mean = coverage.reduce((sum, value) => sum + value, 0) / coverage.length;
  const variance = coverage.reduce((sum, value) => sum + (value - mean) ** 2, 0) / coverage.length;
  return Math.sqrt(variance);
}

/**
 * The AE shutter model, taken from the component's own header (and the spec's
 * Global Constraint 4), deliberately re-derived here rather than imported: an
 * oracle that calls the implementation it checks cannot fail when the
 * implementation is wrong.
 *
 *   shutterTime = angle / 360 / fps
 *   windowStart = t + phase / 360 / fps
 *   sample k at  windowStart + (k / samples) * shutterTime
 */
function expectedCoverage(
  frameIndex: number,
  angleDeg: number,
  phaseDeg: number,
  samples: number,
  height: number,
): Float64Array {
  const t = frameIndex / FPS;
  const shutterTime = angleDeg / 360 / FPS;
  const windowStart = t + phaseDeg / 360 / FPS;
  const coverage = new Float64Array(WIDTH);
  for (let k = 0; k <= samples; k++) {
    const sampleTime = windowStart + (k / samples) * shutterTime;
    const left = BAR_SPEED_PX_PER_S * sampleTime;
    for (let x = 0; x < WIDTH; x++) {
      if (x >= left && x < left + BAR_WIDTH) {
        coverage[x] = (coverage[x] as number) + BAR_HEIGHT / height / (samples + 1);
      }
    }
  }
  return coverage;
}

describe.skipIf(!ENABLED)("render --motion-blur — real render", () => {
  const root = mkdtempSync(join(tmpdir(), "hf-motion-blur-e2e-"));
  const blurredDir = join(root, "blurred");
  const sharpDir = join(root, "sharp");
  let blurredFrames: string[] = [];
  let sharpFrames: string[] = [];

  async function renderTo(outputPath: string, motionBlur?: Record<string, number>): Promise<void> {
    const job = createRenderJob({
      fps: { num: FPS, den: 1 },
      quality: "draft",
      format: "png-sequence",
      hdrMode: "force-sdr",
      workers: 1,
      // The engine's accumulation pass needs screenshot capture; the CLI forces
      // this from the flag, and this test drives the producer directly, so it
      // states the same requirement itself rather than depending on the CLI.
      producerConfig: resolveConfig({
        browserGpuMode: "software",
        forceScreenshot: true,
        useDrawElement: false,
      }),
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      ...(motionBlur ? { motionBlur } : {}),
    });
    await executeRenderJob(job, root, outputPath);
  }

  // The flag spelling is what a user types, so at least one assertion has to
  // go through it rather than through the option object the CLI builds.
  it("parses the reference's shutter out of the flag's own micro-syntax", () => {
    const parsed = parseMotionBlurArg(
      `${REFERENCE_ANGLE_DEG}:${REFERENCE_PHASE_DEG}:${reference.subIntervalsPerWindow}`,
    );
    expect(parsed).toEqual({
      ok: true,
      value: {
        shutterAngle: REFERENCE_ANGLE_DEG,
        shutterPhase: REFERENCE_PHASE_DEG,
        samplesPerFrame: reference.subIntervalsPerWindow,
      },
    });
  });

  it("renders the same composition with and without the shutter", async () => {
    writeFileSync(join(root, "index.html"), COMPOSITION);
    await renderTo(blurredDir, {
      shutterAngle: REFERENCE_ANGLE_DEG,
      shutterPhase: REFERENCE_PHASE_DEG,
      samplesPerFrame: reference.subIntervalsPerWindow,
    });
    await renderTo(sharpDir);

    blurredFrames = readdirSync(blurredDir)
      .filter((name) => name.endsWith(".png"))
      .sort();
    sharpFrames = readdirSync(sharpDir)
      .filter((name) => name.endsWith(".png"))
      .sort();
    // A render that captured nothing would make every assertion below vacuous.
    expect(sharpFrames).toHaveLength(DURATION_SECONDS * FPS);
    expect(blurredFrames).toHaveLength(DURATION_SECONDS * FPS);
  }, 600_000);

  it("carries the shutter from the flag through to the captured frames", () => {
    // Without motion blur the frame is the bar's own 60 px: the accumulation
    // pass is the only thing that can widen it.
    const sharp = inkSpan(
      columnCoverage(readFileSync(join(sharpDir, sharpFrames[FRAME_UNDER_TEST] as string))),
    );
    expect(sharp.last - sharp.first + 1).toBe(BAR_WIDTH);

    const blurred = inkSpan(
      columnCoverage(readFileSync(join(blurredDir, blurredFrames[FRAME_UNDER_TEST] as string))),
    );
    expect(blurred.last - blurred.first + 1).toBeGreaterThan(BAR_WIDTH);
  });

  // The AE reference's own measured claim, in pixels: the shutter window's ends
  // land exactly on the neighbouring frames' positions — one frame before and
  // one frame after the frame time. At `PX_PER_FRAME` of travel per frame that
  // is a span of exactly (before + after) frames of extra travel, half of it on
  // each side because the window is centred on the frame time.
  it("opens the shutter over exactly the reference's window, in frames", () => {
    const sharp = inkSpan(
      columnCoverage(readFileSync(join(sharpDir, sharpFrames[FRAME_UNDER_TEST] as string))),
    );
    const blurred = inkSpan(
      columnCoverage(readFileSync(join(blurredDir, blurredFrames[FRAME_UNDER_TEST] as string))),
    );
    const perSide = (reference.windowFramesBefore + reference.windowFramesAfter) / 2;

    // Trailing (the window's early end) and leading (its late end) travel past
    // the sharp instance, measured in the same pixels the reference uses.
    expect(sharp.first - blurred.first).toBeCloseTo(perSide * PX_PER_FRAME, 0);
    expect(blurred.last - sharp.last).toBeCloseTo(perSide * PX_PER_FRAME, 0);
  });

  // The reference's other measured claim: the window is divided into
  // `subIntervalsPerWindow` (16) steps, so the smear is a staircase of 16
  // partial columns — half of them on the trailing tail, half on the leading.
  // An unblurred frame has none, which is what makes this discriminating.
  it("lays down one partial column per sub-interval the reference counted", () => {
    const fullCoverage = BAR_HEIGHT / HEIGHT;
    const blurred = partialColumns(
      columnCoverage(readFileSync(join(blurredDir, blurredFrames[FRAME_UNDER_TEST] as string))),
      fullCoverage,
    );
    const sharp = partialColumns(
      columnCoverage(readFileSync(join(sharpDir, sharpFrames[FRAME_UNDER_TEST] as string))),
      fullCoverage,
    );

    expect(sharp).toHaveLength(0);
    expect(blurred).toHaveLength(reference.subIntervalsPerWindow);
    // The staircase is symmetric about the sharp instance, because the window
    // is centred on the frame time (the -0.5/fps phase the reference records).
    // The half of the 16 that falls OUTSIDE the sharp bar is the window's own
    // travel, and there is exactly one partial column per pixel of it: the
    // window reaches `windowFramesBefore` frames back and `windowFramesAfter`
    // forward, which at PX_PER_FRAME is 4 px either side. The other 8 partial
    // columns are the bar's two edge columns, each swept for part of the window.
    const sharpSpan = inkSpan(
      columnCoverage(readFileSync(join(sharpDir, sharpFrames[FRAME_UNDER_TEST] as string))),
    );
    const perSidePx =
      ((reference.windowFramesBefore + reference.windowFramesAfter) / 2) * PX_PER_FRAME;
    const trailing = blurred.filter((x) => x < sharpSpan.first);
    const leading = blurred.filter((x) => x > sharpSpan.last);
    expect(trailing).toHaveLength(perSidePx);
    expect(leading).toHaveLength(perSidePx);
    expect(trailing.length + leading.length).toBe(reference.subIntervalsPerWindow / 2);
  });

  // PSNR of a measured column-coverage curve against the model's, in dB.
  // Both sides are the same 8-bit coverage quantity, so the score is
  // comparable between the blurred and unblurred renders.
  function modelPsnrDb(measured: Float64Array, expected: Float64Array): number {
    let mse = 0;
    for (let x = 0; x < WIDTH; x++) {
      const diff = ((measured[x] as number) - (expected[x] as number)) * 255;
      mse += diff * diff;
    }
    mse /= WIDTH;
    return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
  }

  it("matches the AE shutter model on real frames, with a floor and a non-constant guard", () => {
    for (const frameIndex of [FRAME_UNDER_TEST, FRAME_UNDER_TEST + 3]) {
      const file = blurredFrames[frameIndex] as string;
      const blurredPng = readFileSync(join(blurredDir, file));
      const measured = columnCoverage(blurredPng);
      const { height } = decodePng(blurredPng);

      // Guard the guard: a black frame scores against a dark reference, and a
      // constant frame scores against a constant one. Neither may pass.
      expect(alphaStdev(measured)).toBeGreaterThan(0.01);

      const expected = expectedCoverage(
        frameIndex,
        REFERENCE_ANGLE_DEG,
        REFERENCE_PHASE_DEG,
        reference.subIntervalsPerWindow,
        height,
      );
      const db = modelPsnrDb(measured, expected);
      // The spec's pixel-gate floor. Measured: ~53 dB at this geometry.
      expect(db).toBeGreaterThanOrEqual(30);

      // And the shutter must be what produced the match: score the UNBLURRED
      // frame of the same index against the same model. It lacks the smear, so
      // its score has to be strictly worse, or the composition — not the blur —
      // is what the model is fitting. Measured: ~55.5 dB blurred vs ~36.6 dB
      // sharp, an 18.9 dB gap, so the 1 dB margin is not near the edge.
      const sharpMeasured = columnCoverage(readFileSync(join(sharpDir, file)));
      const sharpDb = modelPsnrDb(sharpMeasured, expected);
      expect(sharpDb).toBeLessThan(db - 1);
    }
  }, 120_000);

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });
});
