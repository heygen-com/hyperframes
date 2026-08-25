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
    // Keep this regression isolated from frameCapture's very large module graph.
    // Importing the real module here made the test exceed Vitest's 5s budget
    // only when every workspace suite competed for CPU during the CI matrix.
    vi.doMock("./frameCapture.js", () => ({
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
      captureFrameToBuffer: vi.fn(),
      captureFrameToBufferPipelined: vi.fn(),
      closeCaptureSession,
      getCapturePerfSummary: vi.fn(() => ({ frames: 0 })),
    }));

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

  // heygen-com/hyperframes#3441: a worker wedged INSIDE a native capture call
  // (WSL2 hangs the very first drawElement/BeginFrame call at frame 0 with no
  // error) must actually be unstuck once the caller's `signal` aborts — e.g.
  // the DE parallel-router stall watchdog in `captureStreamingStage.ts` firing
  // after HF_DE_STALL_MS. Before this fix, `captureFrameRange` only checked
  // `signal.aborted` BEFORE starting each frame's capture call, which is a
  // no-op for a call that is already in flight and never settles — the abort
  // had no way to reach it, so `executeParallelCapture`'s `Promise.all` (and
  // therefore the whole render) hung forever, and the CLI circuit breaker
  // (which only runs after `executeRenderJob` settles) never got a chance to
  // trip.
  it("rejects promptly when the signal aborts while a worker is wedged inside a capture call that never settles", async () => {
    const root = mkdtempSync(join(tmpdir(), "hf-stall-abort-"));
    // Simulates the native capture call hanging indefinitely (never resolves,
    // never rejects) — exactly the WSL2 shape from the field report.
    const captureFrame = vi.fn(() => new Promise<void>(() => {}));
    const closeCaptureSession = vi.fn().mockResolvedValue(undefined);
    vi.doMock("./frameCapture.js", () => ({
      createCaptureSession: vi.fn(
        async () => ({ workerId: 0, browserConsoleBuffer: [] }) as unknown as CaptureSession,
      ),
      initializeSession: vi.fn(async () => {}),
      captureFrame,
      captureFrameToBuffer: vi.fn(),
      captureFrameToBufferPipelined: vi.fn(),
      closeCaptureSession,
      getCapturePerfSummary: vi.fn(() => ({ frames: 0 })),
    }));

    try {
      const { executeParallelCapture } = await import("./parallelCoordinator.js");
      const controller = new AbortController();
      const result = executeParallelCapture(
        "http://127.0.0.1",
        root,
        [{ workerId: 0, startFrame: 0, endFrame: 3, outputDir: join(root, "worker-0") }],
        { width: 320, height: 180, fps: { num: 30, den: 1 } },
        () => null,
        controller.signal,
      );

      // Give the worker a tick to actually enter the (never-resolving)
      // capture call before simulating the watchdog's abort.
      await new Promise((resolve) => setTimeout(resolve, 10));
      controller.abort();

      await expect(result).rejects.toMatchObject({ name: "CaptureFailure" });
      expect(captureFrame).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
