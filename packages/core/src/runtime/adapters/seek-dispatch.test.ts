import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  dispatchSeekEvent,
  forceDispatchSeekEvent,
  resetSeekDispatchState,
  waitForSeekCompletion,
  type HfSeekEventDetail,
} from "./seek-dispatch";

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

  it("waits for all GPU work registered synchronously by listeners", async () => {
    let finish: (() => void) | undefined;
    const gpuWork = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const handler = (event: Event) => {
      (event as CustomEvent<HfSeekEventDetail>).detail.waitUntil(gpuWork);
    };
    window.addEventListener("hf-seek", handler);
    dispatchSeekEvent(9);
    window.removeEventListener("hf-seek", handler);

    let settled = false;
    const pending = waitForSeekCompletion().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    finish?.();
    await pending;
    expect(settled).toBe(true);
  });

  it("retains overlapping seek generations until a capture observes them", async () => {
    let finishFirst: (() => void) | undefined;
    let finishSecond: (() => void) | undefined;
    const firstGpuWork = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const secondGpuWork = new Promise<void>((resolve) => {
      finishSecond = resolve;
    });
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<HfSeekEventDetail>).detail;
      detail.waitUntil(detail.time === 10 ? firstGpuWork : secondGpuWork);
    };
    window.addEventListener("hf-seek", handler);
    dispatchSeekEvent(10);
    dispatchSeekEvent(11);
    window.removeEventListener("hf-seek", handler);

    let settled = false;
    const pending = waitForSeekCompletion().then(() => {
      settled = true;
    });
    finishSecond?.();
    await Promise.resolve();
    expect(settled).toBe(false);

    finishFirst?.();
    await pending;
    expect(settled).toBe(true);
  });

  it("reports a rejected generation once, then consumes it", async () => {
    const failure = new Error("GPU queue failed");
    const handler = (event: Event) => {
      (event as CustomEvent<HfSeekEventDetail>).detail.waitUntil(Promise.reject(failure));
    };
    window.addEventListener("hf-seek", handler);
    dispatchSeekEvent(12);
    window.removeEventListener("hf-seek", handler);

    await expect(waitForSeekCompletion()).rejects.toBe(failure);
    await expect(waitForSeekCompletion()).resolves.toBeUndefined();
  });
});
