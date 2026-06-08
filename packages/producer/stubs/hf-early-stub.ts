// fallow-ignore-file unused-file
/**
 * HyperFrames early stub — injected at the very start of `<head>` before any
 * other scripts run. Compiled to an IIFE by scripts/build-hf-early-stub.ts.
 *
 * This file lives outside `src/` intentionally: it is compiled by a separate
 * esbuild step, NOT by the producer's tsc. Only the generated output
 * (src/generated/hf-early-stub-inline.ts) is type-checked by tsc.
 *
 * Responsibilities
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. Create `window.__hf` so page scripts can write to it before the bridge
 *      loads (e.g. @hyperframes/shader-transitions writes transition metadata
 *      during its init() call, which runs before end-of-body scripts).
 *
 *   2. Intercept `window.gsap` assignment and batch `timeline.to/from/fromTo/set`
 *      calls via requestAnimationFrame to prevent the main-thread hang described
 *      in https://github.com/heygen-com/hyperframes/issues/1231.
 *
 * GSAP batching background
 * ─────────────────────────────────────────────────────────────────────────────
 * Compositions with very large tween counts (thousands of `tl.to()` calls) block
 * Chrome's main thread synchronously during HTML parsing, preventing
 * DOMContentLoaded from firing before Puppeteer's navigation timeout. Each
 * `tl.to()` triggers a synchronous GSAP state recomputation; 8 000+ calls in a
 * row have been observed to hold the thread for >60 s.
 *
 * Fix: intercept `gsap.timeline()` via an `Object.defineProperty` trap on
 * `window`. GSAP is not yet loaded when this stub runs — it loads via a
 * `<script>` tag in the HTML body. The trap replaces every returned timeline
 * with a proxy that queues to/from/fromTo/set descriptors instead of executing
 * them immediately. A `requestAnimationFrame` loop drains the queue in batches
 * of BATCH_SIZE, yielding the main thread between batches so DCL can fire.
 *
 * When all queues are empty a `"hf-timelines-built"` CustomEvent is dispatched
 * on `window` and `window.__hfTimelinesBuilding` is set to `false`. The runtime
 * in `init.ts` listens for this event to rebind the timeline after batching
 * completes (the captured timeline reference remains valid — the proxy delegates
 * all non-mutating calls to the real timeline throughout).
 *
 * Render-mode correctness: `init.ts` gates `__renderReady` on
 * `__hfTimelinesBuilding` via `maybePublishRenderReady()`. When batching
 * starts after init (setTimeout-deferred timelines), `maybePublishRenderReady`
 * re-registers a `hf-timelines-built` listener to retry once the batch
 * completes. The bridge's `__hf.duration` getter returns 0 until
 * `__renderReady` is true, keeping `pollHfReady` waiting.
 *
 * Batch size: ~100 tweens per rAF budget. Each batch completes in <4 ms on a
 * 2023 laptop at the 8 562-tween scale; 16 ms rAF budgets are never exhausted.
 */

// `export {}` makes this file an ES module so that `declare global` is valid.
// esbuild's IIFE format wraps the output in a self-executing function, so the
// export is elided and no module runtime is emitted.
export {};

declare global {
  interface Window {
    __hf?: Record<string, unknown>;
    __hfTimelinesBuilding?: boolean;
    __HF_VIRTUAL_TIME__?: {
      originalRequestAnimationFrame?: typeof window.requestAnimationFrame;
      originalSetTimeout?: typeof window.setTimeout;
    };
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

type TimelineOperationMethod = "to" | "from" | "fromTo" | "set" | "add";

interface TimelineOperation {
  proxy: TimelineProxy;
  method: TimelineOperationMethod;
  args: unknown[];
}

/**
 * Minimal GSAP timeline surface exposed to this stub.
 *
 * All methods return `unknown` for values (rather than `this`) so that
 * `TimelineProxy` can implement them without strict subtype constraints.
 * Callers that need the real return value (e.g. duration()) receive it via
 * forwarded delegation on `proxy.__hfReal`.
 */
interface GsapTimeline {
  to(...args: unknown[]): unknown;
  from(...args: unknown[]): unknown;
  fromTo(...args: unknown[]): unknown;
  set(...args: unknown[]): unknown;
  pause(...args: unknown[]): unknown;
  play(...args: unknown[]): unknown;
  seek(...args: unknown[]): unknown;
  totalTime(...args: unknown[]): unknown;
  time(...args: unknown[]): unknown;
  duration(...args: unknown[]): unknown;
  add(...args: unknown[]): unknown;
  getChildren(...args: unknown[]): unknown[];
  paused(...args: unknown[]): unknown;
  timeScale(...args: unknown[]): unknown;
  kill(): void;
  [key: string]: unknown;
}

interface GsapInstance {
  timeline(params?: unknown): GsapTimeline;
  [key: string]: unknown;
}

/**
 * A proxy returned in place of a real GSAP timeline during batching.
 *
 * Mutating methods (to/from/fromTo/set) enqueue descriptors and return the
 * proxy for chaining. Forwarded methods delegate straight to the real timeline
 * and also return `proxy` for chaining, so composed call chains work correctly.
 */
interface TimelineProxy extends GsapTimeline {
  __hfReal: GsapTimeline;
  __hfQueue: TimelineOperation[];
  __hfIsProxy?: true;
}

// ─── Module-level state ───────────────────────────────────────────────────────

const BATCH_SIZE = 100;
const activeProxies: TimelineProxy[] = [];
const pendingOperations: TimelineOperation[] = [];
let batchScheduled = false;
let publishCheckScheduled = false;

function requestBatchFrame(callback: FrameRequestCallback): number {
  const originalRequestAnimationFrame = window.__HF_VIRTUAL_TIME__?.originalRequestAnimationFrame;
  if (typeof originalRequestAnimationFrame === "function") {
    return originalRequestAnimationFrame(callback);
  }
  return requestAnimationFrame(callback);
}

function scheduleAfterScriptStack(callback: () => void): void {
  const originalSetTimeout = window.__HF_VIRTUAL_TIME__?.originalSetTimeout;
  if (typeof originalSetTimeout === "function") {
    originalSetTimeout(callback, 0);
    return;
  }
  setTimeout(callback, 0);
}

// ─── Batch flusher ────────────────────────────────────────────────────────────

function unwrapTimelineArg(arg: unknown): unknown {
  if (
    arg !== null &&
    typeof arg === "object" &&
    "__hfIsProxy" in (arg as Record<string, unknown>)
  ) {
    return (arg as TimelineProxy).__hfReal;
  }
  return arg;
}

function applyTimelineOperation(entry: TimelineOperation): void {
  const real = entry.proxy.__hfReal;
  const fn = real[entry.method];
  if (typeof fn === "function") {
    const args = entry.method === "add" ? entry.args.map(unwrapTimelineArg) : entry.args;
    (fn as (...args: unknown[]) => unknown).call(real, ...args);
  }
}

function enqueueTimelineOperation(
  proxy: TimelineProxy,
  method: TimelineOperationMethod,
  args: unknown[],
): TimelineProxy {
  const entry = { proxy, method, args };
  proxy.__hfQueue.push(entry);
  pendingOperations.push(entry);
  scheduleBatch();
  return proxy;
}

function removeProxyQueueEntry(entry: TimelineOperation): void {
  const index = entry.proxy.__hfQueue.indexOf(entry);
  if (index >= 0) entry.proxy.__hfQueue.splice(index, 1);
}

function flushPendingOperations(): void {
  while (pendingOperations.length > 0) {
    const entry = pendingOperations.shift();
    if (!entry) continue;
    removeProxyQueueEntry(entry);
    applyTimelineOperation(entry);
  }
  scheduleTimelinesBuiltCheck();
}

function publishTimelinesBuilt(): void {
  publishCheckScheduled = false;
  window.__hfTimelinesBuilding = false;
  try {
    window.dispatchEvent(new CustomEvent("hf-timelines-built"));
  } catch {
    // ignore — CustomEvent unavailable in some test environments
  }
}

function scheduleTimelinesBuiltCheck(): void {
  if (publishCheckScheduled) return;
  publishCheckScheduled = true;
  scheduleAfterScriptStack(() => {
    if (pendingOperations.length === 0) {
      publishTimelinesBuilt();
    } else {
      publishCheckScheduled = false;
    }
  });
}

// fallow-ignore-next-line complexity
function flushBatch(): void {
  batchScheduled = false;
  const batch = pendingOperations.splice(0, BATCH_SIZE);
  for (const entry of batch) {
    removeProxyQueueEntry(entry);
    applyTimelineOperation(entry);
  }

  if (pendingOperations.length > 0) {
    batchScheduled = true;
    requestBatchFrame(flushBatch);
  } else {
    publishTimelinesBuilt();
  }
}

function scheduleBatch(): void {
  if (!batchScheduled) {
    batchScheduled = true;
    window.__hfTimelinesBuilding = true;
    requestBatchFrame(flushBatch);
  }
}

// ─── Timeline proxy factory ───────────────────────────────────────────────────

/**
 * Create a queuing proxy around a real GSAP timeline.
 *
 * All methods return `proxy` so that callers who chain off the returned value
 * continue to go through the proxy for the duration of the batching phase.
 */
// Methods that queue operations for batched flush (mutating tween additions).
const BATCHED_METHODS = new Set<string>(["to", "from", "fromTo", "set", "add"]);
const PROXY_STATE_KEYS = new Set(["__hfReal", "__hfQueue", "__hfIsProxy"]);

function createFlushingMethodWrapper(
  real: GsapTimeline,
  fn: (...a: unknown[]) => unknown,
  proxyRef: () => unknown,
): (...args: unknown[]) => unknown {
  return (...args: unknown[]) => {
    flushPendingOperations();
    const result = fn.call(real, ...args);
    return result === real ? proxyRef() : result;
  };
}

function wrapTimeline(real: GsapTimeline): TimelineProxy {
  const state = {
    __hfReal: real,
    __hfQueue: [] as TimelineOperation[],
    __hfIsProxy: true as const,
  };

  // Use a Proxy so that ANY method or property access on the timeline is
  // forwarded to the real GSAP timeline after flushing pending operations.
  // The previous plain-object approach only forwarded an explicit allowlist,
  // which silently dropped calls like eventCallback(), vars, labels(),
  // repeat(), and other GSAP API surface — causing black frames when
  // compositions used anything outside the allowlist.
  const proxy = new Proxy(state, {
    // fallow-ignore-next-line complexity
    get(_target, prop, receiver) {
      if (PROXY_STATE_KEYS.has(prop as string)) {
        return state[prop as keyof typeof state];
      }
      if (typeof prop === "string" && BATCHED_METHODS.has(prop)) {
        return (...args: unknown[]) =>
          enqueueTimelineOperation(
            proxy as unknown as TimelineProxy,
            prop as TimelineOperationMethod,
            args,
          );
      }
      const value = (real as Record<string | symbol, unknown>)[prop];
      // Forwarded methods (getChildren, eventCallback, labels, etc.) flush
      // then delegate. Return values are NOT re-proxied — getChildren()
      // returns raw GSAP child timelines. This is intentional: batching
      // applies to the root timeline only; child timelines returned by
      // getChildren are used for enumeration/cleanup, not tween additions.
      if (typeof value === "function") {
        return createFlushingMethodWrapper(
          real,
          value as (...a: unknown[]) => unknown,
          () => receiver,
        );
      }
      // Non-function property reads also flush so post-batch reads (e.g.
      // tl.vars, tl.data) see state consistent with all applied tweens.
      if (value !== undefined) flushPendingOperations();
      return value;
    },

    set(_target, prop, value) {
      flushPendingOperations();
      (real as Record<string | symbol, unknown>)[prop] = value;
      return true;
    },
  });

  activeProxies.push(proxy as unknown as TimelineProxy);
  return proxy as unknown as TimelineProxy;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

if (typeof window !== "undefined") {
  if (!window.__hf) window.__hf = {};
  window.__hfTimelinesBuilding = false;

  // Intercept window.gsap assignment via a property trap so we can wrap
  // `gsap.timeline()` before any user script calls it. GSAP is not yet
  // loaded when this stub runs — it loads via a <script> tag in the HTML body.
  let _realGsap: GsapInstance | null = null;
  try {
    Object.defineProperty(window, "gsap", {
      configurable: true,
      enumerable: true,
      get(): GsapInstance | null {
        return _realGsap;
      },
      set(g: GsapInstance): void {
        _realGsap = g;
        if (!g || typeof g.timeline !== "function") return;
        const origTimeline = g.timeline.bind(g) as (params?: unknown) => GsapTimeline;
        g.timeline = (params?: unknown): GsapTimeline => wrapTimeline(origTimeline(params));
      },
    });
  } catch {
    // defineProperty failed (e.g. already non-configurable) — skip interception.
  }
}
