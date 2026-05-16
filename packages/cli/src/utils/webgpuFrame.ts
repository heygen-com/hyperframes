import type { Page } from "puppeteer-core";

const DEFAULT_WEBGPU_FRAME_TIMEOUT_MS = 5_000;

export async function waitForOptionalWebGpuFrame(
  page: Page,
  time: number,
  timeoutMs: number = DEFAULT_WEBGPU_FRAME_TIMEOUT_MS,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      page.evaluate(async (frameTime: number) => {
        const w = window as unknown as {
          __hfWebGpu?: {
            devices?: readonly unknown[];
            pendingFrameCount?: number;
            waitForFrame?: (time?: number) => Promise<void>;
          };
          __hfWebGpuFrameReady?:
            | boolean
            | PromiseLike<unknown>
            | ((time?: number) => unknown | PromiseLike<unknown>);
          __hfWebGpuWaitForFrame?: (time?: number) => unknown | PromiseLike<unknown>;
        };

        if (typeof w.__hfWebGpuWaitForFrame === "function") {
          await w.__hfWebGpuWaitForFrame(frameTime);
          return;
        }

        const ready = w.__hfWebGpuFrameReady;
        if (ready !== undefined && ready !== true) {
          await Promise.resolve(typeof ready === "function" ? ready(frameTime) : ready);
          return;
        }

        const runtime = w.__hfWebGpu;
        const hasRuntimeWork =
          !!runtime &&
          ((Array.isArray(runtime.devices) && runtime.devices.length > 0) ||
            Number(runtime.pendingFrameCount) > 0);
        if (hasRuntimeWork && typeof runtime.waitForFrame === "function") {
          await runtime.waitForFrame(frameTime);
        }
      }, time),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
