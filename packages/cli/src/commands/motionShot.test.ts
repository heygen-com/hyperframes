// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { seekAllAdaptersInBrowser } from "./motionShot.js";

const motionShotSourcePath = join(dirname(fileURLToPath(import.meta.url)), "motionShot.ts");
const motionWindow = window as Window & {
  __player?: { renderSeek?: (time: number) => void };
  __hfWaitForSeekCompletion?: () => Promise<void>;
};

afterEach(() => {
  delete motionWindow.__player;
  delete motionWindow.__hfWaitForSeekCompletion;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("motion-shot adapter seeking", () => {
  it("awaits GPU work registered by a standalone hf-seek listener", async () => {
    document.body.innerHTML =
      '<div data-composition-id="gpu" data-requires-webgpu data-duration="2"></div>';
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

  it("launches through the shared GPU policy and WebGPU requirement guard", () => {
    const source = readFileSync(motionShotSourcePath, "utf8");

    expect(source).toContain("resolveCaptureBrowserGpuMode");
    expect(source).toContain("assertWebGpuRequirement(html");
    expect(source).toContain("{ browserGpuMode: resolvedGpuMode }");
    expect(source).not.toContain('"--disable-gpu"');
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

  it("falls back to a completion-aware hf-seek when the runtime seek hook throws", async () => {
    let finishGpuWork!: () => void;
    const gpuWork = new Promise<void>((resolve) => {
      finishGpuWork = resolve;
    });
    const handler = vi.fn((event: Event) => {
      (
        event as CustomEvent<{
          waitUntil(promise: PromiseLike<unknown>): void;
        }>
      ).detail.waitUntil(gpuWork);
    });
    window.addEventListener("hf-seek", handler);
    motionWindow.__player = {
      renderSeek() {
        throw new Error("runtime seek failed");
      },
    };

    let settled = false;
    const seeking = seekAllAdaptersInBrowser(2.5).then(() => {
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

  it("drains runtime work when a runtime seek hook dispatches and then throws", async () => {
    let finishRuntimeGpuWork!: () => void;
    let finishFallbackGpuWork!: () => void;
    const runtimeGpuWork = new Promise<void>((resolve) => {
      finishRuntimeGpuWork = resolve;
    });
    const fallbackGpuWork = new Promise<void>((resolve) => {
      finishFallbackGpuWork = resolve;
    });
    let runtimeCompletion: Promise<void> | undefined;
    let dispatchCount = 0;
    const handler = (event: Event) => {
      dispatchCount += 1;
      (
        event as CustomEvent<{
          waitUntil(promise: PromiseLike<unknown>): void;
        }>
      ).detail.waitUntil(dispatchCount === 1 ? runtimeGpuWork : fallbackGpuWork);
    };
    window.addEventListener("hf-seek", handler);
    motionWindow.__player = {
      renderSeek(time) {
        const pending: PromiseLike<unknown>[] = [];
        window.dispatchEvent(
          new CustomEvent("hf-seek", {
            detail: {
              time,
              waitUntil(promise: PromiseLike<unknown>) {
                pending.push(promise);
              },
            },
          }),
        );
        runtimeCompletion = Promise.all(pending).then(() => undefined);
        throw new Error("runtime seek failed after dispatch");
      },
    };
    motionWindow.__hfWaitForSeekCompletion = () => runtimeCompletion ?? Promise.resolve();

    let settled = false;
    const seeking = seekAllAdaptersInBrowser(3).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(dispatchCount).toBe(2);

    finishFallbackGpuWork();
    await Promise.resolve();
    expect(settled).toBe(false);

    finishRuntimeGpuWork();
    await seeking;
    window.removeEventListener("hf-seek", handler);
    expect(settled).toBe(true);
  });
});
