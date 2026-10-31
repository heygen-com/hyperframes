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

  it("carries every worker's page-error lines on the failure, including a worker that did not fail", async () => {
    const root = mkdtempSync(join(tmpdir(), "hf-failure-page-errors-"));
    vi.doMock("./frameCapture.js", () => ({
      createCaptureSession: vi.fn(async (_url: string, outputDir: string) => {
        const workerId = outputDir.endsWith("worker-0") ? 0 : 1;
        return {
          workerId,
          browserConsoleBuffer: [`[Browser:PAGEERROR] worker ${workerId} script threw`],
        } as unknown as CaptureSession & { workerId: number };
      }),
      initializeSession: vi.fn(async (session: CaptureSession & { workerId: number }) => {
        if (session.workerId === 0) throw new Error("Composition has zero duration.");
        await Promise.resolve();
      }),
      captureFrame: vi.fn().mockResolvedValue(undefined),
      captureFrameToBuffer: vi.fn(),
      captureFrameToBufferPipelined: vi.fn(),
      closeCaptureSession: vi.fn().mockResolvedValue(undefined),
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
        pageErrorLines: [
          "[Browser:PAGEERROR] worker 0 script threw",
          "[Browser:PAGEERROR] worker 1 script threw",
        ],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("hands the pool the failed worker's own page-error lines", async () => {
    const root = mkdtempSync(join(tmpdir(), "hf-worker-failure-lines-"));
    vi.doMock("./frameCapture.js", () => ({
      createCaptureSession: vi.fn(async () => ({
        browserConsoleBuffer: ["[Browser:PAGEERROR] script threw at load"],
      })),
      initializeSession: vi.fn(async () => {
        throw new Error("Protocol error (Target.createTarget): Target closed");
      }),
      captureFrame: vi.fn(),
      captureFrameToBuffer: vi.fn(),
      captureFrameToBufferPipelined: vi.fn(),
      closeCaptureSession: vi.fn().mockResolvedValue(undefined),
      getCapturePerfSummary: vi.fn(() => ({ frames: 0 })),
    }));

    try {
      const { executeParallelCapture } = await import("./parallelCoordinator.js");
      const failures: { pageErrorLines: readonly string[] }[] = [];
      await executeParallelCapture(
        "http://127.0.0.1",
        root,
        [{ workerId: 0, startFrame: 0, endFrame: 1, outputDir: join(root, "worker-0") }],
        { width: 320, height: 180, fps: { num: 30, den: 1 } },
        () => null,
        undefined,
        undefined,
        async () => {},
        undefined,
        { onWorkerFailure: (failure) => failures.push(failure) },
      ).catch(() => {});

      expect(failures.map((failure) => failure.pageErrorLines)).toEqual([
        ["[Browser:PAGEERROR] script threw at load"],
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("closes a browser whose launch finishes after the cancel before the render rejects", async () => {
    const root = mkdtempSync(join(tmpdir(), "hf-late-launch-"));
    const lateSession = {} as CaptureSession;
    let finishLaunch: (session: CaptureSession) => void = () => {};
    const closeCaptureSession = vi.fn().mockResolvedValue(undefined);
    vi.doMock("./frameCapture.js", () => ({
      createCaptureSession: vi.fn(
        () => new Promise<CaptureSession>((settle) => (finishLaunch = settle)),
      ),
      initializeSession: vi.fn(async () => {}),
      captureFrame: vi.fn(),
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
      controller.abort();
      setTimeout(() => finishLaunch(lateSession), 20);

      await expect(result).rejects.toMatchObject({ name: "CaptureFailure" });
      expect(closeCaptureSession).toHaveBeenCalledWith(lateSession);
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

  it("worker 0 verifies its session before any worker captures, and a failed check fails every worker", async () => {
    const root = mkdtempSync(join(tmpdir(), "hf-first-session-gate-"));
    const order: string[] = [];
    const captureFrame = vi.fn(async () => {
      order.push("frame");
      return { path: join(root, "frame.jpg") };
    });
    vi.doMock("./frameCapture.js", () => ({
      createCaptureSession: vi.fn(async () => ({ browserConsoleBuffer: [] })),
      initializeSession: vi.fn(async () => {
        order.push("init");
      }),
      captureFrame,
      captureFrameToBuffer: vi.fn(),
      captureFrameToBufferPipelined: vi.fn(),
      closeCaptureSession: vi.fn().mockResolvedValue(undefined),
      getCapturePerfSummary: vi.fn(() => ({ frames: 0 })),
    }));
    const tasks = [0, 1].map((workerId) => ({
      workerId,
      startFrame: workerId,
      endFrame: workerId + 1,
      outputDir: join(root, `worker-${workerId}`),
    }));
    const run = async (verifyFirstSession: () => Promise<void>) => {
      const { executeParallelCapture } = await import("./parallelCoordinator.js");
      return executeParallelCapture(
        "http://127.0.0.1",
        root,
        tasks,
        { width: 320, height: 180, fps: { num: 30, den: 1 } },
        () => null,
        undefined,
        undefined,
        undefined,
        undefined,
        { verifyFirstSession },
      );
    };

    try {
      let pass!: () => void;
      const gated = run(
        () =>
          new Promise<void>((resolve) => {
            order.push("verify");
            pass = resolve;
          }),
      );
      await vi.waitFor(() => expect(order).toContain("verify"));
      for (let turn = 0; turn < 20; turn++) await new Promise((resolve) => setImmediate(resolve));
      expect(order.filter((step) => step === "frame")).toEqual([]);
      pass();
      await gated;
      expect(order.filter((step) => step === "verify")).toHaveLength(1);
      expect(order.filter((step) => step === "frame")).toHaveLength(2);

      order.length = 0;
      await expect(
        run(async () => {
          throw new Error("probe said no");
        }),
      ).rejects.toThrow(/probe said no/);
      expect(order).not.toContain("frame");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a worker 0 that fails before its check does not leave the other workers waiting", async () => {
    const root = mkdtempSync(join(tmpdir(), "hf-first-session-dead-"));
    vi.doMock("./frameCapture.js", () => ({
      createCaptureSession: vi.fn(async (_url: string, outputDir: string) => {
        if (outputDir.endsWith("worker-0")) throw new Error("Protocol error: Target closed");
        return { browserConsoleBuffer: [] };
      }),
      initializeSession: vi.fn(async () => {}),
      captureFrame: vi.fn(),
      captureFrameToBuffer: vi.fn(),
      captureFrameToBufferPipelined: vi.fn(),
      closeCaptureSession: vi.fn().mockResolvedValue(undefined),
      getCapturePerfSummary: vi.fn(() => ({ frames: 0 })),
    }));
    try {
      const { executeParallelCapture } = await import("./parallelCoordinator.js");
      const result = executeParallelCapture(
        "http://127.0.0.1",
        root,
        [0, 1].map((workerId) => ({
          workerId,
          startFrame: workerId,
          endFrame: workerId + 1,
          outputDir: join(root, `worker-${workerId}`),
        })),
        { width: 320, height: 180, fps: { num: 30, den: 1 } },
        () => null,
        undefined,
        undefined,
        undefined,
        undefined,
        { verifyFirstSession: async () => {} },
      );
      await expect(result).rejects.toMatchObject({ name: "CaptureFailure" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
