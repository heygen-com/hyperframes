import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTypegpuAdapter } from "./typegpu";
import { resetSeekDispatchState } from "./seek-dispatch";

const gpuWindow = window as Window & {
  __hfTypegpuTime?: number;
  __hfWebGpu?: {
    readonly devices: readonly { queue?: { onSubmittedWorkDone?: () => Promise<unknown> } }[];
    readonly pendingFrameCount: number;
    registerDevice: (device: { queue?: { onSubmittedWorkDone?: () => Promise<unknown> } }) => void;
    registerFrame: (work: PromiseLike<unknown>) => Promise<unknown>;
    waitForFrame: (time?: number) => Promise<void>;
    discardPendingFrames: () => void;
  };
  __hfRegisterWebGpuDevice?: unknown;
  __hfRegisterWebGpuFrame?: unknown;
};

describe("typegpu adapter", () => {
  beforeEach(() => {
    delete gpuWindow.__hfTypegpuTime;
    delete gpuWindow.__hfWebGpu;
    delete gpuWindow.__hfRegisterWebGpuDevice;
    delete gpuWindow.__hfRegisterWebGpuFrame;
    // Reset shared dedup state so each test starts with a clean dispatch history
    resetSeekDispatchState();
  });

  it("has correct name", () => {
    expect(createTypegpuAdapter().name).toBe("typegpu");
  });

  it("seek sets __hfTypegpuTime", () => {
    const adapter = createTypegpuAdapter();
    adapter.seek({ time: 5 });
    expect(gpuWindow.__hfTypegpuTime).toBe(5);
  });

  it("seek dispatches hf-seek custom event with time", () => {
    const adapter = createTypegpuAdapter();
    const handler = vi.fn();
    window.addEventListener("hf-seek", handler);
    adapter.seek({ time: 3.5 });
    window.removeEventListener("hf-seek", handler);
    expect(handler).toHaveBeenCalledOnce();
    const detail = (handler.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.time).toBe(3.5);
  });

  it("seek clamps negative time to 0", () => {
    const adapter = createTypegpuAdapter();
    adapter.seek({ time: -5 });
    expect(gpuWindow.__hfTypegpuTime).toBe(0);
  });

  it("seek handles NaN gracefully", () => {
    const adapter = createTypegpuAdapter();
    adapter.seek({ time: NaN });
    expect(gpuWindow.__hfTypegpuTime).toBe(0);
  });

  it("multiple seeks to different times dispatch separate events", () => {
    const adapter = createTypegpuAdapter();
    const handler = vi.fn();
    window.addEventListener("hf-seek", handler);
    adapter.seek({ time: 1 });
    adapter.seek({ time: 2 });
    adapter.seek({ time: 3 });
    window.removeEventListener("hf-seek", handler);
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it("duplicate seek to same time fires event only once (dedup)", () => {
    const adapter = createTypegpuAdapter();
    const handler = vi.fn();
    window.addEventListener("hf-seek", handler);
    adapter.seek({ time: 5 });
    adapter.seek({ time: 5 }); // same time — deduplicated
    window.removeEventListener("hf-seek", handler);
    expect(handler).toHaveBeenCalledOnce();
    // __hfTypegpuTime is still updated on every seek regardless of dedup
    expect(gpuWindow.__hfTypegpuTime).toBe(5);
  });

  it("pause after seek preserves last time", () => {
    const adapter = createTypegpuAdapter();
    adapter.seek({ time: 8 });
    adapter.pause();
    expect(gpuWindow.__hfTypegpuTime).toBe(8);
  });

  it("revert resets state", () => {
    const adapter = createTypegpuAdapter();
    adapter.seek({ time: 5 });
    adapter.revert!();
    adapter.pause();
    expect(gpuWindow.__hfTypegpuTime).toBe(5);
  });

  it("discover is a no-op and does not throw", () => {
    const adapter = createTypegpuAdapter();
    expect(() => adapter.discover()).not.toThrow();
  });

  it("installs a shared WebGPU frame fence helper", () => {
    const adapter = createTypegpuAdapter();
    adapter.discover();

    expect(gpuWindow.__hfWebGpu).toBeDefined();
    expect(typeof gpuWindow.__hfWebGpu?.registerDevice).toBe("function");
    expect(typeof gpuWindow.__hfWebGpu?.registerFrame).toBe("function");
    expect(typeof gpuWindow.__hfWebGpu?.waitForFrame).toBe("function");
    expect(typeof gpuWindow.__hfRegisterWebGpuDevice).toBe("function");
    expect(typeof gpuWindow.__hfRegisterWebGpuFrame).toBe("function");
  });

  it("waits for registered frame promises without also polling device queues", async () => {
    const originalRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as typeof window.requestAnimationFrame;

    try {
      const adapter = createTypegpuAdapter();
      adapter.discover();

      let resolveFrame: (() => void) | undefined;
      const framePromise = new Promise<void>((resolve) => {
        resolveFrame = resolve;
      });
      const queueDone = vi.fn(async () => undefined);

      gpuWindow.__hfWebGpu!.registerDevice({ queue: { onSubmittedWorkDone: queueDone } });
      gpuWindow.__hfWebGpu!.registerFrame(framePromise);

      expect(gpuWindow.__hfWebGpu!.pendingFrameCount).toBe(1);

      const wait = gpuWindow.__hfWebGpu!.waitForFrame(1);
      resolveFrame!();
      await wait;

      expect(queueDone).not.toHaveBeenCalled();
      expect(gpuWindow.__hfWebGpu!.pendingFrameCount).toBe(0);
    } finally {
      window.requestAnimationFrame = originalRaf;
    }
  });

  it("uses registered device queues as a fallback when no frame promise is registered", async () => {
    const originalRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as typeof window.requestAnimationFrame;

    try {
      const adapter = createTypegpuAdapter();
      adapter.discover();
      const queueDone = vi.fn(async () => undefined);

      gpuWindow.__hfWebGpu!.registerDevice({ queue: { onSubmittedWorkDone: queueDone } });
      await gpuWindow.__hfWebGpu!.waitForFrame(1);

      expect(queueDone).toHaveBeenCalledOnce();
    } finally {
      window.requestAnimationFrame = originalRaf;
    }
  });

  it("falls back when requestAnimationFrame does not fire during capture", async () => {
    vi.useFakeTimers();
    const originalRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = (() => 1) as typeof window.requestAnimationFrame;

    try {
      const adapter = createTypegpuAdapter();
      adapter.discover();

      const wait = gpuWindow.__hfWebGpu!.waitForFrame(1);
      await vi.advanceTimersByTimeAsync(50);
      await vi.advanceTimersByTimeAsync(50);

      await wait;
    } finally {
      window.requestAnimationFrame = originalRaf;
      vi.useRealTimers();
    }
  });

  it("can discard stale pending frame promises", () => {
    const adapter = createTypegpuAdapter();
    adapter.discover();
    gpuWindow.__hfWebGpu!.registerFrame(new Promise(() => {}));

    expect(gpuWindow.__hfWebGpu!.pendingFrameCount).toBe(1);
    gpuWindow.__hfWebGpu!.discardPendingFrames();
    expect(gpuWindow.__hfWebGpu!.pendingFrameCount).toBe(0);
  });
});
