// fallow-ignore-file code-duplication
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { waitForPendingSeekCompletion } from "./frameCapture.js";

describe("WebGPU frame completion", () => {
  it("blocks capture preparation until the runtime completion promise settles", async () => {
    let finish: (() => void) | undefined;
    const gpuWork = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const previousWindow = Reflect.get(globalThis, "window");
    Reflect.set(globalThis, "window", { __hfWaitForSeekCompletion: () => gpuWork });
    const page = {
      evaluate: vi.fn(async (pageFunction: () => unknown) => pageFunction()),
    };

    try {
      let settled = false;
      const pending = waitForPendingSeekCompletion(page).then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      finish?.();
      await pending;
      expect(settled).toBe(true);
    } finally {
      if (previousWindow === undefined) Reflect.deleteProperty(globalThis, "window");
      else Reflect.set(globalThis, "window", previousWindow);
    }
  });

  it("runs the completion wait after video injection and before screenshot capture", () => {
    const source = readFileSync(new URL("./frameCapture.ts", import.meta.url), "utf8");
    const injection = source.indexOf("await session.onBeforeCapture(page, quantizedTime)");
    const completion = source.indexOf("await waitForPendingSeekCompletion(page)");
    const screenshot = source.indexOf("async function captureFrameCore");
    expect(injection).toBeGreaterThan(-1);
    expect(completion).toBeGreaterThan(injection);
    expect(screenshot).toBeGreaterThan(completion);
  });
});
