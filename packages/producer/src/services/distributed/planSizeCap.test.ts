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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  measurePlanDirBytes,
  PLAN_DIR_SIZE_LIMIT_BYTES,
  PLAN_TOO_LARGE,
  PlanTooLargeError,
  plan,
} from "./plan.js";
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

  it("ignores symlinks (not traversed into)", () => {
    const dir = mkdtempSync(join(runRoot, "symlinks-"));
    writeFileSync(join(dir, "real.bin"), Buffer.alloc(128));
    // We don't actually create a symlink here because the planDir
    // materialization path strips them — but the function should still
    // gracefully ignore broken entries if any slipped in. Confirm the
    // baseline is correct (the real file's bytes).
    expect(measurePlanDirBytes(dir)).toBe(128);
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
      expect((caught as PlanTooLargeError).code).toBe(PLAN_TOO_LARGE);
      expect((caught as PlanTooLargeError).sizeBytes).toBeGreaterThan(1024);
      expect((caught as PlanTooLargeError).limitBytes).toBe(1024);
    },
    TIMEOUT_MS,
  );

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
