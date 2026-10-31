import type { RuntimeDeterministicAdapter } from "../types";
import { swallow } from "../diagnostics";
import { holdAnimationAt } from "./_holdAnimationAt";
import {
  type AuthoredCssAnimations,
  clipStartSeconds,
  cssClip,
  isCssAnimation,
  isKeyframeEffect,
} from "./cssAnimation";

const isBrowserCreatedCss = (animation: Animation): boolean =>
  isCssAnimation(animation) ||
  (typeof CSSTransition !== "undefined" && animation instanceof CSSTransition);

export function createWaapiAdapter(params?: {
  resolveStartSeconds?: (element: Element) => number;
  readPageAnimations?: () => Animation[];
  authored?: AuthoredCssAnimations;
}): RuntimeDeterministicAdapter {
  let didDiscover = false;
  let lastSeekTimeMs = 0;
  let animateHookInstalled = false;
  let hookedPrototype:
    | (Element & {
        animate?: Element["animate"];
        __hfOriginalAnimate?: Element["animate"];
      })
    | undefined;
  let originalAnimate: Element["animate"] | undefined;
  let installedAnimate: Element["animate"] | undefined;
  const animations = new Set<Animation>();
  type Baseline = { compositionTimeMs: number; animationTimeMs: number };
  type ClipBaseline = { target: Element };
  let baselines = new WeakMap<Animation, Baseline | ClipBaseline>();

  const snapshotAnimations = (
    read = params?.readPageAnimations ?? (() => document.getAnimations()),
  ) => {
    if (!document.getAnimations) return [];
    try {
      return read();
    } catch {
      return [];
    }
  };

  const authoredTarget = (animation: Animation): Element | null => {
    const effect = animation.effect;
    return isCssAnimation(animation) &&
      params?.authored?.has(animation) &&
      isKeyframeEffect(effect) &&
      effect.target
      ? effect.target
      : null;
  };

  const anchorOf = (baseline: Baseline | ClipBaseline): Baseline =>
    "target" in baseline
      ? {
          compositionTimeMs:
            clipStartSeconds(cssClip(baseline.target), params?.resolveStartSeconds) * 1000,
          animationTimeMs: 0,
        }
      : baseline;

  const readAnimationTimeMs = (animation: Animation) => {
    const raw = Number(animation.currentTime);
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  };

  const normalizeInitialAnimationTimeMs = (animationTimeMs: number, compositionTimeMs: number) => {
    if (compositionTimeMs <= 0) {
      return animationTimeMs;
    }

    if (animationTimeMs >= compositionTimeMs) {
      return Math.max(0, animationTimeMs - compositionTimeMs);
    }

    return animationTimeMs;
  };

  const ensureBaseline = (animation: Animation, compositionTimeMs: number) => {
    const existing = baselines.get(animation);
    if (existing) {
      return existing;
    }

    const target = authoredTarget(animation);
    const baseline = target
      ? { target }
      : {
          compositionTimeMs,
          animationTimeMs: isCssAnimation(animation)
            ? 0
            : didDiscover
              ? normalizeInitialAnimationTimeMs(readAnimationTimeMs(animation), compositionTimeMs)
              : readAnimationTimeMs(animation),
        };
    baselines.set(animation, baseline);
    return baseline;
  };

  const trackAnimation = (animation: Animation, compositionTimeMs: number) => {
    if (!animations.has(animation)) {
      animations.add(animation);
      const stopTracking = () => {
        animations.delete(animation);
      };
      try {
        animation.addEventListener("finish", stopTracking, { once: true });
        animation.addEventListener("cancel", stopTracking, { once: true });
      } catch (err) {
        swallow("runtime.adapters.waapi.site4", err);
      }
    }
    ensureBaseline(animation, compositionTimeMs);
  };

  const trackAnimations = (items: Animation[], compositionTimeMs: number) => {
    for (const animation of items) {
      trackAnimation(animation, compositionTimeMs);
    }
  };

  const installAnimateHook = () => {
    if (animateHookInstalled) return;
    if (typeof Element === "undefined") return;
    const proto = Element.prototype as Element & {
      animate?: Element["animate"];
      __hfOriginalAnimate?: Element["animate"];
    };
    if (typeof proto.animate !== "function" || proto.__hfOriginalAnimate) return;
    const original = proto.animate;
    try {
      Object.defineProperty(proto, "__hfOriginalAnimate", {
        value: original,
        configurable: true,
      });
      const wrappedAnimate = function (this: Element, ...args: Parameters<Element["animate"]>) {
        const animation = original.apply(this, args);
        trackAnimation(animation, lastSeekTimeMs);
        return animation;
      };
      proto.animate = wrappedAnimate;
      hookedPrototype = proto;
      originalAnimate = original;
      installedAnimate = wrappedAnimate;
      animateHookInstalled = true;
    } catch {
      // Best-effort only. Existing animations are still discovered via snapshot.
    }
  };

  /**
   * End time (seconds, relative to composition start) for one animation.
   * `endSeconds` is set only when the timing is readable AND finite;
   * `unbounded` is true when a timing was read but its endTime is
   * Infinity/NaN (an infinite iteration count the caller can't auto-infer a
   * duration from) — distinct from "no timing available at all" (both
   * fields absent), which the caller should simply skip.
   */
  const inferAnimationEndSeconds = (
    animation: Animation,
  ): { endSeconds?: number; unbounded?: true } => {
    let timing: ComputedEffectTiming | null = null;
    try {
      timing = animation.effect?.getComputedTiming?.() ?? null;
    } catch (err) {
      swallow("runtime.adapters.waapi.site4", err);
    }
    if (!timing) return {};
    const endTimeMs = Number(timing.endTime);
    if (!Number.isFinite(endTimeMs)) return { unbounded: true };
    const target = authoredTarget(animation);
    const baseline = baselines.get(animation) ?? (target ? { target } : undefined);
    const compositionStartSeconds = baseline ? anchorOf(baseline).compositionTimeMs / 1000 : 0;
    return { endSeconds: compositionStartSeconds + endTimeMs / 1000 };
  };

  const seekAnimation = (animation: Animation, timeMs: number) => {
    if (animation.playState === "idle" && isBrowserCreatedCss(animation)) {
      animations.delete(animation);
      return;
    }
    if (params?.authored?.drivenByCssAdapter(animation)) return;
    const baseline = anchorOf(ensureBaseline(animation, didDiscover ? timeMs : 0));
    const localTimeMs = baseline.animationTimeMs + Math.max(0, timeMs - baseline.compositionTimeMs);
    holdAnimationAt(
      animation,
      localTimeMs,
      "runtime.adapters.waapi.site1",
      "runtime.adapters.waapi.site2",
    );
  };

  return {
    name: "waapi",
    discover: () => {
      didDiscover = true;
      installAnimateHook();
      trackAnimations(snapshotAnimations(), lastSeekTimeMs);
    },
    seek: (ctx) => {
      const timeMs = Math.max(0, (Number(ctx.time) || 0) * 1000);
      lastSeekTimeMs = timeMs;
      // document.getAnimations() is surprisingly expensive in Chromium even
      // when it returns [], and renderSeek calls this adapter once per frame.
      // An empty page stays idle unless it authors CSS or creates a WAAPI animation.
      if (!didDiscover || animations.size > 0 || params?.authored?.hasAny()) {
        trackAnimations(snapshotAnimations(ctx.pageAnimations), didDiscover ? timeMs : 0);
      }
      for (const animation of animations) seekAnimation(animation, timeMs);
    },
    pause: (ctx) => {
      if (!didDiscover) {
        trackAnimations(snapshotAnimations(ctx?.pageAnimations), lastSeekTimeMs);
      }
      for (const animation of animations) {
        if (params?.authored?.drivenByCssAdapter(animation)) continue;
        try {
          animation.pause();
        } catch (err) {
          // ignore animation edge-cases
          swallow("runtime.adapters.waapi.site3", err);
        }
      }
    },
    revert: () => {
      animations.clear();
      baselines = new WeakMap();
      didDiscover = false;
      lastSeekTimeMs = 0;
      if (
        hookedPrototype &&
        originalAnimate &&
        installedAnimate &&
        hookedPrototype.animate === installedAnimate
      ) {
        try {
          hookedPrototype.animate = originalAnimate;
          if (hookedPrototype.__hfOriginalAnimate === originalAnimate) {
            delete hookedPrototype.__hfOriginalAnimate;
          }
        } catch (err) {
          swallow("runtime.adapters.waapi.site5", err);
        }
      }
      hookedPrototype = undefined;
      originalAnimate = undefined;
      installedAnimate = undefined;
      animateHookInstalled = false;
    },
    getInferredDurationSeconds: () => {
      let maxEndSeconds = 0;
      for (const animation of snapshotAnimations()) {
        const result = inferAnimationEndSeconds(animation);
        // Unbounded (Infinity/NaN endTime) animations are skipped here —
        // they never contribute to maxEndSeconds. A finite animation
        // elsewhere on the composition still supplies a valid duration
        // signal; only fall through to null when nothing finite was found.
        if (result.endSeconds != null) maxEndSeconds = Math.max(maxEndSeconds, result.endSeconds);
      }
      return maxEndSeconds > 0 ? maxEndSeconds : null;
    },
  };
}
