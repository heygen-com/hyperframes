import type { RuntimeDeterministicAdapter } from "../types";
import { swallow } from "../diagnostics";

export function createWaapiAdapter(): RuntimeDeterministicAdapter {
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
  let baselines = new WeakMap<
    Animation,
    {
      compositionTimeMs: number;
      animationTimeMs: number;
    }
  >();

  const snapshotAnimations = () => {
    if (!document.getAnimations) return [];
    try {
      return document.getAnimations();
    } catch {
      return [];
    }
  };

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

    const baseline = {
      compositionTimeMs,
      animationTimeMs: didDiscover
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
    const compositionStartSeconds = (baselines.get(animation)?.compositionTimeMs ?? 0) / 1000;
    return { endSeconds: compositionStartSeconds + endTimeMs / 1000 };
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
      // After an empty discover, skip the per-frame global scan until authored
      // code creates a WAAPI animation via Element.animate (hooked above).
      if (!didDiscover || animations.size > 0) {
        trackAnimations(snapshotAnimations(), didDiscover ? timeMs : 0);
      }
      for (const animation of animations) {
        const baseline = didDiscover
          ? ensureBaseline(animation, timeMs)
          : ensureBaseline(animation, 0);
        const localTimeMs =
          baseline.animationTimeMs + Math.max(0, timeMs - baseline.compositionTimeMs);
        try {
          animation.currentTime = localTimeMs;
        } catch (err) {
          // ignore animations that reject currentTime writes
          swallow("runtime.adapters.waapi.site1", err);
        }
        try {
          animation.pause();
        } catch (err) {
          // infinite unresolved animations can throw here until currentTime resolves
          swallow("runtime.adapters.waapi.site2", err);
        }
      }
    },
    pause: () => {
      if (!didDiscover) {
        trackAnimations(snapshotAnimations(), lastSeekTimeMs);
      }
      for (const animation of animations) {
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
