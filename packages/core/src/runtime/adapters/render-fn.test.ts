import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRenderFnAdapter } from "./render-fn";

const renderWindow = window as Window & {
  __hfRender?: Array<(timeSeconds: number) => void>;
  __hfTime?: number;
};

describe("render-fn adapter", () => {
  beforeEach(() => {
    delete renderWindow.__hfRender;
    delete renderWindow.__hfTime;
  });

  afterEach(() => {
    delete renderWindow.__hfRender;
    delete renderWindow.__hfTime;
  });

  it("has correct name", () => {
    expect(createRenderFnAdapter().name).toBe("render-fn");
  });

  describe("seek", () => {
    it("invokes the registered callback with the seek time in seconds", () => {
      const render = vi.fn();
      renderWindow.__hfRender = [render];
      createRenderFnAdapter().seek({ time: 2.5 });
      expect(render).toHaveBeenCalledWith(2.5);
    });

    it("invokes every registered callback in sync", () => {
      const a = vi.fn();
      const b = vi.fn();
      renderWindow.__hfRender = [a, b];
      createRenderFnAdapter().seek({ time: 1.5 });
      expect(a).toHaveBeenCalledWith(1.5);
      expect(b).toHaveBeenCalledWith(1.5);
    });

    it("mirrors the current time onto window.__hfTime", () => {
      renderWindow.__hfRender = [vi.fn()];
      createRenderFnAdapter().seek({ time: 3.25 });
      expect(renderWindow.__hfTime).toBe(3.25);
    });

    it("clamps negative time to 0", () => {
      const render = vi.fn();
      renderWindow.__hfRender = [render];
      createRenderFnAdapter().seek({ time: -3 });
      expect(render).toHaveBeenCalledWith(0);
    });

    it("is repeatable — same time twice yields the same call", () => {
      const render = vi.fn();
      renderWindow.__hfRender = [render];
      const adapter = createRenderFnAdapter();
      adapter.seek({ time: 1 });
      adapter.seek({ time: 1 });
      expect(render).toHaveBeenNthCalledWith(1, 1);
      expect(render).toHaveBeenNthCalledWith(2, 1);
    });

    it("supports arbitrary seek order (forward, backward, repeat)", () => {
      const render = vi.fn();
      renderWindow.__hfRender = [render];
      const adapter = createRenderFnAdapter();
      for (const t of [3, 0.5, 2.5, 0.5]) adapter.seek({ time: t });
      expect(render.mock.calls.map((c) => c[0])).toEqual([3, 0.5, 2.5, 0.5]);
    });

    it("does nothing when no callbacks are registered", () => {
      const adapter = createRenderFnAdapter();
      expect(() => adapter.seek({ time: 1 })).not.toThrow();
      expect(renderWindow.__hfTime).toBeUndefined();
    });

    it("ignores a non-array __hfRender value", () => {
      (renderWindow as { __hfRender?: unknown }).__hfRender = "nope";
      const adapter = createRenderFnAdapter();
      expect(() => adapter.seek({ time: 1 })).not.toThrow();
    });

    it("continues rendering remaining callbacks if one throws", () => {
      const bad = vi.fn(() => {
        throw new Error("boom");
      });
      const good = vi.fn();
      renderWindow.__hfRender = [bad, good];
      createRenderFnAdapter().seek({ time: 1 });
      expect(good).toHaveBeenCalledWith(1);
    });

    it("does not invoke callbacks registered during the same seek", () => {
      const adapter = createRenderFnAdapter();
      const late = vi.fn();
      const early = vi.fn(() => {
        renderWindow.__hfRender!.push(late);
      });
      renderWindow.__hfRender = [early];
      adapter.seek({ time: 1 });
      expect(early).toHaveBeenCalledTimes(1);
      expect(late).not.toHaveBeenCalled();
      // The late registration is picked up on the next seek.
      adapter.seek({ time: 2 });
      expect(late).toHaveBeenCalledWith(2);
    });
  });

  describe("discover / pause", () => {
    it("discover does not throw and does not require callbacks", () => {
      const adapter = createRenderFnAdapter();
      expect(() => adapter.discover()).not.toThrow();
    });

    it("pause is a no-op and does not throw", () => {
      renderWindow.__hfRender = [vi.fn()];
      const adapter = createRenderFnAdapter();
      expect(() => adapter.pause()).not.toThrow();
    });
  });
});
