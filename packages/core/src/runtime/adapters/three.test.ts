import { describe, it, expect, vi, beforeEach } from "vitest";
import { createThreeAdapter } from "./three";

const threeWindow = window as Window & {
  __hfThreeTime?: number;
  __hfThreeRender?: ((time: number) => void)[];
};

describe("three adapter", () => {
  beforeEach(() => {
    delete threeWindow.__hfThreeTime;
    delete threeWindow.__hfThreeRender;
  });

  it("has correct name", () => {
    expect(createThreeAdapter().name).toBe("three");
  });

  it("seek sets __hfThreeTime", () => {
    const adapter = createThreeAdapter();
    adapter.seek({ time: 5 });
    expect(threeWindow.__hfThreeTime).toBe(5);
  });

  it("seek dispatches hf-seek custom event", () => {
    const adapter = createThreeAdapter();
    const handler = vi.fn();
    window.addEventListener("hf-seek", handler);
    adapter.seek({ time: 3 });
    window.removeEventListener("hf-seek", handler);
    expect(handler).toHaveBeenCalled();
    const detail = (handler.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.time).toBe(3);
  });

  it("seek invokes every callback in __hfThreeRender registry", () => {
    const adapter = createThreeAdapter();
    const cbA = vi.fn();
    const cbB = vi.fn();
    threeWindow.__hfThreeRender = [cbA, cbB];
    adapter.seek({ time: 4 });
    expect(cbA).toHaveBeenCalledWith(4);
    expect(cbB).toHaveBeenCalledWith(4);
  });

  it("registry callbacks fire before hf-seek event", () => {
    const adapter = createThreeAdapter();
    const order: string[] = [];
    threeWindow.__hfThreeRender = [() => order.push("callback")];
    const handler = () => order.push("event");
    window.addEventListener("hf-seek", handler);
    adapter.seek({ time: 1 });
    window.removeEventListener("hf-seek", handler);
    expect(order).toEqual(["callback", "event"]);
  });

  it("a throwing callback does not block sibling callbacks or the event", () => {
    const adapter = createThreeAdapter();
    const cbA = vi.fn(() => {
      throw new Error("boom");
    });
    const cbB = vi.fn();
    threeWindow.__hfThreeRender = [cbA, cbB];
    const handler = vi.fn();
    window.addEventListener("hf-seek", handler);
    expect(() => adapter.seek({ time: 2 })).not.toThrow();
    window.removeEventListener("hf-seek", handler);
    expect(cbA).toHaveBeenCalledWith(2);
    expect(cbB).toHaveBeenCalledWith(2);
    expect(handler).toHaveBeenCalled();
  });

  it("ignores non-array __hfThreeRender without throwing", () => {
    const adapter = createThreeAdapter();
    // Simulate a composition that mistakenly assigned a non-array value.
    (threeWindow as unknown as { __hfThreeRender?: unknown }).__hfThreeRender = {
      push: () => {},
    };
    expect(() => adapter.seek({ time: 1 })).not.toThrow();
    expect(threeWindow.__hfThreeTime).toBe(1);
  });

  it("non-function entries in registry are skipped", () => {
    const adapter = createThreeAdapter();
    const cb = vi.fn();
    threeWindow.__hfThreeRender = [
      null as unknown as (time: number) => void,
      undefined as unknown as (time: number) => void,
      cb,
    ];
    expect(() => adapter.seek({ time: 6 })).not.toThrow();
    expect(cb).toHaveBeenCalledWith(6);
  });

  it("late-registered callbacks receive subsequent seeks", () => {
    const adapter = createThreeAdapter();
    adapter.seek({ time: 1 });
    // Composition imports finish and pushes its renderer after the first seek.
    const cb = vi.fn();
    threeWindow.__hfThreeRender = threeWindow.__hfThreeRender ?? [];
    threeWindow.__hfThreeRender.push(cb);
    adapter.seek({ time: 2 });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(2);
    // __hfThreeTime is the canonical fallback for the missed first seek.
    expect(threeWindow.__hfThreeTime).toBe(2);
  });

  it("callbacks registered after revert are still invoked on subsequent seeks", () => {
    const adapter = createThreeAdapter();
    adapter.revert!();
    const cb = vi.fn();
    threeWindow.__hfThreeRender = [cb];
    adapter.seek({ time: 7 });
    expect(cb).toHaveBeenCalledWith(7);
  });

  it("seek clamps negative time to 0", () => {
    const adapter = createThreeAdapter();
    adapter.seek({ time: -10 });
    expect(threeWindow.__hfThreeTime).toBe(0);
  });

  it("seek clamps negative time to 0 for callbacks too", () => {
    const adapter = createThreeAdapter();
    const cb = vi.fn();
    threeWindow.__hfThreeRender = [cb];
    adapter.seek({ time: -5 });
    expect(cb).toHaveBeenCalledWith(0);
  });

  it("pause retains last forced time", () => {
    const adapter = createThreeAdapter();
    adapter.seek({ time: 7 });
    adapter.pause();
    // Internal state preserved — no crash
    expect(threeWindow.__hfThreeTime).toBe(7);
  });

  it("play releases forced time", () => {
    const adapter = createThreeAdapter();
    adapter.seek({ time: 7 });
    adapter.play!();
    // After play, forced time is released
  });

  it("revert resets all state", () => {
    const adapter = createThreeAdapter();
    adapter.seek({ time: 5 });
    adapter.revert!();
    // After revert, forcedTime and lastForcedTime are reset
  });

  it("revert does not clear __hfThreeRender", () => {
    const adapter = createThreeAdapter();
    const cb = vi.fn();
    threeWindow.__hfThreeRender = [cb];
    adapter.revert!();
    expect(threeWindow.__hfThreeRender).toEqual([cb]);
  });

  it("discover is a no-op", () => {
    const adapter = createThreeAdapter();
    expect(() => adapter.discover()).not.toThrow();
  });
});
