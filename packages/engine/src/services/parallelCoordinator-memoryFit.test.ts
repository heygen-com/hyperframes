import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CaptureSession } from "./frameCapture.js";

const GIB = 1024;

describe("a parallel capture whose page is heavier than the memory budget assumes", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("./frameCapture.js");
    vi.doUnmock("./systemMemory.js");
  });

  it("launches only the browsers that fit, measured from worker 0's loaded page, and captures every frame", async () => {
    const root = mkdtempSync(join(tmpdir(), "hf-memory-fit-"));
    const launched: string[] = [];
    const captured: number[] = [];
    vi.doMock("./systemMemory.js", async (importOriginal) => ({
      ...(await importOriginal<typeof import("./systemMemory.js")>()),
      getSystemTotalMb: () => 24 * GIB,
    }));
    vi.doMock("./frameCapture.js", () => ({
      createCaptureSession: vi.fn(async (_url: string, outputDir: string) => {
        launched.push(outputDir.slice(-8));
        return {
          options: {},
          browserConsoleBuffer: [],
          chromeMemory: {
            sampleOnce: async () => {},
            stats: () => ({ samples: 1, rssLastMb: 3_700 }),
          },
        } as unknown as CaptureSession;
      }),
      initializeSession: vi.fn(async () => {}),
      captureFrame: vi.fn(async (_session: CaptureSession, frameIndex: number) => {
        captured.push(frameIndex);
        return { path: join(root, `frame_${frameIndex}.png`) };
      }),
      captureFrameToBuffer: vi.fn(),
      captureFrameToBufferPipelined: vi.fn(),
      closeCaptureSession: vi.fn(async () => {}),
      getCapturePerfSummary: vi.fn(() => ({ frames: 0 })),
    }));

    try {
      const { distributeFrames, executeParallelCapture } = await import("./parallelCoordinator.js");
      const tasks = distributeFrames(60, 6, root);
      const results = await executeParallelCapture(
        "http://127.0.0.1",
        root,
        tasks,
        { width: 1920, height: 1080, fps: { num: 30, den: 1 } },
        () => null,
      );

      // 24 GiB x 0.5 / 3.7 GiB per browser = 3 browsers, not the 6 the split asked for.
      expect(launched).toEqual(["worker-0", "worker-1", "worker-2"]);
      expect(results.map((r) => [r.startFrame, r.endFrame])).toEqual([
        [0, 20],
        [20, 40],
        [40, 60],
      ]);
      expect(tasks).toHaveLength(3);
      expect([...captured].sort((a, b) => a - b)).toEqual(Array.from({ length: 60 }, (_, i) => i));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
