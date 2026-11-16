import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CaptureSession } from "./frameCapture.js";

// A worker reuses static frames only inside its own range, so static-frame dedup verifies
// only that range (heygen-com/hyperframes#7370). initializeSession arms dedup, so the
// worker's session must carry the range by then.
describe("executeParallelCapture static-dedup range", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("./frameCapture.js");
  });

  it("gives each worker's session its own frame range before initializing it", async () => {
    const root = mkdtempSync(join(tmpdir(), "hf-static-dedup-range-"));
    const rangesAtInit = new Map<string, CaptureSession["staticDedupFrameRange"]>();
    vi.doMock("./frameCapture.js", () => ({
      createCaptureSession: vi.fn(async (_url: string, outputDir: string) => ({
        outputDir,
        browserConsoleBuffer: [],
      })),
      initializeSession: vi.fn(async (session: CaptureSession) => {
        rangesAtInit.set(session.outputDir, session.staticDedupFrameRange);
      }),
      captureFrame: vi.fn(async () => ({ path: join(root, "frame.jpg") })),
      captureFrameToBuffer: vi.fn(),
      captureFrameToBufferPipelined: vi.fn(),
      closeCaptureSession: vi.fn().mockResolvedValue(undefined),
      getCapturePerfSummary: vi.fn(() => ({ frames: 0 })),
    }));

    try {
      const { executeParallelCapture } = await import("./parallelCoordinator.js");
      const tasks = [
        { workerId: 0, startFrame: 100, endFrame: 104, outputDir: join(root, "worker-0") },
        { workerId: 1, startFrame: 104, endFrame: 108, outputDir: join(root, "worker-1") },
      ];
      await executeParallelCapture(
        "http://127.0.0.1",
        root,
        tasks,
        { width: 320, height: 180, fps: { num: 30, den: 1 } },
        () => null,
      );

      expect(rangesAtInit.get(join(root, "worker-0"))).toEqual({ start: 100, end: 104 });
      expect(rangesAtInit.get(join(root, "worker-1"))).toEqual({ start: 104, end: 108 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
