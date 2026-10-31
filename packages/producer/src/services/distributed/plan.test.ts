// fallow-ignore-file code-duplication
/**
 * Unit tests for `services/distributed/plan.ts`.
 *
 * Covers:
 *   - Golden planDir layout produced from a tiny fixture (no browser probe
 *     required — the fixture declares `data-duration` so the probe stage
 *     short-circuits).
 *   - planHash determinism across two `plan()` calls on the same inputs.
 *   - Chunking math (`resolveChunkPlan`, `buildChunkSlices`).
 *
 * The "no browser probe" path is deliberate: spinning Chrome inside `bun test`
 * is expensive and flaky. The chunking helpers + planDir layout are tested
 * with synchronous compile-only fixtures; the BeginFrame / probe path lives
 * inside the regression harness (`bun run --cwd packages/producer docker:test`).
 */

import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyConcreteGpuScreenshotClamp,
  _setDownloadFetchForTests,
  buildChromeArgs,
  FFMPEG_PATH_ENV,
  getFfmpegBinary,
  getFfprobeBinary,
  encodeAac,
} from "@hyperframes/engine";
import { recomputePlanHashFromPlanDir } from "../render/stages/freezePlan.js";
import { defaultLogger } from "../../logger.js";
import { RenderQualityError } from "../renderOrchestrator.js";
import { CURRENT_PLAN_PROTOCOL } from "./planProtocol.js";
import {
  applyDistributedAudioWarningPolicy,
  buildLocalExecutionPlan,
  buildPlanAudio,
  buildChunkSlices,
  CHUNK_EXCEEDS_WORKER_TIMEOUT,
  ChunkExceedsWorkerTimeoutError,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_MAX_PARALLEL_CHUNKS,
  chunkSizingUsesFrameCost,
  estimateChunkSeconds,
  MIN_CHUNK_SIZE,
  plan,
  resolveDistributedEngineConfig,
  resolveChunkPlan,
  planNeedsFrameCostMeasurement,
  resolveMaxParallelChunks,
} from "./plan.js";
import { buildSyntheticRenderJob } from "./shared.js";
import { assemble } from "./assemble.js";
import { constrainAacTruePeak } from "../render/audioPadTrim.js";

function ffmpegOrThrow(args: string[]): void {
  const ffmpeg = spawnSync(getFfmpegBinary(), ["-nostdin", "-loglevel", "error", ...args]);
  if (ffmpeg.status !== 0) throw new Error(`ffmpeg fixture failed: ${ffmpeg.stderr?.toString()}`);
}

// Composition the tests render. `data-duration="1"` keeps the probe stage's
// `needsBrowser` gate `false` so plan() completes without launching Chrome.
const FIXTURE_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>plan-test fixture</title></head>
<body>
  <div data-composition-id="root" data-width="320" data-height="240" data-duration="1">
    <p>plan-test fixture</p>
  </div>
</body>
</html>`;

let projectDir: string;
let runRoot: string;

beforeAll(() => {
  runRoot = mkdtempSync(join(tmpdir(), "hf-plan-test-"));
  projectDir = join(runRoot, "project");
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, "index.html"), FIXTURE_HTML, "utf-8");
});

afterAll(() => {
  rmSync(runRoot, { recursive: true, force: true });
});

describe("distributed warning policy", () => {
  const createJob = (strictness: "strict" | "best-effort") =>
    buildSyntheticRenderJob({
      fps: { num: 30, den: 1 },
      format: "mp4",
      quality: "high",
      hdrMode: "force-sdr",
      strictness,
      entryFile: "index.html",
    });

  it("rejects distributed audio degradation in strict mode", () => {
    const job = createJob("strict");
    expect(() => applyDistributedAudioWarningPolicy(job, "mix failed")).toThrow(RenderQualityError);
    expect(job.warnings.map((warning) => warning.code)).toEqual(["audio_processing_failed"]);
  });

  it("rejects distributed audio degradation in best-effort mode", () => {
    const job = createJob("best-effort");
    expect(() =>
      applyDistributedAudioWarningPolicy(job, "mix failed", [
        {
          stage: "mix",
          reason: "ffmpeg_unsupported",
          owner: "system",
          retryable: false,
          detail: "Option not found",
        },
      ]),
    ).toThrow(RenderQualityError);
    expect(job.warnings.map((warning) => warning.code)).toEqual(["audio_processing_failed"]);
    expect(job.warnings[0]?.details).toEqual(
      expect.objectContaining({
        failureReasons: ["ffmpeg_unsupported"],
        failureStages: ["mix"],
        failureOwner: "system",
        retryable: false,
      }),
    );
  });

  it("only marks a multi-cause audio failure retryable when every cause is retryable", () => {
    const job = createJob("best-effort");
    expect(() =>
      applyDistributedAudioWarningPolicy(job, "mixed failure", [
        {
          stage: "download",
          reason: "download_failed",
          owner: "system",
          retryable: true,
          detail: "temporary download failure",
        },
        {
          stage: "prepare",
          reason: "invalid_media",
          owner: "user",
          retryable: false,
          detail: "invalid media",
        },
      ]),
    ).toThrow(RenderQualityError);
    expect(job.warnings[0]?.details).toEqual(
      expect.objectContaining({
        failureOwner: "system",
        retryable: false,
      }),
    );
  });

  it("does not invent ownership or retryability for legacy untyped failures", () => {
    const job = createJob("best-effort");
    expect(() => applyDistributedAudioWarningPolicy(job, "legacy failure")).toThrow(
      RenderQualityError,
    );
    expect(job.warnings[0]?.details?.failureOwner).toBeUndefined();
    expect(job.warnings[0]?.details?.retryable).toBeUndefined();
  });
});

describe("distributed synthetic render job", () => {
  it("threads render variables into the plan browser probe job", () => {
    const variables = {
      voiceoverSrc: "assets/voiceover.wav",
      narrationDurationSeconds: 56.738,
    };
    const job = buildSyntheticRenderJob({
      fps: { num: 30, den: 1 },
      format: "mp4",
      quality: "high",
      hdrMode: "force-sdr",
      entryFile: "index.html",
      variables,
    });

    expect(job.config.variables).toEqual(variables);
  });

  it("turns the page's capture motion blur off for the plan probe (R19)", () => {
    const job = buildSyntheticRenderJob({
      fps: { num: 30, den: 1 },
      format: "mp4",
      quality: "high",
      hdrMode: "force-sdr",
      entryFile: "index.html",
    });
    expect(job.config.pageMotionBlur).toBe("off");
  });

  it("keeps the production software-GPU launch on BeginFrame control", () => {
    const cfg = resolveDistributedEngineConfig({
      fps: 30,
      width: 320,
      height: 240,
      format: "mp4",
    });
    const forceScreenshot = applyConcreteGpuScreenshotClamp(
      cfg.forceScreenshot,
      "software",
      cfg,
      {},
    );
    const captureMode = forceScreenshot ? "screenshot" : "beginframe";
    const args = buildChromeArgs({ width: 320, height: 240, captureMode, platform: "linux" }, cfg);

    expect(forceScreenshot).toBe(false);
    expect(args).toContain("--enable-begin-frame-control");
  });
});

describe("resolveMaxParallelChunks", () => {
  const MP_1080P = (1920 * 1080) / 1e6;
  const THIRTY_MIN_30FPS = 54000;
  const LAMBDA_LIMIT = 900;
  const recordingLog = () => {
    const warnings: string[] = [];
    return { log: { ...defaultLogger, warn: (m: string) => warnings.push(m) }, warnings };
  };

  it("sizes 30 min of 1080p30 so every chunk fits the Lambda limit with margin", () => {
    const { log } = recordingLog();
    const maxParallel = resolveMaxParallelChunks(
      { workerTimeoutSeconds: LAMBDA_LIMIT, workerConcurrency: 8 },
      THIRTY_MIN_30FPS,
      MP_1080P,
      log,
    );
    const { chunkCount, effectiveChunkSize } = resolveChunkPlan(
      THIRTY_MIN_30FPS,
      undefined,
      maxParallel,
    );
    expect(chunkCount).toBeGreaterThan(DEFAULT_MAX_PARALLEL_CHUNKS);
    expect(estimateChunkSeconds(effectiveChunkSize, MP_1080P)).toBeLessThanOrEqual(
      LAMBDA_LIMIT * 0.75,
    );
    // The old fixed 16 planned chunks with no headroom left under the limit.
    const old = resolveChunkPlan(THIRTY_MIN_30FPS, undefined, DEFAULT_MAX_PARALLEL_CHUNKS);
    expect(estimateChunkSeconds(old.effectiveChunkSize, MP_1080P)).toBeGreaterThan(
      LAMBDA_LIMIT * 0.75,
    );
  });

  it("tells the user to raise --concurrency when the fitting chunk count exceeds it", () => {
    const { log, warnings } = recordingLog();
    const maxParallel = resolveMaxParallelChunks(
      { workerTimeoutSeconds: LAMBDA_LIMIT, workerConcurrency: 8 },
      THIRTY_MIN_30FPS,
      MP_1080P,
      log,
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(`--concurrency ${maxParallel}`);
  });

  it("goes one wave wide when concurrency allows, up to the 256 ceiling", () => {
    const { log, warnings } = recordingLog();
    const args = [3 * THIRTY_MIN_30FPS, MP_1080P, log] as const;
    expect(
      resolveMaxParallelChunks(
        { workerTimeoutSeconds: LAMBDA_LIMIT, workerConcurrency: 200 },
        ...args,
      ),
    ).toBe(200);
    expect(
      resolveMaxParallelChunks(
        { workerTimeoutSeconds: LAMBDA_LIMIT, workerConcurrency: 1000 },
        ...args,
      ),
    ).toBe(256);
    expect(warnings).toEqual([]);
  });

  it("keeps short renders to few chunks so per-chunk overhead does not dominate", () => {
    const { log } = recordingLog();
    const worker = { workerTimeoutSeconds: LAMBDA_LIMIT, workerConcurrency: 256 };
    expect(resolveMaxParallelChunks(worker, 60, MP_1080P, log)).toBe(1);
    expect(resolveMaxParallelChunks(worker, 300, MP_1080P, log)).toBeLessThanOrEqual(3);
    expect(resolveMaxParallelChunks(worker, 3600, MP_1080P, log)).toBeLessThan(64);
  });

  it("explicit maxParallelChunks wins and no worker inputs keeps the old default", () => {
    const worker = { workerTimeoutSeconds: LAMBDA_LIMIT, workerConcurrency: 200 };
    const args = [THIRTY_MIN_30FPS, MP_1080P] as const;
    expect(resolveMaxParallelChunks({ ...worker, maxParallelChunks: 4 }, ...args)).toBe(4);
    expect(resolveMaxParallelChunks({}, ...args)).toBe(DEFAULT_MAX_PARALLEL_CHUNKS);
    expect(resolveMaxParallelChunks({ chunkSize: 240 }, ...args)).toBe(DEFAULT_MAX_PARALLEL_CHUNKS);
  });

  it("caps pinned chunking at one wave across the worker concurrency", () => {
    const worker = { workerTimeoutSeconds: LAMBDA_LIMIT, workerConcurrency: 900 };
    const maxParallel = resolveMaxParallelChunks({ ...worker, chunkSize: 30 }, 1800, MP_1080P);
    expect(resolveChunkPlan(1800, 30, maxParallel).chunkCount).toBe(60);
    const args = [THIRTY_MIN_30FPS, MP_1080P] as const;
    expect(resolveMaxParallelChunks({ ...worker, targetChunkFrames: 300 }, ...args)).toBe(256);
  });

  it("sizes chunks from a measured frame cost so expensive frames fit the limit", () => {
    // 45 s of 1080x1920 at 24 fps whose frames measured ~10.5 s each (a graded video on software GL).
    const frames = 45 * 24;
    const mp = (1080 * 1920) / 1e6;
    const worker = { workerTimeoutSeconds: LAMBDA_LIMIT, workerConcurrency: 8 };
    const { log } = recordingLog();
    const priced = resolveChunkPlan(
      frames,
      undefined,
      resolveMaxParallelChunks(worker, frames, mp),
    );
    expect(estimateChunkSeconds(priced.effectiveChunkSize, mp, 10.5)).toBeGreaterThan(LAMBDA_LIMIT);

    const measured = resolveChunkPlan(
      frames,
      undefined,
      resolveMaxParallelChunks(worker, frames, mp, log, 10.5),
    );
    expect(estimateChunkSeconds(measured.effectiveChunkSize, mp, 10.5)).toBeLessThanOrEqual(
      LAMBDA_LIMIT * 0.75,
    );
    // A cheap measured frame keeps the per-pixel plan.
    expect(resolveMaxParallelChunks(worker, frames, mp, log, 0.07)).toBe(
      resolveMaxParallelChunks(worker, frames, mp, log),
    );
  });

  it("measures frame cost only for graded media and only when sizing uses it", () => {
    expect(planNeedsFrameCostMeasurement('<video data-color-grading=\'{"preset":"x"}\'>')).toBe(
      true,
    );
    expect(planNeedsFrameCostMeasurement("<video src=a.mp4>")).toBe(false);
    expect(chunkSizingUsesFrameCost({ workerTimeoutSeconds: LAMBDA_LIMIT })).toBe(true);
    expect(chunkSizingUsesFrameCost({ workerTimeoutSeconds: LAMBDA_LIMIT, chunkSize: 48 })).toBe(
      false,
    );
    expect(chunkSizingUsesFrameCost({})).toBe(false);
  });

  it("fails fast with a typed error when even 256 chunks cannot fit the limit", () => {
    const eightHours = 8 * 60 * 60 * 30;
    let caught: unknown;
    try {
      resolveMaxParallelChunks({ workerTimeoutSeconds: LAMBDA_LIMIT }, eightHours, MP_1080P);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ChunkExceedsWorkerTimeoutError);
    expect((caught as ChunkExceedsWorkerTimeoutError).code).toBe(CHUNK_EXCEEDS_WORKER_TIMEOUT);
    expect((caught as Error).message).toContain("900 s worker time limit");
    // A limit shorter than one chunk's fixed overhead can never fit.
    expect(() => resolveMaxParallelChunks({ workerTimeoutSeconds: 30 }, 300, MP_1080P)).toThrow(
      ChunkExceedsWorkerTimeoutError,
    );
  });
});

describe("resolveChunkPlan", () => {
  it("returns 1 chunk when totalFrames fits in configChunkSize", () => {
    const result = resolveChunkPlan(60, 240, 16);
    expect(result.chunkCount).toBe(1);
    expect(result.effectiveChunkSize).toBeGreaterThanOrEqual(60);
  });

  it("caps chunkCount at maxParallelChunks for very long renders", () => {
    // 54000 frames / 240 = 225 naive chunks → must cap at 16.
    const result = resolveChunkPlan(54000, 240, 16);
    expect(result.chunkCount).toBe(16);
    // 54000 / 16 = 3375 → chunkSize at least that big so the union covers
    // all frames in 16 slices.
    expect(result.effectiveChunkSize).toBeGreaterThanOrEqual(Math.ceil(54000 / 16));
  });

  it("naive count drives chunkCount when below cap", () => {
    // 600 frames / 240 = 3 naive chunks; well below the 16 cap.
    const result = resolveChunkPlan(600, 240, 16);
    expect(result.chunkCount).toBe(3);
    expect(result.effectiveChunkSize).toBe(240);
  });

  it("rejects non-positive totalFrames", () => {
    expect(() => resolveChunkPlan(0, 240, 16)).toThrow();
    expect(() => resolveChunkPlan(-1, 240, 16)).toThrow();
    expect(() => resolveChunkPlan(Number.NaN, 240, 16)).toThrow();
  });

  it("rejects non-positive configChunkSize / maxParallelChunks", () => {
    expect(() => resolveChunkPlan(60, 0, 16)).toThrow();
    expect(() => resolveChunkPlan(60, 240, 0)).toThrow();
  });

  it("rejects non-integer inputs (would produce fractional endFrames)", () => {
    expect(() => resolveChunkPlan(10.5, 240, 16)).toThrow(/positive integer/);
    expect(() => resolveChunkPlan(60, 240.5, 16)).toThrow(/positive integer/);
    expect(() => resolveChunkPlan(60, 240, 16.5)).toThrow(/positive integer/);
    expect(() => resolveChunkPlan(60, 240, Number.POSITIVE_INFINITY)).toThrow(/positive integer/);
  });

  // ── Auto-size when configChunkSize is undefined ───────────────────────
  // The auto-sizer picks `max(MIN_CHUNK_SIZE, ceil(totalFrames /
  // maxParallelChunks))` whenever the caller leaves `chunkSize` undefined,
  // honoring `maxParallelChunks` instead of clamping at a 240-frame default.

  it("explicit chunkSize wins: 660 frames + chunkSize=240 + maxParallelChunks=16 → 3 chunks", () => {
    // Regression guard for the "explicit number still works" half of the
    // contract — passing 240 explicitly must not get auto-sized.
    const result = resolveChunkPlan(660, 240, 16);
    expect(result.chunkCount).toBe(3);
    expect(result.effectiveChunkSize).toBe(240);
  });

  it("auto-sizes when chunkSize=undefined: 660 frames + maxParallelChunks=16 → 16 chunks", () => {
    // ceil(660 / 16) = 42; max(MIN_CHUNK_SIZE=10, 42) = 42. naiveCount =
    // ceil(660 / 42) = 16, which lands exactly at the cap.
    const result = resolveChunkPlan(660, undefined, 16);
    expect(result.chunkCount).toBe(16);
    expect(result.effectiveChunkSize).toBe(42);
  });

  it("auto-size floor: tiny renders cap at MIN_CHUNK_SIZE rather than fragmenting infinitely", () => {
    // 50 frames / 16 workers naively gives a 4-frame chunk size, which
    // would produce 13 chunks of 4 frames each — per-chunk fixed overhead
    // dwarfs the parallelism gain. The MIN_CHUNK_SIZE=10 floor pins
    // chunkSize at 10, producing ceil(50/10) = 5 chunks instead.
    const result = resolveChunkPlan(50, undefined, 16);
    expect(result.chunkCount).toBe(5);
    expect(result.effectiveChunkSize).toBe(MIN_CHUNK_SIZE);
  });

  it("tightens chunkCount so an explicit small chunkSize leaves no empty trailing slice", () => {
    // 121 frames, chunkSize=10, maxParallelChunks=12: ceil(121/10)=13 naive →
    // capped at 12, but effectiveChunkSize rounds up to ceil(121/12)=11. Eleven
    // 11-frame chunks already cover [0,121), so a 12th would be the empty slice
    // [121,121) that renderChunk rejects (framesInChunk <= 0). chunkCount must
    // tighten to 11.
    const result = resolveChunkPlan(121, 10, 12);
    expect(result.effectiveChunkSize).toBe(11);
    expect(result.chunkCount).toBe(11);
    const slices = buildChunkSlices(121, result.chunkCount, result.effectiveChunkSize);
    expect(slices).toHaveLength(11);
    expect(slices[slices.length - 1]).toEqual({ index: 10, startFrame: 110, endFrame: 121 });
  });

  it("never emits an empty or inverted slice across a grid of explicit chunk sizes", () => {
    for (const totalFrames of [37, 50, 121, 333, 1000, 4001]) {
      for (const maxParallel of [2, 4, 12, 16, 40]) {
        for (const chunkSize of [10, 11, 15, 24, 100]) {
          const { chunkCount, effectiveChunkSize } = resolveChunkPlan(
            totalFrames,
            chunkSize,
            maxParallel,
          );
          expect(chunkCount).toBeLessThanOrEqual(maxParallel);
          const slices = buildChunkSlices(totalFrames, chunkCount, effectiveChunkSize);
          let cursor = 0;
          for (const s of slices) {
            expect(s.startFrame).toBe(cursor); // contiguous from 0
            expect(s.endFrame).toBeGreaterThan(s.startFrame); // non-empty
            cursor = s.endFrame;
          }
          expect(cursor).toBe(totalFrames); // union is exactly [0, totalFrames)
        }
      }
    }
  });

  // ── targetChunkFrames (optional per-chunk frame ceiling) ──

  it("targetChunkFrames omitted is a no-op: identical to the 3-arg auto-sized result", () => {
    // The default path must be byte-identical whether the 4th arg is absent or
    // explicitly undefined.
    for (const totalFrames of [50, 660, 1466, 54000]) {
      for (const maxParallel of [8, 16, 64]) {
        const base = resolveChunkPlan(totalFrames, undefined, maxParallel);
        const withUndef = resolveChunkPlan(totalFrames, undefined, maxParallel, undefined);
        expect(withUndef).toEqual(base);
      }
    }
  });

  it("targetChunkFrames collapses a short video to fewer chunks than the parallelism cap", () => {
    // 1466 frames, target 300, cap 16: ceil(1466/300)=5 chunks (not 16), each
    // ~293 frames. Fewer chunks → less per-chunk fixed overhead.
    const result = resolveChunkPlan(1466, undefined, 16, 300);
    expect(result.chunkCount).toBe(5);
    expect(result.effectiveChunkSize).toBeLessThanOrEqual(300);
  });

  it("targetChunkFrames bounds a long video's per-chunk frames, adding chunks up to the cap", () => {
    // 54000 frames (30 min @30fps), target 1600, cap 64: ceil(54000/1600)=34
    // chunks, each <= 1600 frames so per-chunk render time stays under budget.
    const result = resolveChunkPlan(54000, undefined, 64, 1600);
    expect(result.chunkCount).toBe(34);
    expect(result.effectiveChunkSize).toBeLessThanOrEqual(1600);
  });

  it("targetChunkFrames is clamped by maxParallelChunks: an extreme length stays at the cap (still over budget)", () => {
    // 216000 frames (2 h), target 1600, cap 64: needs 135 chunks but clamps to
    // 64; per-chunk frames then exceed the target — the genuine tier ceiling.
    const result = resolveChunkPlan(216000, undefined, 64, 1600);
    expect(result.chunkCount).toBe(64);
    expect(result.effectiveChunkSize).toBeGreaterThan(1600);
  });

  it("explicit chunkSize wins over targetChunkFrames (targetChunkFrames is a no-op)", () => {
    const withTarget = resolveChunkPlan(54000, 240, 64, 1600);
    const chunkSizeOnly = resolveChunkPlan(54000, 240, 64);
    expect(withTarget).toEqual(chunkSizeOnly);
  });

  it("rejects a non-positive or non-integer targetChunkFrames", () => {
    expect(() => resolveChunkPlan(1466, undefined, 16, 0)).toThrow(/positive integer/);
    expect(() => resolveChunkPlan(1466, undefined, 16, -100)).toThrow(/positive integer/);
    expect(() => resolveChunkPlan(1466, undefined, 16, 300.5)).toThrow(/positive integer/);
  });

  it("never emits an empty or inverted slice across a grid of targetChunkFrames", () => {
    for (const totalFrames of [37, 660, 1466, 12793, 54000]) {
      for (const maxParallel of [8, 16, 64]) {
        for (const target of [100, 300, 1600]) {
          const { chunkCount, effectiveChunkSize } = resolveChunkPlan(
            totalFrames,
            undefined,
            maxParallel,
            target,
          );
          expect(chunkCount).toBeGreaterThanOrEqual(1);
          expect(chunkCount).toBeLessThanOrEqual(maxParallel);
          const slices = buildChunkSlices(totalFrames, chunkCount, effectiveChunkSize);
          let cursor = 0;
          for (const s of slices) {
            expect(s.startFrame).toBe(cursor);
            expect(s.endFrame).toBeGreaterThan(s.startFrame);
            cursor = s.endFrame;
          }
          expect(cursor).toBe(totalFrames);
        }
      }
    }
  });
});

describe("plan() and page motion blur (R19)", () => {
  const planCaptureMode = async (html: string, name: string) => {
    const dir = join(runRoot, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), html, "utf-8");
    const planDir = join(runRoot, `${name}-plan`);
    await plan(dir, { fps: 30, width: 320, height: 240, format: "mp4" }, planDir);
    const meta = JSON.parse(readFileSync(join(planDir, "meta", "encoder.json"), "utf-8"));
    return { captureMode: meta.captureMode ?? null, forceScreenshot: meta.forceScreenshot ?? null };
  };

  it("does not route a data-motion-blur composition through screenshot capture", async () => {
    const blur = FIXTURE_HTML.replace(
      'data-composition-id="root"',
      'data-composition-id="root" data-motion-blur="on"',
    );
    const plain = await planCaptureMode(FIXTURE_HTML, "blur-plain");
    const blurred = await planCaptureMode(blur, "blur-on");
    expect(blurred).toEqual(plain);
  }, 30_000);
});

describe("buildChunkSlices", () => {
  it("produces consecutive non-overlapping ranges covering all frames", () => {
    const slices = buildChunkSlices(700, 3, 240);
    expect(slices).toHaveLength(3);
    expect(slices[0]).toEqual({ index: 0, startFrame: 0, endFrame: 240 });
    expect(slices[1]).toEqual({ index: 1, startFrame: 240, endFrame: 480 });
    // Last chunk absorbs the remainder so endFrame === totalFrames exactly.
    expect(slices[2]).toEqual({ index: 2, startFrame: 480, endFrame: 700 });
  });

  it("handles a single-chunk render", () => {
    const slices = buildChunkSlices(50, 1, 240);
    expect(slices).toHaveLength(1);
    expect(slices[0]).toEqual({ index: 0, startFrame: 0, endFrame: 50 });
  });
});

describe("plan() defaults", () => {
  it("exports the documented chunking defaults", () => {
    expect(DEFAULT_CHUNK_SIZE).toBe(240);
    expect(DEFAULT_MAX_PARALLEL_CHUNKS).toBe(16);
    expect(MIN_CHUNK_SIZE).toBe(10);
  });

  it("sizes chunks from the worker inputs the adapter passes", async () => {
    const config = { fps: 30, width: 320, height: 240, format: "mp4" } as const;
    const fixed = await plan(projectDir, config, join(runRoot, "plan-fixed-16"));
    const sized = await plan(
      projectDir,
      { ...config, workerTimeoutSeconds: 900, workerConcurrency: 8 },
      join(runRoot, "plan-worker-sized"),
    );
    expect(fixed.chunkCount).toBe(3);
    expect(sized.chunkCount).toBe(1);
  }, 30_000);

  it("splits graded media into more chunks from its measured frame cost", async () => {
    const measuredFor: string[] = [];
    mock.module("./planFrameCost.js", () => ({
      measurePlanSecondsPerFrame: async (input: { html: string }) => {
        measuredFor.push(input.html);
        return 10;
      },
    }));
    const graded = join(runRoot, "project-graded");
    mkdirSync(graded, { recursive: true });
    writeFileSync(
      join(graded, "index.html"),
      FIXTURE_HTML.replace("<p>", `<p data-color-grading='{"exposure":0.2}'>`),
      "utf-8",
    );
    const config = {
      fps: 30,
      width: 320,
      height: 240,
      format: "mp4",
      workerTimeoutSeconds: 900,
      workerConcurrency: 8,
    } as const;
    const cheap = await plan(projectDir, config, join(runRoot, "plan-cheap"));
    expect(measuredFor).toHaveLength(0);
    const costly = await plan(graded, config, join(runRoot, "plan-graded"));
    expect(measuredFor).toHaveLength(1);
    expect(cheap.chunkCount).toBe(1);
    // 30 frames at 10 s each split as far as the 10-frame chunk floor allows.
    expect(costly.chunkCount).toBe(3);
  }, 30_000);

  it("rejects at plan time when no chunk can finish inside the worker limit", async () => {
    await expect(
      plan(
        projectDir,
        { fps: 30, width: 320, height: 240, format: "mp4", workerTimeoutSeconds: 30 },
        join(runRoot, "plan-too-slow"),
      ),
    ).rejects.toBeInstanceOf(ChunkExceedsWorkerTimeoutError);
  }, 30_000);
});

describe("plan() — golden planDir + planHash determinism", () => {
  // Each `plan()` call is reasonably expensive (compile pass parses + inlines
  // the HTML), so we run it once for the layout assertions and once more for
  // the determinism assertion. The 30s timeout absorbs cold-start font /
  // runtime resolution variance on the CI host.
  const TIMEOUT_MS = 30_000;

  it(
    "fails closed when an open-ended distributed video source cannot be extracted",
    async () => {
      const brokenProjectDir = join(runRoot, "broken-video-project");
      const brokenPlanDir = join(runRoot, "broken-video-plan");
      mkdirSync(brokenProjectDir, { recursive: true });
      mkdirSync(brokenPlanDir, { recursive: true });
      writeFileSync(
        join(brokenProjectDir, "index.html"),
        `<!doctype html>
<div data-composition-id="root" data-width="320" data-height="240" data-duration="1">
  <video id="hero" src="missing.mp4" data-start="0"></video>
</div>`,
      );

      let caught: unknown;
      try {
        await plan(
          brokenProjectDir,
          { fps: 30, width: 320, height: 240, format: "mp4", chunkSize: 240 },
          brokenPlanDir,
        );
      } catch (err) {
        caught = err;
      }

      expect(caught).toHaveProperty("name", "VideoExtractionStageError");
      expect(caught).toHaveProperty("code", "VIDEO_SOURCE_UNRENDERABLE");
      expect(caught).toHaveProperty("retryable", false);
      expect(existsSync(join(brokenPlanDir, "meta", "videos.json"))).toBe(false);
    },
    TIMEOUT_MS,
  );

  it(
    "maps an open-ended remote video HTTP 404 to a terminal source error",
    async () => {
      const brokenProjectDir = join(runRoot, "remote-404-video-project");
      const brokenPlanDir = join(runRoot, "remote-404-video-plan");
      mkdirSync(brokenProjectDir, { recursive: true });
      mkdirSync(brokenPlanDir, { recursive: true });
      writeFileSync(
        join(brokenProjectDir, "index.html"),
        `<!doctype html>
<div data-composition-id="root" data-width="320" data-height="240" data-duration="1">
  <video id="hero" src="https://cdn.example/missing.mp4" data-start="0"></video>
</div>`,
      );
      let fetchCalls = 0;
      _setDownloadFetchForTests((async () => {
        fetchCalls += 1;
        return new Response(null, { status: 404, statusText: "Not Found" });
      }) as never);

      let caught: unknown;
      try {
        await plan(
          brokenProjectDir,
          { fps: 30, width: 320, height: 240, format: "mp4", chunkSize: 240 },
          brokenPlanDir,
        );
      } catch (err) {
        caught = err;
      } finally {
        _setDownloadFetchForTests();
      }

      expect(fetchCalls).toBeGreaterThan(0);
      expect(caught).toHaveProperty("name", "VideoExtractionStageError");
      expect(caught).toHaveProperty("code", "VIDEO_SOURCE_UNRENDERABLE");
      expect(caught).toHaveProperty("retryable", false);
      expect(existsSync(join(brokenPlanDir, "meta", "videos.json"))).toBe(false);
    },
    TIMEOUT_MS,
  );

  it(
    "produces the documented planDir layout",
    async () => {
      const planDir = join(runRoot, "plan-layout");
      mkdirSync(planDir, { recursive: true });
      // Pin chunkSize=240 so this fixture exercises the single-chunk path
      // (totalFrames=30 → ceil(30/240)=1 chunk). The auto-sized variant
      // (chunkSize=undefined) is exercised by the dedicated test below.
      const result = await plan(
        projectDir,
        { fps: 30, width: 320, height: 240, format: "mp4", chunkSize: 240 },
        planDir,
      );

      // planDir directory layout
      expect(existsSync(join(planDir, "plan.json"))).toBe(true);
      expect(existsSync(join(planDir, "compiled", "index.html"))).toBe(true);
      expect(existsSync(join(planDir, "video-frames"))).toBe(true);
      // No audio in the fixture — audio.m4a must NOT exist.
      expect(existsSync(join(planDir, "audio.m4a"))).toBe(false);
      expect(existsSync(join(planDir, "meta", "composition.json"))).toBe(true);
      expect(existsSync(join(planDir, "meta", "encoder.json"))).toBe(true);
      expect(existsSync(join(planDir, "meta", "chunks.json"))).toBe(true);
      // The temporary work tree must be cleaned up.
      expect(existsSync(join(planDir, ".plan-work"))).toBe(false);

      // ── PlanResult contract ─────────────────────────────────────────────
      expect(result.planDir).toBe(planDir);
      expect(result.planProtocol).toEqual(CURRENT_PLAN_PROTOCOL);
      expect(result.planHash).toMatch(/^[0-9a-f]{64}$/);
      expect(result.chunkCount).toBe(1);
      expect(result.totalFrames).toBe(30); // 1s @ 30fps
      expect(result.width).toBe(320);
      expect(result.height).toBe(240);
      expect(result.format).toBe("mp4");
      expect(result.ffmpegVersion).toMatch(/ffmpeg/i);
      expect(result.producerVersion).toMatch(/^\d+\.\d+\.\d+/);

      // ── chunks.json shape ───────────────────────────────────────────────
      const chunks = JSON.parse(
        readFileSync(join(planDir, "meta", "chunks.json"), "utf-8"),
      ) as Array<{ index: number; startFrame: number; endFrame: number }>;
      expect(chunks).toHaveLength(result.chunkCount);
      // Slices must cover [0, totalFrames) with no gaps.
      let cursor = 0;
      for (const chunk of chunks) {
        expect(chunk.startFrame).toBe(cursor);
        cursor = chunk.endFrame;
      }
      expect(cursor).toBe(result.totalFrames);

      // ── plan.json shape ─────────────────────────────────────────────────
      const planJson = JSON.parse(readFileSync(join(planDir, "plan.json"), "utf-8")) as Record<
        string,
        unknown
      >;
      expect(planJson.planHash).toBe(result.planHash);
      expect(planJson.protocol).toEqual(CURRENT_PLAN_PROTOCOL);
      expect(planJson.hasAudio).toBe(false);
      expect(planJson.totalFrames).toBe(result.totalFrames);
    },
    TIMEOUT_MS,
  );

  it(
    "auto-sizes chunkSize end-to-end when caller omits it",
    async () => {
      // Integration check that the auto-sizer wired through plan() actually
      // produces multi-chunk output for the same fixture that single-chunks
      // when chunkSize is pinned. With totalFrames=30 and the default
      // maxParallelChunks=16, the auto-sizer picks
      // max(MIN_CHUNK_SIZE=10, ceil(30/16)=2) = 10 → ceil(30/10) = 3 chunks.
      const planDir = join(runRoot, "plan-autosized");
      mkdirSync(planDir, { recursive: true });
      const result = await plan(
        projectDir,
        { fps: 30, width: 320, height: 240, format: "mp4" },
        planDir,
      );
      expect(result.chunkCount).toBe(3);
      const chunks = JSON.parse(
        readFileSync(join(planDir, "meta", "chunks.json"), "utf-8"),
      ) as Array<{ index: number; startFrame: number; endFrame: number }>;
      expect(chunks).toHaveLength(3);
      // Encoder gopSize must follow the auto-sized chunk so chunk-boundary
      // IDR keyframes still land at frame 0 of each chunk.
      const encoder = JSON.parse(
        readFileSync(join(planDir, "meta", "encoder.json"), "utf-8"),
      ) as Record<string, unknown>;
      expect(encoder.gopSize).toBe(10);
      expect(encoder.chunkSize).toBe(10);
    },
    TIMEOUT_MS,
  );

  it(
    "shares one byte-identical execution plan between the builder and legacy v1 wrapper",
    async () => {
      const planDirA = join(runRoot, "plan-determinism-a");
      const planDirB = join(runRoot, "plan-determinism-b");
      mkdirSync(planDirA, { recursive: true });
      mkdirSync(planDirB, { recursive: true });

      const config = { fps: 30 as const, width: 320, height: 240, format: "mp4" as const };
      const a = await buildLocalExecutionPlan(projectDir, config, planDirA);
      const b = await plan(projectDir, config, planDirB);

      expect(a.executionPlanDir).toBe(planDirA);
      expect(a.executionPlanHash).toBe(b.planHash);
      expect(a.chunkCount).toBe(b.chunkCount);
      expect(a.totalFrames).toBe(b.totalFrames);
      expect(Object.keys(b)).toEqual([
        "planDir",
        "planProtocol",
        "planHash",
        "chunkCount",
        "totalFrames",
        "fps",
        "width",
        "height",
        "format",
        "ffmpegVersion",
        "producerVersion",
      ]);

      // Encoder JSON must be byte-identical — its bytes feed planHash, so any
      // drift here would silently change the hash framing.
      const encoderA = readFileSync(join(planDirA, "meta", "encoder.json"));
      const encoderB = readFileSync(join(planDirB, "meta", "encoder.json"));
      expect(encoderA.equals(encoderB)).toBe(true);
    },
    TIMEOUT_MS,
  );

  it(
    "plan.json.planHash matches recomputePlanHashFromPlanDir(planDir) on the same disk",
    async () => {
      // Regression guard for a real-world bug observed on audio-bearing
      // fixtures: plan() left a temporary `.plan-work/` subtree inside
      // planDir while freezePlan walked it, so the hash baked into
      // plan.json included artifacts the chunk worker would never see.
      // The chunk worker's `recomputePlanHashFromPlanDir` walk then
      // returned a different hash, tripping PLAN_HASH_MISMATCH at the
      // first chunk invocation.
      //
      // This test verifies that the hash plan() writes matches the hash
      // recomputed from the on-disk planDir contents — i.e. the chunk
      // worker's view. Holds for any plan, audio or not.
      const planDir = join(runRoot, "plan-hash-recompute");
      mkdirSync(planDir, { recursive: true });
      const result = await plan(
        projectDir,
        { fps: 30, width: 320, height: 240, format: "mp4" },
        planDir,
      );
      const recomputed = recomputePlanHashFromPlanDir(planDir);
      expect(recomputed).toBe(result.planHash);
      const planJson = JSON.parse(readFileSync(join(planDir, "plan.json"), "utf-8")) as {
        planHash: string;
        protocol?: unknown;
      };
      expect(planJson.planHash).toBe(result.planHash);
      expect(planJson.protocol).toEqual(CURRENT_PLAN_PROTOCOL);

      delete planJson.protocol;
      writeFileSync(join(planDir, "plan.json"), `${JSON.stringify(planJson, null, 2)}\n`, "utf-8");
      expect(recomputePlanHashFromPlanDir(planDir)).toBe(result.planHash);

      planJson.protocol = CURRENT_PLAN_PROTOCOL;
      writeFileSync(join(planDir, "plan.json"), `${JSON.stringify(planJson, null, 2)}\n`, "utf-8");
      expect(recomputePlanHashFromPlanDir(planDir)).toBe(result.planHash);
    },
    TIMEOUT_MS,
  );

  // Audio-bearing variant of the planHash recompute test. The pre-fix bug
  // surfaced because `runAudioStage` downloads/mixes source audio into
  // `<planDir>/.plan-work/`, and `freezePlan` walked that subtree before
  // plan.ts cleaned it up. A composition without `<audio>` short-circuits
  // the audio stage and never materialises `.plan-work/downloads/`, so
  // the no-audio test above would pass even on the broken code. This
  // variant generates a 1s silent wav via `ffmpeg`, references it from
  // the composition, and runs plan() — exercising the audio-mix path
  // that produced the original bug.
  const HAS_FFMPEG = spawnSync(getFfmpegBinary(), ["-version"]).status === 0;

  it.skipIf(!HAS_FFMPEG)(
    "plan.json.planHash matches recompute on an audio-bearing composition",
    async () => {
      const audioProjectDir = join(runRoot, "project-with-audio");
      mkdirSync(audioProjectDir, { recursive: true });
      // Generate a 1s mono silent wav. PCM keeps the file tiny without
      // pulling in an audio asset fixture.
      const audioPath = join(audioProjectDir, "silence.wav");
      ffmpegOrThrow([
        "-f",
        "lavfi",
        "-i",
        "anullsrc=channel_layout=mono:sample_rate=44100",
        "-t",
        "1",
        "-c:a",
        "pcm_s16le",
        audioPath,
      ]);
      writeFileSync(
        join(audioProjectDir, "index.html"),
        `<!doctype html>
<html><head><meta charset="utf-8"></head><body>
  <div data-composition-id="root" data-width="320" data-height="240" data-duration="1">
    <audio data-composition-audio src="silence.wav"></audio>
    <p>audio-bearing fixture</p>
  </div>
</body></html>`,
        "utf-8",
      );

      const planDir = join(runRoot, "plan-hash-recompute-audio");
      mkdirSync(planDir, { recursive: true });
      const result = await plan(
        audioProjectDir,
        { fps: 30, width: 320, height: 240, format: "mp4" },
        planDir,
      );
      const recomputed = recomputePlanHashFromPlanDir(planDir);
      // This assertion fails on the pre-fix code: freezePlan saw
      // `.plan-work/downloads/` (or whatever the audio stage leaves
      // behind) inside planDir, baked it into plan.json's planHash,
      // and then plan.ts rm'd it — so recompute walks a different
      // file set than freezePlan did.
      expect(recomputed).toBe(result.planHash);
      // Verify the audio stage actually fired (otherwise the test
      // pins the wrong path — the same false-pass mode as the
      // no-audio variant above).
      expect(existsSync(join(planDir, "audio.m4a"))).toBe(true);
    },
    TIMEOUT_MS,
  );

  it.skipIf(!HAS_FFMPEG)(
    "plans a video-bearing project to the same planHash from different plan folders",
    async () => {
      const videoProjectDir = join(runRoot, "project-with-video");
      mkdirSync(videoProjectDir, { recursive: true });
      ffmpegOrThrow([
        "-f",
        "lavfi",
        "-i",
        "testsrc=size=320x240:rate=30:duration=1",
        "-pix_fmt",
        "yuv420p",
        "-c:v",
        "libx264",
        join(videoProjectDir, "clip.mp4"),
      ]);
      writeFileSync(
        join(videoProjectDir, "index.html"),
        `<!doctype html>
<div data-composition-id="root" data-width="320" data-height="240" data-duration="1">
  <video id="clip" src="clip.mp4" data-start="0" muted></video>
</div>`,
        "utf-8",
      );

      const config = { fps: 30 as const, width: 320, height: 240, format: "mp4" as const };
      const dirA = join(runRoot, "plan-video-a");
      const dirB = join(runRoot, "nested", "plan-video-b");
      for (const dir of [dirA, dirB]) mkdirSync(dir, { recursive: true });
      const a = await plan(videoProjectDir, config, dirA);
      const b = await plan(videoProjectDir, config, dirB);

      expect(a.planHash).toBe(b.planHash);
      const videosJson = (dir: string) => readFileSync(join(dir, "meta", "videos.json"), "utf-8");
      expect(videosJson(dirB)).toBe(videosJson(dirA));
      expect(JSON.parse(videosJson(dirA)).extracted[0].srcPath).toBe("compiled/clip.mp4");
    },
    TIMEOUT_MS,
  );
});

describe.skipIf(spawnSync(getFfmpegBinary(), ["-version"]).status !== 0)(
  "stitched mp4 plans",
  () => {
    function audioProject(name: string, amplitude = 0.99, duration = 1): string {
      const dir = join(runRoot, name);
      mkdirSync(dir, { recursive: true });
      const tone = spawnSync(getFfmpegBinary(), [
        "-nostdin",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        `aevalsrc=${amplitude}*sin(2*PI*440*t):s=48000:d=0.6`,
        "-c:a",
        "pcm_s16le",
        join(dir, "tone.wav"),
      ]);
      if (tone.status !== 0) throw new Error(`ffmpeg tone failed: ${tone.stderr}`);
      writeFileSync(
        join(dir, "index.html"),
        `<!doctype html><html><head><meta charset="utf-8"></head><body>
  <div data-composition-id="root" data-width="320" data-height="240" data-duration="${duration}">
    <audio data-composition-audio src="tone.wav"></audio>
  </div></body></html>`,
      );
      return dir;
    }

    it("fits the audio length and peak and records the layout only for mp4 without cfr", async () => {
      const project = audioProject("project-stitch");
      const config = { fps: 30, width: 320, height: 240, format: "mp4" } as const;
      const stitched = join(runRoot, "plan-stitch");
      await buildLocalExecutionPlan(project, config, stitched, { chunksCarryAudio: true });
      const encoder = JSON.parse(readFileSync(join(stitched, "meta", "encoder.json"), "utf-8"));
      expect(encoder.chunksCarryAudio).toBe(true);
      const probe = spawnSync(
        getFfprobeBinary(),
        [
          "-v",
          "error",
          "-show_entries",
          "format=duration",
          "-of",
          "csv=p=0",
          join(stitched, "audio.m4a"),
        ],
        { encoding: "utf-8" },
      );
      expect(Math.abs(Number(probe.stdout) - 1)).toBeLessThan(0.001);
      const volume = spawnSync(
        getFfmpegBinary(),
        ["-nostdin", "-i", join(stitched, "audio.m4a"), "-af", "volumedetect", "-f", "null", "-"],
        { encoding: "utf-8" },
      );
      expect(Number(/max_volume: (-?[\d.]+) dB/.exec(volume.stderr)?.[1])).toBeLessThan(-1);

      const withCfr = join(runRoot, "plan-stitch-cfr");
      await buildLocalExecutionPlan(project, { ...config, cfr: true }, withCfr, {
        chunksCarryAudio: true,
      });
      const cfrEncoder = JSON.parse(readFileSync(join(withCfr, "meta", "encoder.json"), "utf-8"));
      expect(cfrEncoder.chunksCarryAudio).toBeUndefined();
    }, 60_000);

    it("leaves the audio to buildPlanAudio, which makes the track the plan would", async () => {
      // A hot tone, so the true-peak hold re-encodes as well.
      const project = audioProject("project-separate-audio");
      const config = { fps: 30, width: 320, height: 240, format: "mp4" } as const;
      const carried = join(runRoot, "plan-carried-audio");
      await buildLocalExecutionPlan(project, config, carried, { chunksCarryAudio: true });

      const separate = join(runRoot, "plan-separate-audio");
      await buildLocalExecutionPlan(project, config, separate, {
        chunksCarryAudio: true,
        deferAudio: true,
      });
      const encoder = JSON.parse(readFileSync(join(separate, "meta", "encoder.json"), "utf-8"));
      expect([encoder.chunksCarryAudio, encoder.separateAudio]).toEqual([undefined, true]);
      expect(existsSync(join(separate, "audio.m4a"))).toBe(false);

      const work = join(runRoot, "separate-audio-work");
      mkdirSync(work, { recursive: true });
      const audio = join(work, "audio.m4a");
      expect(await buildPlanAudio(project, config, work, audio)).toEqual({ hasAudio: true });
      expect(readFileSync(audio).equals(readFileSync(join(carried, "audio.m4a")))).toBe(true);

      const withCfr = join(runRoot, "plan-separate-audio-cfr");
      await buildLocalExecutionPlan(project, { ...config, cfr: true }, withCfr, {
        deferAudio: true,
      });
      const cfrEncoder = JSON.parse(readFileSync(join(withCfr, "meta", "encoder.json"), "utf-8"));
      expect(cfrEncoder.separateAudio).toBeUndefined();
      expect(existsSync(join(withCfr, "audio.m4a"))).toBe(true);
    }, 60_000);

    it("logs the audio phases to the plan's logger", async () => {
      const project = audioProject("project-audio-phases-log");
      const info = mock(() => {});
      const logger = { ...defaultLogger, info };
      const work = join(runRoot, "audio-phases-log-work");
      mkdirSync(work, { recursive: true });
      const config = { fps: 30, width: 320, height: 240, format: "mp4", logger } as const;
      await buildPlanAudio(project, config, work, join(work, "audio.m4a"));
      expect(info.mock.calls.map(([message]) => message)).toContain("[audio] phases");
    }, 60_000);

    it("leaves webm and mov audio to buildPlanAudio too; png-sequence keeps its own", async () => {
      const project = audioProject("project-separate-audio-formats");
      const config = { fps: 30, width: 320, height: 240 } as const;
      for (const [format, separate] of [
        ["webm", true],
        ["mov", true],
        ["png-sequence", false],
      ] as const) {
        const dir = join(runRoot, `plan-separate-audio-${format}`);
        await buildLocalExecutionPlan(project, { ...config, format }, dir, { deferAudio: true });
        const encoder = JSON.parse(readFileSync(join(dir, "meta", "encoder.json"), "utf-8"));
        expect({ format, separate: encoder.separateAudio === true }).toEqual({ format, separate });
        expect({ format, mixed: existsSync(join(dir, "audio.m4a")) }).toEqual({
          format,
          mixed: !separate,
        });
      }
    }, 60_000);

    it("locks each ProRes profile's preset and pixel format into a mov plan", async () => {
      const project = audioProject("project-prores-profiles");
      const config = { fps: 30, width: 320, height: 240, format: "mov" } as const;
      const locked: Record<string, unknown> = {};
      for (const proresProfile of [undefined, "4444", "hq", "422", "lt", "proxy"] as const) {
        const dir = join(runRoot, `plan-prores-${proresProfile ?? "default"}`);
        await buildLocalExecutionPlan(project, { ...config, proresProfile }, dir, {
          deferAudio: true,
        });
        const {
          preset,
          pixelFormat,
          proresProfile: lockedProfile,
        } = JSON.parse(readFileSync(join(dir, "meta", "encoder.json"), "utf-8"));
        locked[proresProfile ?? "default"] = { preset, pixelFormat, lockedProfile };
      }
      expect(locked).toEqual({
        default: { preset: "4444", pixelFormat: "yuva444p10le" },
        "4444": { preset: "4444", pixelFormat: "yuva444p10le" },
        hq: { preset: "3", pixelFormat: "yuv422p10le", lockedProfile: "hq" },
        "422": { preset: "2", pixelFormat: "yuv422p10le", lockedProfile: "422" },
        lt: { preset: "1", pixelFormat: "yuv422p10le", lockedProfile: "lt" },
        proxy: { preset: "0", pixelFormat: "yuv422p10le", lockedProfile: "proxy" },
      });
    }, 120_000);

    for (const slot of [
      { name: "starts on the timeline", start: 0, duration: 1 },
      { name: "starts before the timeline", start: -0.5, duration: 1.5 },
    ]) {
      it(`gives buildPlanAudio the sound of a video whose src the scene script sets and that ${slot.name}`, async () => {
        const project = join(runRoot, `project-script-src-${slot.start}`);
        mkdirSync(project, { recursive: true });
        const clip = spawnSync(getFfmpegBinary(), [
          "-nostdin",
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          "testsrc=s=320x240:r=30:d=1",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=440:sample_rate=48000:d=1",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-shortest",
          join(project, "clip.mp4"),
        ]);
        if (clip.status !== 0) throw new Error(`ffmpeg clip failed: ${clip.stderr}`);
        writeFileSync(
          join(project, "index.html"),
          `<!doctype html><html><head><meta charset="utf-8"></head><body>
  <div data-composition-id="root" data-width="320" data-height="240" data-duration="1" data-no-timeline>
    <video id="v" data-has-audio="true" data-start="${slot.start}" data-duration="${slot.duration}" playsinline></video>
  </div>
  <script>document.getElementById("v").src = "clip.mp4";</script></body></html>`,
        );
        const config = { fps: 30, width: 320, height: 240, format: "mp4" } as const;
        const carried = join(runRoot, `plan-script-src-${slot.start}`);
        await buildLocalExecutionPlan(project, config, carried, { chunksCarryAudio: true });
        const work = join(runRoot, `script-src-work-${slot.start}`);
        mkdirSync(work, { recursive: true });
        const audio = join(work, "audio.m4a");
        expect(await buildPlanAudio(project, config, work, audio)).toEqual({ hasAudio: true });
        expect(readFileSync(audio).equals(readFileSync(join(carried, "audio.m4a")))).toBe(true);
      }, 60_000);
    }

    it("keeps assembled loudness within 0.1 LUFS of the frame-fitted float delivery", async () => {
      const project = audioProject("project-loudness-delivery", 0.3, 3.01);
      ffmpegOrThrow([
        "-f",
        "lavfi",
        "-i",
        "anoisesrc=seed=2:amplitude=0.8:sample_rate=48000:duration=3.01",
        "-af",
        "pan=stereo|c0=c0|c1=c0",
        "-c:a",
        "pcm_f32le",
        "-y",
        join(project, "tone.wav"),
      ]);
      const video = join(runRoot, "loudness-video.mp4");
      ffmpegOrThrow([
        "-f",
        "lavfi",
        "-i",
        "color=black:size=320x240:rate=30",
        "-frames:v",
        "91",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-y",
        video,
      ]);
      const config = { fps: 30, width: 320, height: 240, format: "mp4", chunkSize: 1000 } as const;
      const planDir = join(runRoot, "plan-loudness-delivery");
      const planned = await buildLocalExecutionPlan(project, config, planDir);
      expect(planned.totalFrames).toBe(91);
      expect(planned.chunkCount).toBe(1);
      const delivered = join(runRoot, "loudness-delivered.mp4");
      await assemble(planDir, [video], join(planDir, "audio.m4a"), delivered);
      const reference = join(runRoot, "loudness-reference.m4a");
      const encoded = await encodeAac(join(project, "tone.wav"), reference, 91 / 30, {
        timeout: 30_000,
        filter: "apad,atrim=0:3.033333",
      });
      expect(encoded.success, encoded.stderr).toBe(true);
      const held = await constrainAacTruePeak({
        audioPath: reference,
        sourcePath: join(project, "tone.wav"),
        targetDurationSeconds: 91 / 30,
      });
      expect(held.success, held.error).toBe(true);
      const measure = (path: string) => {
        const result = spawnSync(
          getFfmpegBinary(),
          ["-nostdin", "-i", path, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"],
          { encoding: "utf-8" },
        );
        expect(result.status, result.stderr).toBe(0);
        const integrated = [...result.stderr.matchAll(/^\s*I:\s*([+-]?[\d.]+) LUFS$/gm)].at(
          -1,
        )?.[1];
        const peak = [...result.stderr.matchAll(/^\s*Peak:\s*([+-]?[\d.]+) dBFS$/gm)].at(-1)?.[1];
        if (integrated === undefined || peak === undefined)
          throw new Error(`Missing loudness summary: ${result.stderr}`);
        return { integratedTenths: Math.round(Number(integrated) * 10), peak: Number(peak) };
      };
      const actual = measure(delivered);
      const expected = measure(reference);
      expect(actual.peak).toBeLessThanOrEqual(-1);
      // FFmpeg reports tenths of a LUFS. Compare those integer units without binary subtraction drift.
      expect(Math.abs(actual.integratedTenths - expected.integratedTenths)).toBeLessThanOrEqual(1);
    }, 60_000);

    it.each([false, true])(
      "encodes the audio once, at the frames' exact length (chunks carry audio: %s)",
      async (chunksCarryAudio) => {
        // 1.01 s at 30 fps is 31 frames: 49,600 samples, 48.4375 AAC frames of 1,024.
        const project = audioProject(`project-one-encode-${chunksCarryAudio}`, 0.3, 1.01);
        const shimDir = join(runRoot, `ffmpeg-shim-${chunksCarryAudio}`);
        mkdirSync(shimDir, { recursive: true });
        const shim = join(shimDir, "ffmpeg");
        const calls = join(shimDir, "calls.txt");
        writeFileSync(
          shim,
          `#!/bin/sh\necho "$*" >> "${calls}"\nexec "${getFfmpegBinary()}" "$@"\n`,
        );
        chmodSync(shim, 0o755);
        const planDir = join(runRoot, `plan-one-encode-${chunksCarryAudio}`);
        const previous = process.env[FFMPEG_PATH_ENV];
        process.env[FFMPEG_PATH_ENV] = shim;
        try {
          await buildLocalExecutionPlan(
            project,
            { fps: 30, width: 320, height: 240, format: "mp4" },
            planDir,
            { chunksCarryAudio },
          );
        } finally {
          if (previous === undefined) delete process.env[FFMPEG_PATH_ENV];
          else process.env[FFMPEG_PATH_ENV] = previous;
        }
        const aacEncodes = readFileSync(calls, "utf-8")
          .split("\n")
          .filter((line) => / aac -b:a /.test(line));
        expect(aacEncodes).toHaveLength(1);
        const planAudio = join(planDir, "audio.m4a");
        const shown = spawnSync(
          getFfprobeBinary(),
          [
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=duration_ts",
            "-of",
            "csv=p=0",
            "--",
            planAudio,
          ],
          { encoding: "utf-8" },
        );
        // The edit list counts in ms, so 49,600 samples (1.0333 s) show as 1.033 s.
        expect(Math.abs(Number(shown.stdout) - 49_600)).toBeLessThan(48);
      },
      60_000,
    );
  },
);

describe("plan() — codec knob", () => {
  const TIMEOUT_MS = 30_000;

  it(
    "defaults `codec` to h264 (libx264-software) for mp4",
    async () => {
      const planDir = join(runRoot, "plan-codec-default");
      mkdirSync(planDir, { recursive: true });
      await plan(projectDir, { fps: 30, width: 320, height: 240, format: "mp4" }, planDir);
      const encoder = JSON.parse(
        readFileSync(join(planDir, "meta", "encoder.json"), "utf-8"),
      ) as Record<string, unknown>;
      expect(encoder.encoder).toBe("libx264-software");
      expect(encoder.pixelFormat).toBe("yuv420p");
      expect(encoder).not.toHaveProperty("vp9CpuUsed");
    },
    TIMEOUT_MS,
  );

  it(
    'maps `codec: "h265"` to libx265-software for mp4',
    async () => {
      const planDir = join(runRoot, "plan-codec-h265");
      mkdirSync(planDir, { recursive: true });
      await plan(
        projectDir,
        { fps: 30, width: 320, height: 240, format: "mp4", codec: "h265" },
        planDir,
      );
      const encoder = JSON.parse(
        readFileSync(join(planDir, "meta", "encoder.json"), "utf-8"),
      ) as Record<string, unknown>;
      expect(encoder.encoder).toBe("libx265-software");
      // SDR 8-bit yuv420p, same as h264 — distributed mode is SDR-only and
      // 10-bit / HDR pixelFormat selection is not exposed on this surface.
      expect(encoder.pixelFormat).toBe("yuv420p");
    },
    TIMEOUT_MS,
  );

  it("rejects `codec` with format other than mp4", async () => {
    const planDir = join(runRoot, "plan-codec-bad-format");
    mkdirSync(planDir, { recursive: true });
    let caught: unknown;
    try {
      await plan(
        projectDir,
        // @ts-expect-error — runtime check is the test's purpose.
        { fps: 30, width: 320, height: 240, format: "mov", codec: "h265" },
        planDir,
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/codec.*only valid for format="mp4"/);
  });

  it("rejects unknown codec strings for format=mp4 (no silent fall-through to h264)", async () => {
    const planDir = join(runRoot, "plan-codec-unknown");
    mkdirSync(planDir, { recursive: true });
    let caught: unknown;
    try {
      await plan(
        projectDir,
        // @ts-expect-error — runtime check is the test's purpose. Catches
        // typos ("H265") and future codec additions ("av1") that a JS
        // caller building config from JSON might pass.
        { fps: 30, width: 320, height: 240, format: "mp4", codec: "h266" },
        planDir,
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/codec must be "h264" or "h265"/);
  });
});

describe("plan() motion blur intent", () => {
  it("freezes explicit off into the plan identity while omission preserves the old plan", async () => {
    const base = { fps: 30 as const, width: 320, height: 240, format: "mp4" as const };
    const ordinaryDir = join(runRoot, "motion-blur-omitted");
    const offDir = join(runRoot, "motion-blur-off");
    mkdirSync(ordinaryDir, { recursive: true });
    mkdirSync(offDir, { recursive: true });
    const ordinary = await plan(projectDir, base, ordinaryDir);
    const off = await plan(projectDir, { ...base, pageMotionBlur: "off" }, offDir);
    const encoder = (dir: string) =>
      JSON.parse(readFileSync(join(dir, "meta", "encoder.json"), "utf-8"));
    expect(encoder(ordinaryDir)).not.toHaveProperty("pageMotionBlur");
    expect(encoder(offDir).pageMotionBlur).toBe("off");
    expect(off.planHash).not.toBe(ordinary.planHash);
  }, 30_000);
});

describe("plan() — variables", () => {
  const TIMEOUT_MS = 30_000;

  it(
    "snapshots variables into meta/encoder.json so chunk workers see the controller's set",
    async () => {
      const planDir = join(runRoot, "plan-variables-snapshot");
      mkdirSync(planDir, { recursive: true });
      const variables = { title: "Hello", accent: "#ff0000" };
      await plan(
        projectDir,
        { fps: 30, width: 320, height: 240, format: "mp4", variables },
        planDir,
      );
      const encoder = JSON.parse(
        readFileSync(join(planDir, "meta", "encoder.json"), "utf-8"),
      ) as Record<string, unknown>;
      expect(encoder.variables).toEqual(variables);
    },
    TIMEOUT_MS,
  );

  it(
    "omits the variables key from canonical encoder.json when the caller passes no variables",
    async () => {
      // Backwards compat: a no-variables plan must hash identically to
      // pre-Phase-9 plans. Since the canonical encoder.json strips
      // `undefined` values, the key must not appear at all.
      const planDir = join(runRoot, "plan-variables-absent");
      mkdirSync(planDir, { recursive: true });
      await plan(projectDir, { fps: 30, width: 320, height: 240, format: "mp4" }, planDir);
      const encoderRaw = readFileSync(join(planDir, "meta", "encoder.json"), "utf-8");
      expect(encoderRaw).not.toContain("variables");
    },
    TIMEOUT_MS,
  );

  it(
    "produces a DIFFERENT planHash when variables differ",
    async () => {
      // Variables fold into planHash via meta/encoder.json bytes. Two plans
      // with different variables must produce different hashes — chunked
      // output depends on the injected values, and the byte-identical-
      // retry contract has to bind to the controller's choice.
      const planDirA = join(runRoot, "plan-variables-different-a");
      const planDirB = join(runRoot, "plan-variables-different-b");
      mkdirSync(planDirA, { recursive: true });
      mkdirSync(planDirB, { recursive: true });

      const base = { fps: 30 as const, width: 320, height: 240, format: "mp4" as const };
      const a = await plan(projectDir, { ...base, variables: { title: "Alice" } }, planDirA);
      const b = await plan(projectDir, { ...base, variables: { title: "Bob" } }, planDirB);
      expect(a.planHash).not.toBe(b.planHash);
    },
    TIMEOUT_MS,
  );

  it(
    "produces the SAME planHash for two plans with the same variables",
    async () => {
      // Canonical-JSON sorts object keys, so the same variables (regardless
      // of insertion order on the caller side) must round-trip to the
      // same encoder.json bytes and therefore the same planHash.
      const planDirA = join(runRoot, "plan-variables-same-a");
      const planDirB = join(runRoot, "plan-variables-same-b");
      mkdirSync(planDirA, { recursive: true });
      mkdirSync(planDirB, { recursive: true });

      const base = { fps: 30 as const, width: 320, height: 240, format: "mp4" as const };
      const a = await plan(
        projectDir,
        { ...base, variables: { title: "Alice", accent: "#ff0000" } },
        planDirA,
      );
      const b = await plan(
        projectDir,
        // Same values, opposite insertion order.
        { ...base, variables: { accent: "#ff0000", title: "Alice" } },
        planDirB,
      );
      expect(a.planHash).toBe(b.planHash);
    },
    TIMEOUT_MS,
  );

  it(
    "no-variables plan hashes identically to itself (backwards-compat baseline)",
    async () => {
      // Pin the no-variables path so adding the new field doesn't silently
      // change the hash for callers who never opt in. Re-runs the
      // determinism check from the golden block, scoped to the variables
      // surface so a future refactor here trips a focused failure.
      const planDirA = join(runRoot, "plan-no-variables-determinism-a");
      const planDirB = join(runRoot, "plan-no-variables-determinism-b");
      mkdirSync(planDirA, { recursive: true });
      mkdirSync(planDirB, { recursive: true });
      const config = { fps: 30 as const, width: 320, height: 240, format: "mp4" as const };
      const a = await plan(projectDir, config, planDirA);
      const b = await plan(projectDir, config, planDirB);
      expect(a.planHash).toBe(b.planHash);
    },
    TIMEOUT_MS,
  );
});

describe("plan() — webm format (distributed VP9)", () => {
  const TIMEOUT_MS = 30_000;

  it(
    'maps `format: "webm"` to libvpx-vp9-software + yuva420p',
    async () => {
      // Pins the plan-time encoder choice for webm: libvpx-vp9-software
      // with yuva420p so the format's alpha-channel contract round-trips
      // through chunked rendering.
      const planDir = join(runRoot, "plan-webm-vp9");
      mkdirSync(planDir, { recursive: true });
      const result = await plan(
        projectDir,
        { fps: 30, width: 320, height: 240, format: "webm" },
        planDir,
      );
      expect(result.format).toBe("webm");

      const encoder = JSON.parse(
        readFileSync(join(planDir, "meta", "encoder.json"), "utf-8"),
      ) as Record<string, unknown>;
      expect(encoder.encoder).toBe("libvpx-vp9-software");
      expect(encoder.pixelFormat).toBe("yuva420p");
      // Closed-GOP must be on so concat-copy at assemble time works.
      // gopSize equals the chunkSize so every chunk's first frame is a
      // keyframe with no alt-ref references reaching back across seams.
      expect(encoder.closedGop).toBe(true);
      expect(encoder.gopSize).toBe(encoder.chunkSize);
      expect(encoder.vp9CpuUsed).toBe(4);
    },
    TIMEOUT_MS,
  );

  it(
    "locks the resolved VP9 cpu-used value into encoder metadata",
    async () => {
      const planDir = join(runRoot, "plan-webm-vp9-cpu-used");
      mkdirSync(planDir, { recursive: true });
      await plan(
        projectDir,
        {
          fps: 30,
          width: 320,
          height: 240,
          format: "webm",
          producerConfig: { vp9CpuUsed: 2 },
        },
        planDir,
      );

      const encoder = JSON.parse(
        readFileSync(join(planDir, "meta", "encoder.json"), "utf-8"),
      ) as Record<string, unknown>;
      expect(encoder.vp9CpuUsed).toBe(2);
    },
    TIMEOUT_MS,
  );

  it("rejects `codec` with format=webm", async () => {
    // webm is always libvpx-vp9 — same shape as mov (always ProRes 4444).
    // A JS caller building config from JSON who passes `codec: "vp8"` or
    // `codec: "av1"` must hit a typed error, not silently encode VP9.
    const planDir = join(runRoot, "plan-webm-bad-codec");
    mkdirSync(planDir, { recursive: true });
    let caught: unknown;
    try {
      await plan(
        projectDir,
        // @ts-expect-error — runtime check is the test's purpose.
        { fps: 30, width: 320, height: 240, format: "webm", codec: "vp8" },
        planDir,
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/codec.*only valid for format="mp4"/);
  });
});
