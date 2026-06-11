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

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recomputePlanHashFromPlanDir } from "../render/stages/freezePlan.js";
import {
  buildChunkSlices,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_MAX_PARALLEL_CHUNKS,
  MIN_CHUNK_SIZE,
  plan,
  resolveChunkPlan,
} from "./plan.js";

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
});

describe("plan() — golden planDir + planHash determinism", () => {
  // Each `plan()` call is reasonably expensive (compile pass parses + inlines
  // the HTML), so we run it once for the layout assertions and once more for
  // the determinism assertion. The 30s timeout absorbs cold-start font /
  // runtime resolution variance on the CI host.
  const TIMEOUT_MS = 30_000;

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
      // No audio in the fixture — audio.aac must NOT exist.
      expect(existsSync(join(planDir, "audio.aac"))).toBe(false);
      expect(existsSync(join(planDir, "meta", "composition.json"))).toBe(true);
      expect(existsSync(join(planDir, "meta", "encoder.json"))).toBe(true);
      expect(existsSync(join(planDir, "meta", "chunks.json"))).toBe(true);
      // The temporary work tree must be cleaned up.
      expect(existsSync(join(planDir, ".plan-work"))).toBe(false);

      // ── PlanResult contract ─────────────────────────────────────────────
      expect(result.planDir).toBe(planDir);
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
    "produces a byte-identical planHash on a second invocation",
    async () => {
      const planDirA = join(runRoot, "plan-determinism-a");
      const planDirB = join(runRoot, "plan-determinism-b");
      mkdirSync(planDirA, { recursive: true });
      mkdirSync(planDirB, { recursive: true });

      const config = { fps: 30 as const, width: 320, height: 240, format: "mp4" as const };
      const a = await plan(projectDir, config, planDirA);
      const b = await plan(projectDir, config, planDirB);

      expect(a.planHash).toBe(b.planHash);
      expect(a.chunkCount).toBe(b.chunkCount);
      expect(a.totalFrames).toBe(b.totalFrames);

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
      };
      expect(planJson.planHash).toBe(result.planHash);
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
  const HAS_FFMPEG = (() => {
    const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
    return spawnSync("ffmpeg", ["-version"]).status === 0;
  })();

  it.skipIf(!HAS_FFMPEG)(
    "plan.json.planHash matches recompute on an audio-bearing composition",
    async () => {
      const audioProjectDir = join(runRoot, "project-with-audio");
      mkdirSync(audioProjectDir, { recursive: true });
      // Generate a 1s mono silent wav. PCM keeps the file tiny without
      // pulling in an audio asset fixture.
      const audioPath = join(audioProjectDir, "silence.wav");
      const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
      const ffmpeg = spawnSync("ffmpeg", [
        "-nostdin",
        "-v",
        "error",
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
      if (ffmpeg.status !== 0) {
        throw new Error(`ffmpeg silence-wav generation failed: ${ffmpeg.stderr?.toString()}`);
      }
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
      expect(existsSync(join(planDir, "audio.aac"))).toBe(true);
    },
    TIMEOUT_MS,
  );
});

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
