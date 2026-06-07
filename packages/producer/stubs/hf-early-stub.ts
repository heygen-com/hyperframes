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
 * Render-mode correctness: `window.__renderReady` is intentionally not gated
 * here because the bridge script's `window.__hf.duration` getter already waits
 * for `window.__player.getDuration() > 0`, which only becomes true after
 * `bindRootTimelineIfAvailable()` completes in `init.ts`, which happens after
 * the `"hf-timelines-built"` listener fires. No separate gate is needed.
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
    };
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

type TweenMethod = "to" | "from" | "fromTo" | "set";

interface TweenDescriptor {
  method: TweenMethod;
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
  __hfQueue: TweenDescriptor[];
}

// ─── Module-level state ───────────────────────────────────────────────────────

const BATCH_SIZE = 100;
const activeProxies: TimelineProxy[] = [];
let batchScheduled = false;

function requestBatchFrame(callback: FrameRequestCallback): number {
  const originalRequestAnimationFrame = window.__HF_VIRTUAL_TIME__?.originalRequestAnimationFrame;
  if (typeof originalRequestAnimationFrame === "function") {
    return originalRequestAnimationFrame(callback);
  }
  return requestAnimationFrame(callback);
}

// ─── Batch flusher ────────────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
function flushBatch(): void {
  batchScheduled = false;
  let anyRemaining = false;

  for (const proxy of activeProxies) {
    if (proxy.__hfQueue.length === 0) continue;
    const batch = proxy.__hfQueue.splice(0, BATCH_SIZE);
    const real = proxy.__hfReal;
    for (const entry of batch) {
      const fn = real[entry.method];
      if (typeof fn === "function") {
        (fn as (...args: unknown[]) => unknown).call(real, ...entry.args);
      }
    }
    if (proxy.__hfQueue.length > 0) anyRemaining = true;
  }

  if (anyRemaining) {
    batchScheduled = true;
    requestBatchFrame(flushBatch);
  } else {
    window.__hfTimelinesBuilding = false;
    try {
      window.dispatchEvent(new CustomEvent("hf-timelines-built"));
    } catch {
      // ignore — CustomEvent unavailable in some test environments
    }
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
function wrapTimeline(real: GsapTimeline): TimelineProxy {
  const proxy: TimelineProxy = {
    __hfReal: real,
    __hfQueue: [],

    // ── Queued mutating methods ──────────────────────────────────────────────
    to(...args: unknown[]): TimelineProxy {
      proxy.__hfQueue.push({ method: "to", args });
      scheduleBatch();
      return proxy;
    },
    from(...args: unknown[]): TimelineProxy {
      proxy.__hfQueue.push({ method: "from", args });
      scheduleBatch();
      return proxy;
    },
    fromTo(...args: unknown[]): TimelineProxy {
      proxy.__hfQueue.push({ method: "fromTo", args });
      scheduleBatch();
      return proxy;
    },
    set(...args: unknown[]): TimelineProxy {
      proxy.__hfQueue.push({ method: "set", args });
      scheduleBatch();
      return proxy;
    },

    // ── Forwarded chain methods — delegate to real, return proxy ─────────────
    pause(...args: unknown[]): TimelineProxy {
      real.pause(...args);
      return proxy;
    },
    play(...args: unknown[]): TimelineProxy {
      real.play(...args);
      return proxy;
    },
    seek(...args: unknown[]): TimelineProxy {
      real.seek(...args);
      return proxy;
    },
    add(...args: unknown[]): TimelineProxy {
      // Unwrap proxy children so GSAP's internal tween graph (_first/_next/_prev
      // linkage) holds real timeline references, not proxy objects that lack
      // internal GSAP fields like `_dp`.
      const unwrapped = args.map((a) =>
        a !== null && typeof a === "object" && "__hfReal" in (a as Record<string, unknown>)
          ? (a as TimelineProxy).__hfReal
          : a,
      );
      real.add(...unwrapped);
      return proxy;
    },

    // ── Forwarded value-returning methods ────────────────────────────────────
    // Getter form (no args) → return the real value.
    // Setter form (args.length > 0) → forward to real, then return proxy so
    // callers can chain `.to(...)` against the proxy rather than leaking the
    // real timeline out of the batching chain.
    totalTime(...args: unknown[]): unknown {
      const result = real.totalTime(...args);
      return args.length > 0 ? proxy : result;
    },
    time(...args: unknown[]): unknown {
      const result = real.time(...args);
      return args.length > 0 ? proxy : result;
    },
    duration(...args: unknown[]): unknown {
      return real.duration(...args);
    },
    paused(...args: unknown[]): unknown {
      const result = real.paused(...args);
      return args.length > 0 ? proxy : result;
    },
    timeScale(...args: unknown[]): unknown {
      const result = real.timeScale(...args);
      return args.length > 0 ? proxy : result;
    },
    kill(): void {
      real.kill();
    },
  };

  activeProxies.push(proxy);
  return proxy;
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
