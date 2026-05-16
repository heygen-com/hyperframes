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
import {
  buildChunkSlices,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_MAX_PARALLEL_CHUNKS,
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
      const result = await plan(
        projectDir,
        { fps: 30, width: 320, height: 240, format: "mp4" },
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
      expect(result.chunkCount).toBeGreaterThanOrEqual(1);
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
