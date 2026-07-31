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
});
