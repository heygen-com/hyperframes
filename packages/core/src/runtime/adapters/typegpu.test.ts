import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTypegpuAdapter } from "./typegpu";
import { resetSeekDispatchState } from "./seek-dispatch";

const gpuWindow = window as Window & { __hfTypegpuTime?: number };

describe("typegpu adapter", () => {
  beforeEach(() => {
    delete gpuWindow.__hfTypegpuTime;
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
});
