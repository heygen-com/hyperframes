// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { seekAllAdaptersInBrowser } from "./motionShot.js";

const motionWindow = window as Window & {
  __player?: { renderSeek?: (time: number) => void };
  __hfWaitForSeekCompletion?: () => Promise<void>;
};

afterEach(() => {
  delete motionWindow.__player;
  delete motionWindow.__hfWaitForSeekCompletion;
  vi.restoreAllMocks();
});

describe("motion-shot adapter seeking", () => {
  it("awaits GPU work registered by a standalone hf-seek listener", async () => {
    let finishGpuWork!: () => void;
    const gpuWork = new Promise<void>((resolve) => {
      finishGpuWork = resolve;
    });
    const handler = (event: Event) => {
      (
        event as CustomEvent<{
          waitUntil(promise: PromiseLike<unknown>): void;
        }>
      ).detail.waitUntil(gpuWork);
    };
    window.addEventListener("hf-seek", handler);

    let settled = false;
    const seeking = seekAllAdaptersInBrowser(1.5).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    finishGpuWork();
    await seeking;
    window.removeEventListener("hf-seek", handler);
    expect(settled).toBe(true);
  });

  it("awaits the runtime completion hook without dispatching a second legacy seek event", async () => {
    let finishGpuWork!: () => void;
    const gpuWork = new Promise<void>((resolve) => {
      finishGpuWork = resolve;
    });
    const handler = vi.fn();
    window.addEventListener("hf-seek", handler);
    motionWindow.__player = {
      renderSeek(time) {
        window.dispatchEvent(new CustomEvent("hf-seek", { detail: { time } }));
      },
    };
    motionWindow.__hfWaitForSeekCompletion = () => gpuWork;

    let settled = false;
    const seeking = seekAllAdaptersInBrowser(2).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(handler).toHaveBeenCalledOnce();
    expect(settled).toBe(false);

    finishGpuWork();
    await seeking;
    window.removeEventListener("hf-seek", handler);
    expect(settled).toBe(true);
  });
});
