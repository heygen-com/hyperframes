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

  it("drains success and failure generations registered after the capture wait starts", async () => {
    let finishFirst: (() => void) | undefined;
    let finishSecond: (() => void) | undefined;
    let failThird: ((reason: unknown) => void) | undefined;
    const firstGpuWork = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const secondGpuWork = new Promise<void>((resolve) => {
      finishSecond = resolve;
    });
    const thirdGpuWork = new Promise<void>((_resolve, reject) => {
      failThird = reject;
    });
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<HfSeekEventDetail>).detail;
      const gpuWork =
        detail.time === 13 ? firstGpuWork : detail.time === 14 ? secondGpuWork : thirdGpuWork;
      detail.waitUntil(gpuWork);
    };
    window.addEventListener("hf-seek", handler);
    dispatchSeekEvent(13);

    let settled = false;
    const failure = new Error("later GPU queue failed");
    const pending = waitForSeekCompletion()
      .then(() => {
        settled = true;
      })
      .catch((reason: unknown) => {
        settled = true;
        throw reason;
      });
    await Promise.resolve();

    forceDispatchSeekEvent(14);
    forceDispatchSeekEvent(15);
    finishFirst?.();
    await Promise.resolve();
    expect(settled).toBe(false);

    finishSecond?.();
    await Promise.resolve();
    expect(settled).toBe(false);

    failThird?.(failure);
    await expect(pending).rejects.toBe(failure);
    window.removeEventListener("hf-seek", handler);
    await expect(waitForSeekCompletion()).resolves.toBeUndefined();
  });

  it("does not retain empty or fulfilled heartbeat generations between captures", async () => {
    for (let i = 0; i < 20; i += 1) {
      forceDispatchSeekEvent(20);
    }

    const handler = (event: Event) => {
      (event as CustomEvent<HfSeekEventDetail>).detail.waitUntil(Promise.resolve());
    };
    window.addEventListener("hf-seek", handler);
    for (let i = 0; i < 20; i += 1) {
      forceDispatchSeekEvent(21);
    }
    window.removeEventListener("hf-seek", handler);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

    const promiseAll = vi.spyOn(Promise, "all");
    await waitForSeekCompletion();
    expect(promiseAll).not.toHaveBeenCalled();
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

  it("reports one rejected generation to concurrent capture barriers", async () => {
    let failGpuWork: ((reason: unknown) => void) | undefined;
    const gpuWork = new Promise<void>((_resolve, reject) => {
      failGpuWork = reject;
    });
    const failure = new Error("GPU queue failed");
    const handler = (event: Event) => {
      (event as CustomEvent<HfSeekEventDetail>).detail.waitUntil(gpuWork);
    };
    window.addEventListener("hf-seek", handler);
    dispatchSeekEvent(22);
    window.removeEventListener("hf-seek", handler);

    const firstCapture = waitForSeekCompletion();
    const secondCapture = waitForSeekCompletion();
    failGpuWork?.(failure);

    await expect(Promise.allSettled([firstCapture, secondCapture])).resolves.toEqual([
      { status: "rejected", reason: failure },
      { status: "rejected", reason: failure },
    ]);
    await expect(waitForSeekCompletion()).resolves.toBeUndefined();
  });
});
