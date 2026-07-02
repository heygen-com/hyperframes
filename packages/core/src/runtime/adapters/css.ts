import type { RuntimeDeterministicAdapter } from "../types";
import { swallow } from "../diagnostics";

export function createCssAdapter(params?: {
  resolveStartSeconds?: (element: Element) => number;
}): RuntimeDeterministicAdapter {
  let entries: Array<{
    el: HTMLElement;
    baseDelay: string;
    basePlayState: string;
    animations: Animation[];
  }> = [];

  const getAnimationsForElement = (el: HTMLElement): Animation[] => {
    if (typeof el.getAnimations !== "function") return [];
    try {
      return el.getAnimations();
    } catch {
      return [];
    }
  };

  const resolveEntryStartSeconds = (el: HTMLElement): number =>
    params?.resolveStartSeconds
      ? params.resolveStartSeconds(el)
      : Number.parseFloat(el.getAttribute("data-start") ?? "0") || 0;

  /**
   * End time (seconds, relative to composition start) for one WAAPI
   * animation handle. `endSeconds` is set only when the timing is readable
   * AND finite; `unbounded` is true when a timing was read but its endTime
   * is Infinity/NaN (an infinite iteration count the caller can't
   * auto-infer a duration from) — distinct from "no timing available at
   * all" (both fields absent), which callers should simply skip.
   */
  const inferAnimationEndSeconds = (
    animation: Animation,
    startSeconds: number,
  ): { endSeconds?: number; unbounded?: true } => {
    let timing: { endTime?: number | string } | null = null;
    try {
      timing = animation.effect?.getComputedTiming?.() ?? null;
    } catch (err) {
      swallow("runtime.adapters.css.site5", err);
    }
    if (!timing) return {};
    const endTimeMs = Number(timing.endTime);
    if (!Number.isFinite(endTimeMs)) return { unbounded: true };
    return { endSeconds: startSeconds + endTimeMs / 1000 };
  };

  const seekAnimations = (animations: Animation[], timeMs: number) => {
    for (const animation of animations) {
      try {
        animation.currentTime = timeMs;
      } catch (err) {
        // ignore animations that reject currentTime writes
        swallow("runtime.adapters.css.site1", err);
      }
      try {
        animation.pause();
      } catch (err) {
        // infinite unresolved animations can throw on pause before currentTime sticks
        swallow("runtime.adapters.css.site2", err);
      }
    }
  };

  const playAnimations = (animations: Animation[]) => {
    for (const animation of animations) {
      try {
        animation.play();
      } catch (err) {
        // ignore animation edge-cases
        swallow("runtime.adapters.css.site3", err);
      }
    }
  };

  const pauseAnimations = (animations: Animation[]) => {
    for (const animation of animations) {
      try {
        animation.pause();
      } catch (err) {
        // ignore animation edge-cases
        swallow("runtime.adapters.css.site4", err);
      }
    }
  };

  const restoreInlineStyles = (entry: (typeof entries)[number]) => {
    if (entry.baseDelay) {
      entry.el.style.animationDelay = entry.baseDelay;
    } else {
      entry.el.style.removeProperty("animation-delay");
    }
    if (entry.basePlayState) {
      entry.el.style.animationPlayState = entry.basePlayState;
    } else {
      entry.el.style.removeProperty("animation-play-state");
    }
  };

  return {
    name: "css",
    discover: () => {
      entries = [];
      const all = document.querySelectorAll("*");
      for (const rawEl of all) {
        if (!(rawEl instanceof HTMLElement)) continue;
        const style = window.getComputedStyle(rawEl);
        if (!style.animationName || style.animationName === "none") continue;
        entries.push({
          el: rawEl,
          baseDelay: rawEl.style.animationDelay || "",
          basePlayState: rawEl.style.animationPlayState || "",
          animations: getAnimationsForElement(rawEl),
        });
      }
    },
    getInferredDurationSeconds: () => {
      let maxEndSeconds = 0;
      for (const entry of entries) {
        if (!entry.el.isConnected) continue;
        const start = resolveEntryStartSeconds(entry.el);
        for (const animation of getAnimationsForElement(entry.el)) {
          const result = inferAnimationEndSeconds(animation, start);
          // Unbounded (Infinity/NaN endTime) animations are skipped here —
          // they never contribute to maxEndSeconds. A finite animation
          // elsewhere on the composition still supplies a valid duration
          // signal; only fall through to null when nothing finite was found.
          if (result.endSeconds != null) maxEndSeconds = Math.max(maxEndSeconds, result.endSeconds);
        }
      }
      return maxEndSeconds > 0 ? maxEndSeconds : null;
    },
    seek: (ctx) => {
      const time = Number(ctx.time) || 0;
      for (const entry of entries) {
        if (!entry.el.isConnected) continue;
        const start = resolveEntryStartSeconds(entry.el);
        const localTimeMs = Math.max(0, time - start) * 1000;
        const animations = entry.animations;
        if (animations.length > 0) {
          seekAnimations(animations, localTimeMs);
          continue;
        }

        // Fallback for environments without WAAPI-backed CSS animation handles.
        entry.el.style.animationPlayState = "paused";
        entry.el.style.animationDelay = `-${(localTimeMs / 1000).toFixed(3)}s`;
      }
    },
    pause: () => {
      for (const entry of entries) {
        if (!entry.el.isConnected) continue;
        const animations = entry.animations;
        if (animations.length > 0) {
          pauseAnimations(animations);
        }
        restoreInlineStyles(entry);
      }
    },
    play: () => {
      for (const entry of entries) {
        if (!entry.el.isConnected) continue;
        restoreInlineStyles(entry);
        playAnimations(entry.animations);
      }
    },
    revert: () => {
      entries = [];
    },
  };
}
