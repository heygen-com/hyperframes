import type { RuntimeDeterministicAdapter } from "../types";
import { dispatchSeekEvent } from "./seek-dispatch";

type WebGpuDeviceLike = {
  queue?: {
    submit?: (...args: unknown[]) => unknown;
    onSubmittedWorkDone?: () => Promise<unknown>;
  };
};

type WebGpuAdapterLike = {
  requestDevice?: (...args: unknown[]) => WebGpuDeviceLike | PromiseLike<WebGpuDeviceLike>;
};

type WebGpuLike = {
  requestAdapter?: (
    ...args: unknown[]
  ) => WebGpuAdapterLike | null | PromiseLike<WebGpuAdapterLike | null>;
};

type WebGpuWork =
  | boolean
  | PromiseLike<unknown>
  | ((time?: number) => unknown | PromiseLike<unknown>)
  | null
  | undefined;

type WebGpuRuntime = {
  readonly devices: readonly WebGpuDeviceLike[];
  readonly pendingFrameCount: number;
  readonly submittedFrameCount: number;
  registerDevice: (device: WebGpuDeviceLike) => void;
  registerFrame: (work: WebGpuWork) => Promise<unknown>;
  setReady: (work: WebGpuWork) => Promise<unknown>;
  waitUntilReady: () => Promise<void>;
  waitForFrame: (time?: number, requireSubmission?: boolean) => Promise<void>;
  discardPendingFrames: () => void;
};

type WebGpuWindow = Window & {
  __hfWebGpu?: WebGpuRuntime;
  __hfWebGpuReady?: WebGpuWork;
  __hfWebGpuFrameReady?: WebGpuWork;
  __hfWebGpuWaitForFrame?: (time?: number) => unknown | PromiseLike<unknown>;
  __hfRegisterWebGpuDevice?: (device: WebGpuDeviceLike) => void;
  __hfRegisterWebGpuFrame?: (work: WebGpuWork) => Promise<unknown>;
};

const WEBGPU_QUEUE_FENCE_TIMEOUT_MS = 1_000;
const WEBGPU_RAF_SETTLE_TIMEOUT_MS = 50;

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function resolveWork(work: WebGpuWork | undefined, time?: number): Promise<unknown> | null {
  if (work == null || work === true) return null;
  if (work === false) return Promise.resolve();
  try {
    const value = typeof work === "function" ? work(time) : work;
    return isThenable(value) ? Promise.resolve(value) : Promise.resolve(value);
  } catch (err) {
    return Promise.reject(err);
  }
}

function nextAnimationFrameOrTimeout(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof window.setTimeout> | undefined;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (timeout !== undefined) window.clearTimeout(timeout);
      resolve();
    };

    timeout = window.setTimeout(finish, WEBGPU_RAF_SETTLE_TIMEOUT_MS);
    window.requestAnimationFrame(finish);
  });
}

async function waitForQueueFences(promises: Promise<unknown>[]): Promise<"settled" | "timeout"> {
  if (promises.length === 0) return "settled";
  return Promise.race([
    Promise.allSettled(promises).then(() => "settled" as const),
    new Promise<"timeout">((resolve) => {
      window.setTimeout(() => resolve("timeout"), WEBGPU_QUEUE_FENCE_TIMEOUT_MS);
    }),
  ]);
}

function installWebGpuRuntime(): void {
  const w = window as WebGpuWindow;
  if (w.__hfWebGpu) return;

  const devices = new Set<WebGpuDeviceLike>();
  const instrumentedAdapters = new WeakSet<object>();
  const instrumentedGpuObjects = new WeakSet<object>();
  const instrumentedQueues = new WeakSet<object>();
  const pendingFrames = new Set<Promise<unknown>>();
  let submittedFrameCount = 0;
  let readyPromise: Promise<unknown> | null = null;
  let warnedQueueFenceTimeout = false;
  let resolveFirstSubmission: (() => void) | null = null;
  const firstSubmissionPromise = new Promise<void>((resolve) => {
    resolveFirstSubmission = resolve;
  });

  const trackFrame = (work: WebGpuWork): Promise<unknown> => {
    const promise = resolveWork(work) ?? Promise.resolve();
    submittedFrameCount += 1;
    resolveFirstSubmission?.();
    resolveFirstSubmission = null;
    pendingFrames.add(promise);
    void promise
      .finally(() => {
        pendingFrames.delete(promise);
      })
      .catch(() => {});
    return promise;
  };

  const instrumentDeviceQueue = (device: WebGpuDeviceLike): void => {
    const queue = device.queue;
    if (!queue || typeof queue !== "object" || typeof queue.submit !== "function") return;
    if (instrumentedQueues.has(queue)) return;
    instrumentedQueues.add(queue);

    const originalSubmit = queue.submit.bind(queue);
    try {
      queue.submit = (...args: unknown[]) => {
        const result = originalSubmit(...args);
        const fence = queue.onSubmittedWorkDone?.();
        if (fence) trackFrame(fence);
        return result;
      };
    } catch {
      // Some browser implementations may expose submit as non-writable. In
      // that case explicit registerFrame(...) calls still provide the fence.
    }
  };

  const registerDevice = (device: WebGpuDeviceLike): void => {
    if (device) {
      devices.add(device);
      instrumentDeviceQueue(device);
    }
  };

  const instrumentAdapter = (adapter: WebGpuAdapterLike | null | undefined): void => {
    if (!adapter || typeof adapter !== "object" || typeof adapter.requestDevice !== "function") {
      return;
    }
    if (instrumentedAdapters.has(adapter)) return;
    instrumentedAdapters.add(adapter);

    const originalRequestDevice = adapter.requestDevice.bind(adapter);
    try {
      adapter.requestDevice = (...args: unknown[]) => {
        const deviceOrPromise = originalRequestDevice(...args);
        const registerResolvedDevice = (device: WebGpuDeviceLike): WebGpuDeviceLike => {
          registerDevice(device);
          return device;
        };
        return isThenable(deviceOrPromise)
          ? Promise.resolve(deviceOrPromise).then(registerResolvedDevice)
          : registerResolvedDevice(deviceOrPromise);
      };
    } catch {
      // Some browser implementations may expose requestDevice as non-writable.
      // In that case explicit registerDevice(...) calls still provide the hook.
    }
  };

  const instrumentNavigatorGpu = (): void => {
    const nav = window.navigator as Navigator & { gpu?: WebGpuLike };
    const gpu = nav.gpu;
    if (!gpu || typeof gpu !== "object" || typeof gpu.requestAdapter !== "function") return;
    if (instrumentedGpuObjects.has(gpu)) return;
    instrumentedGpuObjects.add(gpu);

    const originalRequestAdapter = gpu.requestAdapter.bind(gpu);
    try {
      gpu.requestAdapter = (...args: unknown[]) => {
        const adapterOrPromise = originalRequestAdapter(...args);
        const instrumentResolvedAdapter = (
          adapter: WebGpuAdapterLike | null,
        ): WebGpuAdapterLike | null => {
          instrumentAdapter(adapter);
          return adapter;
        };
        return isThenable(adapterOrPromise)
          ? Promise.resolve(adapterOrPromise).then(instrumentResolvedAdapter)
          : instrumentResolvedAdapter(adapterOrPromise);
      };
    } catch {
      // If navigator.gpu is not patchable, authored registerDevice/registerFrame
      // calls remain the deterministic capture contract.
    }
  };

  const runtime: WebGpuRuntime = {
    get devices() {
      return Array.from(devices);
    },

    get pendingFrameCount() {
      return pendingFrames.size;
    },

    get submittedFrameCount() {
      return submittedFrameCount;
    },

    registerDevice,

    registerFrame: (work) => trackFrame(work),

    setReady: (work) => {
      readyPromise = resolveWork(work) ?? Promise.resolve();
      return readyPromise;
    },

    discardPendingFrames: () => {
      pendingFrames.clear();
    },

    waitUntilReady: async () => {
      const authorReady = resolveWork(w.__hfWebGpuReady);
      await Promise.all([readyPromise, authorReady].filter(Boolean));
    },

    waitForFrame: async (time, requireSubmission = false) => {
      const explicitWait = w.__hfWebGpuWaitForFrame;
      if (typeof explicitWait === "function") {
        await explicitWait(time);
      }

      const authorFrameReady = resolveWork(w.__hfWebGpuFrameReady, time);
      if (authorFrameReady) await authorFrameReady;

      const inFlight = Array.from(pendingFrames);
      if (inFlight.length > 0) {
        const result = await waitForQueueFences(inFlight);
        if (result === "timeout") {
          for (const promise of inFlight) pendingFrames.delete(promise);
          if (!warnedQueueFenceTimeout) {
            warnedQueueFenceTimeout = true;
            console.warn(
              "[HyperFrames] WebGPU queue fence did not resolve quickly; continuing after compositor frames.",
            );
          }
        }
      }

      if (requireSubmission && submittedFrameCount === 0 && devices.size > 0) {
        await firstSubmissionPromise;
      }

      if (inFlight.length === 0) {
        const queueWork = Array.from(devices)
          .map((device) => device.queue?.onSubmittedWorkDone?.())
          .filter((promise): promise is Promise<unknown> => !!promise);
        if (queueWork.length > 0) {
          const result = await waitForQueueFences(queueWork);
          if (result === "timeout" && !warnedQueueFenceTimeout) {
            warnedQueueFenceTimeout = true;
            console.warn(
              "[HyperFrames] WebGPU queue fence did not resolve quickly; continuing after compositor frames.",
            );
          }
        }
      }

      await nextAnimationFrameOrTimeout();
      await nextAnimationFrameOrTimeout();
    },
  };

  w.__hfWebGpu = runtime;
  w.__hfRegisterWebGpuDevice = runtime.registerDevice;
  w.__hfRegisterWebGpuFrame = runtime.registerFrame;
  instrumentNavigatorGpu();
}

if (typeof window !== "undefined") {
  installWebGpuRuntime();
}

/**
 * TypeGPU / WebGPU adapter for HyperFrames
 *
 * Enables seekable GPU-rendered compositions built with TypeGPU or raw WebGPU.
 * Since WebGPU pipelines are not introspectable from outside (unlike GSAP
 * timelines or Lottie instances), this adapter uses the same push+poll pattern
 * as the Three.js adapter:
 *
 *   - `window.__hfTypegpuTime` — poll this from your rAF/render loop instead
 *     of `performance.now()` to get the current seek position in seconds.
 *
 *   - `"hf-seek"` CustomEvent on `window` — listen for this to imperatively
 *     re-render a single frame at the new seek position.
 *
 * ## Usage in a composition
 *
 * ```html
 * <canvas id="gpu-canvas" width="1920" height="1080"></canvas>
 * <script type="module">
 *   const adapter = await navigator.gpu.requestAdapter();
 *   const device  = await adapter.requestDevice();
 *   window.__hfWebGpu?.registerDevice(device);
 *   // ... build your pipeline ...
 *
 *   function render(timeSeconds) {
 *     // update your time uniform and submit a draw call
 *     device.queue.writeBuffer(uniformBuf, 0, new Float32Array([timeSeconds]));
 *     // ... submit command encoder ...
 *     window.__hfWebGpu?.registerFrame(device.queue.onSubmittedWorkDone());
 *   }
 *
 *   // Seek: fired by HyperFrames whenever the player scrubs or plays
 *   window.addEventListener("hf-seek", (e) => render(e.detail.time));
 *
 *   // Initial frame at t=0
 *   render(window.__hfTypegpuTime ?? 0);
 * </script>
 * ```
 *
 * Works with TypeGPU (https://docs.swmansion.com/TypeGPU) and raw WebGPU alike.
 * The adapter makes no assumptions about how the pipeline is constructed.
 * Multiple canvases / renderers are supported — each listens for the same event.
 *
 * ## Render-mode determinism
 *
 * For frame-perfect video renders, register the device or a per-frame fence
 * with `window.__hfWebGpu`. The engine waits for those fences before
 * screenshot capture so WebGPU canvases compose with DOM/canvas layers.
 *
 * ## Browser feature detection
 *
 * Always guard against environments where WebGPU is unavailable:
 *
 * ```js
 * if (!navigator.gpu) { /* fallback or early return *\/ }
 * const adapter = await navigator.gpu.requestAdapter();
 * if (!adapter)       { /* GPU unavailable — software fallback *\/ }
 * ```
 *
 * The adapter itself does not check for WebGPU support — that is the
 * composition author's responsibility.
 */
export function createTypegpuAdapter(): RuntimeDeterministicAdapter {
  let forcedTime: number | null = null;
  let lastForcedTime = 0;

  return {
    name: "typegpu",

    discover: () => {
      installWebGpuRuntime();
      // WebGPU pipelines have no global registry — nothing to auto-discover.
    },

    seek: (ctx) => {
      installWebGpuRuntime();
      forcedTime = Math.max(0, Number(ctx.time) || 0);
      lastForcedTime = forcedTime;
      window.__hfTypegpuTime = forcedTime;
      dispatchSeekEvent(forcedTime);
    },

    pause: () => {
      if (forcedTime == null) {
        forcedTime = Math.max(0, lastForcedTime);
      }
    },

    play: () => {
      forcedTime = null;
    },

    revert: () => {
      forcedTime = null;
      lastForcedTime = 0;
    },
  };
}
