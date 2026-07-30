/**
 * Unit tests for the `PLAN_TOO_LARGE` size cap on `plan()`.
 *
 * `plan()` measures the produced planDir before returning, and throws a
 * non-retryable `PlanTooLargeError` if it exceeds the configured ceiling.
 * Defaults to {@link PLAN_DIR_SIZE_LIMIT_BYTES} (2 GB); a smaller ceiling
 * can be passed via `DistributedRenderConfig.planDirSizeLimitBytes` so
 * tests can exercise the throw path without filling 2 GB of /tmp.
 *
 * Two cases:
 *   1. The standalone `measurePlanDirBytes` helper walks the tree and
 *      sums regular files.
 *   2. `plan()` throws `PlanTooLargeError` with `code === PLAN_TOO_LARGE`
 *      when the produced planDir exceeds a tiny configured cap.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  measurePlanDirBytes,
  PLAN_DIR_SIZE_LIMIT_BYTES,
  PLAN_TOO_LARGE,
  PlanTooLargeError,
  plan,
} from "./plan.js";
import { getPlanV2ExecutionPlanHash, planV2, readPlanV2Manifest } from "./planV2.js";
import { measurePlanSizeBreakdown } from "./planSize.js";
import { DISTRIBUTED_DURATION_OUT_OF_RANGE } from "../render/planValidation.js";

const FIXTURE_HTML = `<!doctype html>
<html><body>
  <div data-composition-id="root" data-width="320" data-height="240" data-duration="1">hi</div>
</body></html>`;

let runRoot: string;

beforeAll(() => {
  runRoot = mkdtempSync(join(tmpdir(), "hf-plan-size-cap-"));
});

afterAll(() => {
  rmSync(runRoot, { recursive: true, force: true });
});

describe("measurePlanDirBytes", () => {
  it("returns 0 for an empty directory", () => {
    const dir = mkdtempSync(join(runRoot, "empty-"));
    expect(measurePlanDirBytes(dir)).toBe(0);
  });

  it("sums file sizes recursively", () => {
    const dir = mkdtempSync(join(runRoot, "fixture-"));
    mkdirSync(join(dir, "nested", "deeper"), { recursive: true });
    writeFileSync(join(dir, "a.bin"), Buffer.alloc(100));
    writeFileSync(join(dir, "nested", "b.bin"), Buffer.alloc(250));
    writeFileSync(join(dir, "nested", "deeper", "c.bin"), Buffer.alloc(50));
    expect(measurePlanDirBytes(dir)).toBe(400);
  });

  it("ignores file and directory symlinks instead of traversing outside the plan", () => {
    const dir = mkdtempSync(join(runRoot, "symlinks-"));
    const outsideDir = mkdtempSync(join(runRoot, "outside-"));
    writeFileSync(join(dir, "real.bin"), Buffer.alloc(128));
    writeFileSync(join(outsideDir, "large.bin"), Buffer.alloc(4_096));
    try {
      symlinkSync(join(outsideDir, "large.bin"), join(dir, "file-link.bin"));
      symlinkSync(outsideDir, join(dir, "dir-link"), "dir");
    } catch {
      // Windows without Developer Mode may reject symlink creation. The
      // production Linux path and privileged Windows CI exercise both links.
    }
    expect(measurePlanDirBytes(dir)).toBe(128);
  });
});

describe("measurePlanSizeBreakdown", () => {
  it("classifies retained plan artifacts without exposing video directory names", () => {
    const dir = mkdtempSync(join(runRoot, "breakdown-"));
    mkdirSync(join(dir, "compiled", "assets"), { recursive: true });
    mkdirSync(join(dir, "video-frames", "customer-video-name"), { recursive: true });
    mkdirSync(join(dir, "meta"), { recursive: true });
    writeFileSync(join(dir, "compiled", "index.html"), Buffer.alloc(100));
    writeFileSync(join(dir, "compiled", "assets", "source.mp4"), Buffer.alloc(200));
    writeFileSync(
      join(dir, "video-frames", "customer-video-name", "frame_000001.jpg"),
      Buffer.alloc(300),
    );
    writeFileSync(join(dir, "audio.aac"), Buffer.alloc(40));
    writeFileSync(join(dir, "meta", "encoder.json"), Buffer.alloc(20));
    writeFileSync(join(dir, "plan.json"), Buffer.alloc(10));
    writeFileSync(join(dir, "other.bin"), Buffer.alloc(5));

    const result = measurePlanSizeBreakdown(dir);

    expect(result).toMatchObject({
      totalBytes: 675,
      fileCount: 7,
      compiledBytes: 300,
      sourceMediaBytes: 200,
      videoFramesBytes: 300,
      videoFrameFileCount: 1,
      audioBytes: 40,
      metadataBytes: 30,
      otherBytes: 5,
    });
    const labels = result.topComponents.map((component) => component.label);
    expect(labels).toContain("compiled");
    expect(labels.some((label) => label.startsWith("video-frames:"))).toBe(true);
    expect(JSON.stringify(result)).not.toContain("customer-video-name");
  });
});

describe("measurePlanSizeBreakdown path boundaries", () => {
  it("does not misclassify an authored compiled/video-frames path", () => {
    const dir = mkdtempSync(join(runRoot, "compiled-name-collision-"));
    mkdirSync(join(dir, "compiled", "assets", "video-frames", "customer"), {
      recursive: true,
    });
    writeFileSync(
      join(dir, "compiled", "assets", "video-frames", "customer", "source.mp4"),
      Buffer.alloc(90),
    );

    expect(measurePlanSizeBreakdown(dir)).toMatchObject({
      totalBytes: 90,
      compiledBytes: 90,
      sourceMediaBytes: 90,
      videoFramesBytes: 0,
    });
  });

  it("classifies staged extracted frames separately from compiled assets", () => {
    const dir = mkdtempSync(join(runRoot, "staged-breakdown-"));
    mkdirSync(join(dir, "__hyperframes_video_frames", "video-1"), { recursive: true });
    writeFileSync(join(dir, "index.html"), Buffer.alloc(25));
    writeFileSync(
      join(dir, "__hyperframes_video_frames", "video-1", "frame_000001.jpg"),
      Buffer.alloc(75),
    );

    expect(measurePlanSizeBreakdown(dir, "compiled")).toMatchObject({
      totalBytes: 100,
      compiledBytes: 25,
      videoFramesBytes: 75,
      videoFrameFileCount: 1,
    });
  });
});

describe("PLAN_DIR_SIZE_LIMIT_BYTES constant", () => {
  it("is the documented 2 GB ceiling", () => {
    expect(PLAN_DIR_SIZE_LIMIT_BYTES).toBe(2 * 1024 * 1024 * 1024);
  });
});

describe("PlanTooLargeError", () => {
  it("carries the typed PLAN_TOO_LARGE code", () => {
    const err = new PlanTooLargeError(3 * 1024 * 1024 * 1024, 2 * 1024 * 1024 * 1024);
    expect(err.code).toBe(PLAN_TOO_LARGE);
    expect(err.name).toBe("PlanTooLargeError");
    expect(err.sizeBytes).toBe(3 * 1024 * 1024 * 1024);
    expect(err.limitBytes).toBe(2 * 1024 * 1024 * 1024);
    // Message should point callers at the in-process renderer as the
    // escape hatch.
    expect(err.message).toMatch(/PLAN_TOO_LARGE/);
    expect(err.message).toMatch(/in-process/i);
  });
});

describe("plan() PLAN_TOO_LARGE throw path", () => {
  // Generous timeout — the actual plan() pass on a tiny fixture is ~250ms,
  // but cold cache + font snapshot read can spike on slower CI hosts.
  const TIMEOUT_MS = 30_000;

  it(
    "throws PlanTooLargeError when planDir exceeds the configured ceiling",
    async () => {
      const projectDir = mkdtempSync(join(runRoot, "project-"));
      writeFileSync(join(projectDir, "index.html"), FIXTURE_HTML, "utf-8");
      const planDir = mkdtempSync(join(runRoot, "plandir-too-large-"));

      // 1024-byte ceiling — even an empty planDir's meta/{composition,
      // encoder,chunks}.json + compiled/index.html easily exceeds this.
      let caught: unknown;
      try {
        await plan(
          projectDir,
          {
            fps: 30,
            width: 320,
            height: 240,
            format: "mp4",
            planDirSizeLimitBytes: 1024,
          },
          planDir,
        );
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(PlanTooLargeError);
      const error = caught as PlanTooLargeError;
      expect(error.code).toBe(PLAN_TOO_LARGE);
      expect(error.sizeBytes).toBeGreaterThan(1024);
      expect(error.limitBytes).toBe(1024);
      expect(error.breakdown?.totalBytes).toBe(error.sizeBytes);
      expect(error.observedAt).toBe("post-freeze");
      expect(error.message).toContain("Breakdown:");
    },
    TIMEOUT_MS,
  );
});

describe("plan() under size cap", () => {
  const TIMEOUT_MS = 30_000;

  it(
    "succeeds when the default ceiling is well above the produced planDir size",
    async () => {
      // No `planDirSizeLimitBytes` override → uses 2 GB default. The fixture
      // produces a planDir well under that, so plan() must complete.
      const projectDir = mkdtempSync(join(runRoot, "project-ok-"));
      writeFileSync(join(projectDir, "index.html"), FIXTURE_HTML, "utf-8");
      const planDir = mkdtempSync(join(runRoot, "plandir-ok-"));
      const result = await plan(
        projectDir,
        { fps: 30, width: 320, height: 240, format: "mp4" },
        planDir,
      );
      expect(result.planHash).toMatch(/^[0-9a-f]{64}$/);
    },
    TIMEOUT_MS,
  );

  it(
    "lets planV2 complete the same render that trips the v1 transport cap",
    async () => {
      const projectDir = mkdtempSync(join(runRoot, "project-v1-v2-pressure-"));
      writeFileSync(join(projectDir, "index.html"), FIXTURE_HTML, "utf-8");
      const config = {
        fps: 30 as const,
        width: 320,
        height: 240,
        format: "mp4" as const,
        planDirSizeLimitBytes: 1024,
      };

      const v1PlanDir = mkdtempSync(join(runRoot, "plandir-v1-pressure-"));
      let v1Error: unknown;
      try {
        await plan(projectDir, config, v1PlanDir);
      } catch (error) {
        v1Error = error;
      }
      expect(v1Error).toBeInstanceOf(PlanTooLargeError);
      expect((v1Error as PlanTooLargeError).code).toBe(PLAN_TOO_LARGE);

      const v2PlanDir = join(runRoot, "plandir-v2-pressure");
      const v2 = await planV2(projectDir, config, v2PlanDir);
      const manifest = readPlanV2Manifest(v2.planDir);
      expect(v2.planProtocol.schemaVersion).toBe(2);
      expect(v2.planHash).toBe(manifest.planHash);
      expect(getPlanV2ExecutionPlanHash(v2)).toBe(manifest.sourcePlanV1Hash);
      expect(Object.hasOwn(v2, "executionPlanHash")).toBe(false);
      expect(manifest.artifacts.length).toBeGreaterThan(0);
    },
    TIMEOUT_MS,
  );
});

describe("plan() early size budget", () => {
  const TIMEOUT_MS = 30_000;

  it(
    "rejects an oversized stable compiled tree before extraction and freeze",
    async () => {
      const projectDir = mkdtempSync(join(runRoot, "project-pre-extract-too-large-"));
      writeFileSync(
        join(projectDir, "index.html"),
        `<!doctype html>
<html><body>
  <div data-composition-id="root" data-width="320" data-height="240" data-duration="1">
    <video id="source" src="large-source.mp4" data-start="0" data-end="1"></video>
  </div>
</body></html>`,
        "utf-8",
      );
      // Deliberately invalid media: reaching extraction would fail in ffprobe.
      // PLAN_TOO_LARGE at pre-extract proves that expensive stage was skipped.
      writeFileSync(join(projectDir, "large-source.mp4"), Buffer.alloc(2_048));
      const planDir = mkdtempSync(join(runRoot, "plandir-pre-extract-too-large-"));

      let caught: unknown;
      try {
        await plan(
          projectDir,
          {
            fps: 30,
            width: 320,
            height: 240,
            format: "mp4",
            planDirSizeLimitBytes: 1_024,
          },
          planDir,
        );
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(PlanTooLargeError);
      const error = caught as PlanTooLargeError;
      expect(error.observedAt).toBe("pre-extract");
      expect(error.breakdown?.compiledBytes).toBeGreaterThanOrEqual(2_048);
      expect(error.breakdown?.sourceMediaBytes).toBe(2_048);
      expect(existsSync(join(planDir, "plan.json"))).toBe(false);
    },
    TIMEOUT_MS,
  );
});

describe("plan() reused directory size check", () => {
  it("clears stale compiled scratch from a failed prior attempt", async () => {
    const projectDir = mkdtempSync(join(runRoot, "project-reused-work-dir-"));
    writeFileSync(join(projectDir, "index.html"), FIXTURE_HTML, "utf-8");
    const planDir = mkdtempSync(join(runRoot, "plandir-reused-work-dir-"));
    const staleCompiledDir = join(planDir, ".plan-work", "compiled");
    mkdirSync(staleCompiledDir, { recursive: true });
    writeFileSync(join(staleCompiledDir, "stale-large-asset.bin"), Buffer.alloc(100_000));

    const result = await plan(
      projectDir,
      {
        fps: 30,
        width: 320,
        height: 240,
        format: "mp4",
        planDirSizeLimitBytes: 4_096,
      },
      planDir,
    );

    expect(result.planHash).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(join(planDir, "compiled", "stale-large-asset.bin"))).toBe(false);
    expect(measurePlanDirBytes(planDir)).toBeLessThan(4_096);
  }, 30_000);

  it("ignores stale freeze-owned metadata that the new plan overwrites", async () => {
    const projectDir = mkdtempSync(join(runRoot, "project-reused-plan-dir-"));
    writeFileSync(join(projectDir, "index.html"), FIXTURE_HTML, "utf-8");
    const planDir = mkdtempSync(join(runRoot, "plandir-reused-"));
    mkdirSync(join(planDir, "meta"), { recursive: true });
    writeFileSync(join(planDir, "plan.json"), Buffer.alloc(100_000));
    writeFileSync(join(planDir, "meta", "encoder.json"), Buffer.alloc(100_000));

    const result = await plan(
      projectDir,
      {
        fps: 30,
        width: 320,
        height: 240,
        format: "mp4",
        planDirSizeLimitBytes: 4_096,
      },
      planDir,
    );

    expect(result.planHash).toMatch(/^[0-9a-f]{64}$/);
    expect(measurePlanDirBytes(planDir)).toBeLessThan(4_096);
  }, 30_000);
});

describe("plan() duration guard", () => {
  const TIMEOUT_MS = 30_000;

  it(
    "rejects probe durations that would create impossible distributed frame counts",
    async () => {
      const projectDir = mkdtempSync(join(runRoot, "project-impossible-duration-"));
      writeFileSync(
        join(projectDir, "index.html"),
        `<!doctype html>
<html><body>
  <div data-composition-id="root" data-width="320" data-height="240" data-start="0">
    <div class="caption">hello</div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    window.__timelines.root = {
      duration() { return 10000000000; },
      pause() {},
      time() { return 0; },
      seek() {},
      totalTime() {},
      add() {}
    };
  </script>
</body></html>`,
        "utf-8",
      );
      const planDir = mkdtempSync(join(runRoot, "plandir-impossible-duration-"));

      let caught: unknown;
      try {
        await plan(
          projectDir,
          {
            fps: 30,
            width: 320,
            height: 240,
            format: "mp4",
          },
          planDir,
        );
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(Error);
      expect((caught as { code?: string }).code).toBe(DISTRIBUTED_DURATION_OUT_OF_RANGE);
      expect(String((caught as Error).message)).toMatch(/duration/i);
      expect(String((caught as Error).message)).toMatch(/render/i);
      expect(String((caught as Error).message)).toContain("300000000000");
    },
    TIMEOUT_MS,
  );
});
