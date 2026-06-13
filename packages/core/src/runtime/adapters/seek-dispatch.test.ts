import { describe, it, expect, vi, beforeEach } from "vitest";
import { dispatchSeekEvent, forceDispatchSeekEvent, resetSeekDispatchState } from "./seek-dispatch";

describe("seek-dispatch", () => {
  beforeEach(() => {
    resetSeekDispatchState();
  });

  it("dispatchSeekEvent fires an hf-seek event with the time", () => {
    const handler = vi.fn();
    window.addEventListener("hf-seek", handler);
    dispatchSeekEvent(2.5);
    window.removeEventListener("hf-seek", handler);
    expect(handler).toHaveBeenCalledTimes(1);
    expect((handler.mock.calls[0][0] as CustomEvent).detail.time).toBe(2.5);
  });

  it("dispatchSeekEvent dedups consecutive same-time dispatches", () => {
    const handler = vi.fn();
    window.addEventListener("hf-seek", handler);
    dispatchSeekEvent(4);
    dispatchSeekEvent(4);
    window.removeEventListener("hf-seek", handler);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("forceDispatchSeekEvent re-fires even at the same time (post-injection re-render)", () => {
    const handler = vi.fn();
    window.addEventListener("hf-seek", handler);
    dispatchSeekEvent(6); // GPU adapters' first render at t=6
    forceDispatchSeekEvent(6); // engine re-render after video injection, same t
    window.removeEventListener("hf-seek", handler);
    expect(handler).toHaveBeenCalledTimes(2);
    expect((handler.mock.calls[1][0] as CustomEvent).detail.time).toBe(6);
  });

  it("after a force dispatch, the same time still dedups on the normal path", () => {
    const handler = vi.fn();
    window.addEventListener("hf-seek", handler);
    forceDispatchSeekEvent(8);
    dispatchSeekEvent(8); // deduped — force already recorded t=8
    window.removeEventListener("hf-seek", handler);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
