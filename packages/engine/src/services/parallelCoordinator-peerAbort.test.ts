import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CaptureSession } from "./frameCapture.js";

describe("executeParallelCapture peer abort", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("./frameCapture.js");
  });

  it("aborts peer workers on the first fatal classified failure", async () => {
    const root = mkdtempSync(join(tmpdir(), "hf-peer-abort-"));
    const captureFrame = vi.fn().mockResolvedValue(undefined);
    const closeCaptureSession = vi.fn().mockResolvedValue(undefined);
    vi.doMock("./frameCapture.js", async (importOriginal) => {
      const original = await importOriginal<typeof import("./frameCapture.js")>();
      return {
        ...original,
        createCaptureSession: vi.fn(async (_url: string, outputDir: string) => {
          const workerId = outputDir.endsWith("worker-0") ? 0 : 1;
          return {
            workerId,
            browserConsoleBuffer: workerId === 0 ? ["[Browser:ERROR] bad source"] : [],
          } as unknown as CaptureSession & { workerId: number };
        }),
        initializeSession: vi.fn(async (session: CaptureSession & { workerId: number }) => {
          if (session.workerId === 0) {
            throw new Error("Composition has zero duration. Runtime ready: true");
          }
          await Promise.resolve();
        }),
        captureFrame,
        closeCaptureSession,
        getCapturePerfSummary: vi.fn(() => ({ frames: 0 })),
      };
    });

    try {
      const { executeParallelCapture } = await import("./parallelCoordinator.js");
      const result = executeParallelCapture(
        "http://127.0.0.1",
        root,
        [
          { workerId: 0, startFrame: 0, endFrame: 1, outputDir: join(root, "worker-0") },
          { workerId: 1, startFrame: 1, endFrame: 2, outputDir: join(root, "worker-1") },
        ],
        { width: 320, height: 180, fps: { num: 30, den: 1 } },
        () => null,
      );

      await expect(result).rejects.toMatchObject({
        name: "CaptureFailure",
        kind: "authoring",
      });
      expect(captureFrame).not.toHaveBeenCalled();
      expect(closeCaptureSession).toHaveBeenCalledTimes(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
