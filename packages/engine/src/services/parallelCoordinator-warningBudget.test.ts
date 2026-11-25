import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CaptureSession } from "./frameCapture.js";

describe("a parallel capture whose workers each keep many warnings", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("./frameCapture.js");
  });

  // fails at 30537d4e: each worker's full warning summary was held until every worker had finished
  it("keeps a fixed total of warning text across the workers' summaries", async () => {
    const root = mkdtempSync(join(tmpdir(), "hf-warning-budget-"));
    let worker = 0;
    vi.doMock("./frameCapture.js", () => ({
      createCaptureSession: vi.fn(async () => ({
        options: {},
        browserConsoleBuffer: [],
        chromeMemory: { sampleOnce: async () => {}, stats: () => ({ samples: 1, rssLastMb: 100 }) },
      })),
      initializeSession: vi.fn(async () => {}),
      captureFrame: vi.fn(async (_session: CaptureSession, frameIndex: number) => ({
        path: join(root, `frame_${frameIndex}.png`),
      })),
      captureFrameToBuffer: vi.fn(),
      captureFrameToBufferPipelined: vi.fn(),
      closeCaptureSession: vi.fn(async () => {}),
      getCapturePerfSummary: vi.fn(() => {
        const n = worker++;
        return {
          frames: 0,
          warnings: Array.from({ length: 300 }, (_, i) => ({
            code: "media_readiness_timeout",
            message: `${n}.${i}:${"w".repeat(1_900)}`,
            details: { sources: [`https://cdn.test/${n}.${i}.jpg`] },
          })),
        };
      }),
    }));

    try {
      const { distributeFrames, executeParallelCapture } = await import("./parallelCoordinator.js");
      const results = await executeParallelCapture(
        "http://127.0.0.1",
        root,
        distributeFrames(60, 6, root),
        { width: 1920, height: 1080, fps: { num: 30, den: 1 } },
        () => null,
      );

      expect(results).toHaveLength(6);
      const warnings = results.flatMap((r) => r.perf?.warnings ?? []);
      expect(JSON.stringify(warnings).length).toBeLessThanOrEqual(1_100_000);
      expect(warnings.some((w) => w.code === "media_readiness_timeout")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
