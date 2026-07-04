// fallow-ignore-file unused-file complexity
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
    /**
     * Set by the engine (evaluateOnNewDocument, before this stub) when fast
     * capture (drawElementImage) is active. Opt out per render with
     * HF_FAST_CAPTURE_AUTOALPHA=false.
     */
    __HF_FAST_CAPTURE_AUTOALPHA__?: boolean;
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
/**
 * Tween targets whose vars got the opacity → autoAlpha rewrite. Resolved and
 * visibility-hidden at flush completion when still at computed opacity 0 —
 * see hideTransparentAutoAlphaTargets.
 */
const autoAlphaRewrittenTargets = new Set<unknown>();

/**
 * Tween targets animated with 3D transform vars (rotationX / rotationY /
 * transformPerspective). drawElementImage cannot paint 3D transforms — the
 * engine's threeDProjection module re-projects these elements via WebGL and
 * reads this list at init to find targets whose transform is still flat at
 * t=0 (to()-style tweens never show up in a computed-style scan). Exposed as
 * window.__hf3dTweenTargets. rotationZ/rotation stay 2D and are not
 * recorded; a bare `z` without perspective has no visual effect.
 */
const threeDTweenTargets = new Set<unknown>();

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

/**
 * Fast-capture autoAlpha rewrite.
 *
 * Elements at `opacity: 0` still paint as transparent promoted compositor
 * layers. Stacked opacity-0 containers (the word-by-word caption pattern)
 * break drawElementImage capture (blackout / misplaced paint records) and
 * stall SwiftShader's first BeginFrame. GSAP's `autoAlpha` is the same fade
 * but additionally sets `visibility: hidden` at 0, removing the element from
 * the paint tree — measured on the chat CI comp: 29.4 → 49.6 dB
 * fast-vs-baseline with zero blackout frames.
 *
 * When the engine signals fast capture (`__HF_FAST_CAPTURE_AUTOALPHA__`),
 * rewrite `opacity` → `autoAlpha` in tween vars. Skipped when the author
 * already manages `autoAlpha` or `visibility` themselves. Baseline renders
 * never see this — the flag is only set on fast-capture sessions.
 */
function convertVarsOpacityToAutoAlpha(vars: unknown): unknown {
  if (vars === null || typeof vars !== "object" || Array.isArray(vars)) return vars;
  const record = vars as Record<string, unknown>;
  if (!("opacity" in record) || "autoAlpha" in record || "visibility" in record) return vars;
  const converted: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    if (key === "opacity") converted.autoAlpha = record[key];
    else converted[key] = record[key];
  }
  return converted;
}

/**
 * Apply the autoAlpha rewrite to the vars argument(s) of a tween call.
 * `to`/`from`/`set` carry vars at index 1; `fromTo` at indexes 1 and 2.
 */
function convertTweenArgs(method: TimelineOperationMethod, args: unknown[]): unknown[] {
  // Always record tween targets (3D + all-targets) regardless of the autoAlpha
  // rewrite flag, so HF_FAST_CAPTURE_AUTOALPHA=false doesn't blind the 3D
  // projection's quad-animation check.
  if (method !== "add") recordThreeDTweenTarget(args);
  if (window.__HF_FAST_CAPTURE_AUTOALPHA__ !== true) return args;
  if (method === "add") return args;
  const out = args.slice();
  let rewritten = false;
  if (out.length > 1) {
    const converted = convertVarsOpacityToAutoAlpha(out[1]);
    if (converted !== out[1]) rewritten = true;
    out[1] = converted;
  }
  if (method === "fromTo" && out.length > 2) {
    const converted = convertVarsOpacityToAutoAlpha(out[2]);
    if (converted !== out[2]) rewritten = true;
    out[2] = converted;
  }
  // convertVarsOpacityToAutoAlpha returns the input object untouched when no
  // rewrite applies, so identity inequality means this target's opacity is
  // GSAP-controlled via autoAlpha and is safe to visibility-hide at flush.
  if (rewritten && out[0] !== null && out[0] !== undefined) {
    autoAlphaRewrittenTargets.add(out[0]);
  }
  return out;
}

function varsHasThreeD(vars: unknown): boolean {
  if (vars === null || typeof vars !== "object" || Array.isArray(vars)) return false;
  const record = vars as Record<string, unknown>;
  return "rotationX" in record || "rotationY" in record || "transformPerspective" in record;
}

/** Every tween target, regardless of vars — the 3D projection's quad
 * textures are rasterized once at init, so any GSAP-animated element inside
 * a quad's subtree makes that quad unprojectable (the engine falls back). */
const allTweenTargets = new Set<unknown>();

// fallow-ignore-next-line complexity
function recordThreeDTweenTarget(args: unknown[]): void {
  const target = args[0];
  if (target === null || target === undefined) return;
  const w = window as Window & {
    __hf3dTweenTargets?: unknown[];
    __hfAllTweenTargets?: unknown[];
  };
  if (!allTweenTargets.has(target)) {
    allTweenTargets.add(target);
    w.__hfAllTweenTargets = Array.from(allTweenTargets);
  }
  if (varsHasThreeD(args[1]) || varsHasThreeD(args[2])) {
    threeDTweenTargets.add(target);
    w.__hf3dTweenTargets = Array.from(threeDTweenTargets);
  }
}

/** Resolve a GSAP tween target (selector / Element / NodeList / array) to elements. */
function resolveTweenTargets(target: unknown): Element[] {
  if (typeof target === "string") {
    try {
      return Array.from(document.querySelectorAll(target));
    } catch {
      return [];
    }
  }
  if (target instanceof Element) return [target];
  if (Array.isArray(target) || (typeof NodeList !== "undefined" && target instanceof NodeList)) {
    const out: Element[] = [];
    for (const item of target as Iterable<unknown>) {
      if (item instanceof Element) out.push(item);
    }
    return out;
  }
  return [];
}

/**
 * Flush-time transparent-layer hide.
 *
 * The autoAlpha rewrite only fixes opacity GSAP touches. Elements created
 * with inline `opacity: 0` (the gen_os caption-pill pattern:
 * `pill.style.cssText = "... opacity:0"` then `tl.set(pill, {opacity: 1})`
 * at each caption start) sit in the paint tree as transparent promoted
 * layers from frame 0 until their first autoAlpha event — long enough to
 * trigger the drawElementImage caption blackout mid-video.
 *
 * At flush completion (timeline built, still paused, nothing applied yet)
 * every recorded rewrite target that is STILL at computed opacity 0 gets
 * `visibility: hidden`. Safe by construction: only elements with a queued
 * autoAlpha tween are touched, and that tween restores visibility
 * (autoAlpha > 0 sets `visibility: inherit`) on its first applied frame.
 * Elements faded in by CSS animations, WAAPI, or raw style writes are never
 * recorded here and are left alone. Authors who set inline `visibility`
 * themselves are also skipped, mirroring convertVarsOpacityToAutoAlpha.
 */
function hideTransparentAutoAlphaTargets(): void {
  if (window.__HF_FAST_CAPTURE_AUTOALPHA__ !== true) return;
  if (autoAlphaRewrittenTargets.size === 0) return;
  const targets = Array.from(autoAlphaRewrittenTargets);
  autoAlphaRewrittenTargets.clear();
  for (const target of targets) {
    for (const el of resolveTweenTargets(target)) {
      const styled = el as Element & { style?: CSSStyleDeclaration };
      if (!styled.style) continue;
      if (styled.style.visibility !== "") continue;
      let computedOpacity = "";
      try {
        computedOpacity = getComputedStyle(el).opacity;
      } catch {
        continue;
      }
      if (computedOpacity === "0") styled.style.visibility = "hidden";
    }
  }
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
  const entry = { proxy, method, args: convertTweenArgs(method, args) };
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
  hideTransparentAutoAlphaTargets();
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
 * Methods queued for rAF-based batch flush (mutating tween additions).
 * These return the proxy for chaining and never synchronously flush.
 */
const BATCHED_METHODS = new Set(["to", "from", "fromTo", "set", "add"]);

/**
 * Walk the real timeline's prototype chain and generate forwarding stubs on
 * `proxy` for every public method not already present. Each stub flushes
 * pending operations, calls the real method, and returns `proxy` when the
 * real method returns `this` (for chaining). Private GSAP internals (keys
 * starting with `_`) and `then` are skipped — `then` makes GSAP timelines
 * thenable, which would cause `Promise.resolve(proxy)` / `await proxy` to
 * hang for paused timelines.
 */
// fallow-ignore-next-line complexity
function forwardRemainingMethods(proxy: TimelineProxy, real: GsapTimeline): void {
  let obj: object | null = real as object;
  while (obj !== null && obj !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(obj)) {
      if (key === "constructor" || key === "then" || key in proxy || BATCHED_METHODS.has(key))
        continue;
      if (key.charAt(0) === "_") continue;
      const desc = Object.getOwnPropertyDescriptor(obj, key);
      if (!desc || typeof desc.value !== "function") continue;
      const fn = desc.value as (...a: unknown[]) => unknown;
      (proxy as Record<string, unknown>)[key] = function (
        this: unknown,
        ...args: unknown[]
      ): unknown {
        flushPendingOperations();
        const result = fn.call(real, ...args);
        return result === real ? proxy : result;
      };
    }
    obj = Object.getPrototypeOf(obj);
  }
}

/**
 * Create a queuing proxy around a real GSAP timeline.
 *
 * Batched methods (to/from/fromTo/set/add) queue operations for rAF flush.
 * All other methods on the real timeline are forwarded via dynamically
 * generated stubs that flush pending operations before delegating. This
 * uses a plain object — not `new Proxy` — because Chrome's headless shell
 * hangs when Proxy traps are exposed during page.goto navigation (Symbol
 * probing, thenable checks, DevTools serialization).
 */
function wrapTimeline(real: GsapTimeline): TimelineProxy {
  const proxy: TimelineProxy = {
    __hfReal: real,
    __hfQueue: [],
    __hfIsProxy: true,

    to(...args: unknown[]): TimelineProxy {
      return enqueueTimelineOperation(proxy, "to", args);
    },
    from(...args: unknown[]): TimelineProxy {
      return enqueueTimelineOperation(proxy, "from", args);
    },
    fromTo(...args: unknown[]): TimelineProxy {
      return enqueueTimelineOperation(proxy, "fromTo", args);
    },
    set(...args: unknown[]): TimelineProxy {
      return enqueueTimelineOperation(proxy, "set", args);
    },
    add(...args: unknown[]): TimelineProxy {
      return enqueueTimelineOperation(proxy, "add", args);
    },

    pause(...args: unknown[]): TimelineProxy {
      flushPendingOperations();
      real.pause(...args);
      return proxy;
    },
    play(...args: unknown[]): TimelineProxy {
      flushPendingOperations();
      real.play(...args);
      return proxy;
    },
    seek(...args: unknown[]): TimelineProxy {
      flushPendingOperations();
      real.seek(...args);
      return proxy;
    },
    totalTime(...args: unknown[]): unknown {
      flushPendingOperations();
      if (args.length > 0) {
        real.totalTime(...args);
        return proxy;
      }
      return real.totalTime();
    },
    time(...args: unknown[]): unknown {
      flushPendingOperations();
      if (args.length > 0) {
        real.time(...args);
        return proxy;
      }
      return real.time();
    },
    duration(...args: unknown[]): unknown {
      flushPendingOperations();
      if (args.length > 0) {
        real.duration(...args);
        return proxy;
      }
      return real.duration();
    },
    getChildren(...args: unknown[]): unknown[] {
      flushPendingOperations();
      const children = real.getChildren(...args);
      return Array.isArray(children) ? children : [];
    },
    paused(...args: unknown[]): unknown {
      flushPendingOperations();
      if (args.length > 0) {
        real.paused(...args);
        return proxy;
      }
      return real.paused();
    },
    timeScale(...args: unknown[]): unknown {
      flushPendingOperations();
      if (args.length > 0) {
        real.timeScale(...args);
        return proxy;
      }
      return real.timeScale();
    },
    kill(): void {
      flushPendingOperations();
      real.kill();
    },
  };

  forwardRemainingMethods(proxy, real);

  activeProxies.push(proxy);
  return proxy;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

if (typeof window !== "undefined") {
  if (!window.__hf) window.__hf = {};
  window.__hfTimelinesBuilding = false;
  // Expose a synchronous flush so headless renderers can drain the queue
  // instantly instead of waiting for rAF-based batch ticks. Also force-
  // publishes the "timelines built" signal immediately (normally deferred
  // via setTimeout(0)) — the caller guarantees page scripts have finished
  // loading, so no more operations can arrive after the flush.
  (window as Record<string, unknown>).__hfFlushSync = () => {
    flushPendingOperations();
    if (pendingOperations.length === 0 && window.__hfTimelinesBuilding) {
      publishTimelinesBuilt();
    }
  };

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
        // Fast-capture autoAlpha rewrite for top-level gsap.to/from/set/fromTo
        // calls (compositions often use `gsap.set(el, { opacity: 0 })` for
        // initial state — the timeline proxy never sees those).
        for (const method of ["to", "from", "set"] as const) {
          const orig = g[method];
          if (typeof orig !== "function") continue;
          const bound = (orig as (...a: unknown[]) => unknown).bind(g);
          g[method] = (...args: unknown[]): unknown => bound(...convertTweenArgs(method, args));
        }
        const origFromTo = g.fromTo;
        if (typeof origFromTo === "function") {
          const bound = (origFromTo as (...a: unknown[]) => unknown).bind(g);
          g.fromTo = (...args: unknown[]): unknown => bound(...convertTweenArgs("fromTo", args));
        }
      },
    });
  } catch {
    // defineProperty failed (e.g. already non-configurable) — skip interception.
  }
}
