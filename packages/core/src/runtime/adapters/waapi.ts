import type { RuntimeDeterministicAdapter } from "../types";
import { swallow } from "../diagnostics";

export function createWaapiAdapter(): RuntimeDeterministicAdapter {
  let didDiscover = false;
  let lastSeekTimeMs = 0;
  const baselines = new WeakMap<
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

  return {
    name: "waapi",
    discover: () => {
      didDiscover = true;
      for (const animation of snapshotAnimations()) {
        ensureBaseline(animation, lastSeekTimeMs);
      }
    },
    seek: (ctx) => {
      const timeMs = Math.max(0, (Number(ctx.time) || 0) * 1000);
      lastSeekTimeMs = timeMs;
      for (const animation of snapshotAnimations()) {
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
      if (!document.getAnimations) return;
      for (const animation of document.getAnimations()) {
        try {
          animation.pause();
        } catch (err) {
          // ignore animation edge-cases
          swallow("runtime.adapters.waapi.site3", err);
        }
      }
    },
  };
}
