import type { RuntimeDeterministicAdapter } from "../types";
import { swallow } from "../diagnostics";
import { isHtmlElement } from "../domRealm";

export function createCssAdapter(params?: {
  resolveStartSeconds?: (element: Element) => number;
}): RuntimeDeterministicAdapter {
  let entries: Array<{
    el: HTMLElement;
    baseDelay: string;
    basePlayState: string;
    cycleSeconds: number;
    delays: number[];
    handles?: Animation[];
  }> = [];

  const safeGetAnimations = (
    source: Document | HTMLElement,
    read = () => source.getAnimations(),
  ): Animation[] => {
    if (typeof source.getAnimations !== "function") return [];
    try {
      return read();
    } catch {
      return [];
    }
  };

  const readLiveAnimations = (pageAnimations?: () => Animation[]): Map<Element, Animation[]> => {
    const byElement = new Map<Element, Animation[]>();
    if (entries.length === 0) return byElement;
    const canTellCss = typeof CSSAnimation !== "undefined";
    for (const animation of safeGetAnimations(document, pageAnimations)) {
      if (canTellCss && !(animation instanceof CSSAnimation)) continue;
      const effect = animation.effect as KeyframeEffect | null;
      if (!effect?.target || effect.pseudoElement) continue;
      const list = byElement.get(effect.target);
      if (list) list.push(animation);
      else byElement.set(effect.target, [animation]);
    }
    return byElement;
  };

  // A finished no-fill animation leaves the scan but stays; a write revives a cancelled (idle) one.
  const keepHandles = (known: Animation[] = [], scanned: Animation[] = []): Animation[] => [
    ...scanned,
    ...known.filter((animation) => !scanned.includes(animation) && animation.playState !== "idle"),
  ];

  const resolveEntryStartSeconds = (el: HTMLElement): number => {
    const clip = el.closest("[data-start]") ?? el;
    return params?.resolveStartSeconds
      ? params.resolveStartSeconds(clip)
      : Number.parseFloat(clip.getAttribute("data-start") ?? "0") || 0;
  };

  // Computed lists pair by index, repeating the shorter; unlike getAnimations(), they outlive display:none.
  const readAnimationTimes = (style: CSSStyleDeclaration) => {
    const seconds = (list: string | undefined) =>
      (list || "")
        .split(",")
        .map((v) => Number.parseFloat(v) / (v.trim().endsWith("ms") ? 1000 : 1));
    const durations = seconds(style.animationDuration);
    const delays = seconds(style.animationDelay);
    const names = style.animationName.split(",");
    let cycleSeconds = 0;
    names.forEach((name, i) => {
      if (name.trim() === "none") return;
      const cycle = delays[i % delays.length]! + durations[i % durations.length]!;
      if (cycle > cycleSeconds) cycleSeconds = cycle;
    });
    return { cycleSeconds, delays: names.map((_, i) => delays[i % delays.length] || 0) };
  };

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
    let timing: ComputedEffectTiming | null = null;
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
      // A fallback seek's inline delay must not be read back as the authored one.
      for (const entry of entries) restoreInlineStyles(entry);
      const known = new Map(entries.map((entry) => [entry.el, entry.handles]));
      entries = [];
      const all = document.querySelectorAll("*");
      for (const rawEl of all) {
        if (!isHtmlElement(rawEl)) continue;
        const style = window.getComputedStyle(rawEl);
        if (!style.animationName || style.animationName === "none") continue;
        entries.push({
          el: rawEl,
          baseDelay: rawEl.style.animationDelay || "",
          basePlayState: rawEl.style.animationPlayState || "",
          ...readAnimationTimes(style),
          handles: known.get(rawEl),
        });
      }
    },
    getAnimationCycleEndSeconds: () => {
      let end = 0;
      for (const entry of entries) {
        if (!entry.el.isConnected || entry.cycleSeconds <= 0) continue;
        end = Math.max(end, resolveEntryStartSeconds(entry.el) + entry.cycleSeconds);
      }
      return end > 0 ? end : null;
    },
    getInferredDurationSeconds: () => {
      let maxEndSeconds = 0;
      for (const entry of entries) {
        if (!entry.el.isConnected) continue;
        const start = resolveEntryStartSeconds(entry.el);
        for (const animation of safeGetAnimations(entry.el)) {
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
      const live = readLiveAnimations(ctx.pageAnimations);
      // All playState reads before any write: each read flushes the style a write dirties.
      for (const entry of entries) entry.handles = keepHandles(entry.handles, live.get(entry.el));
      for (const entry of entries) {
        if (!entry.el.isConnected) continue;
        const start = resolveEntryStartSeconds(entry.el);
        const localTimeMs = Math.max(0, time - start) * 1000;
        if (entry.handles?.length) {
          if (entry.el.style.animationDelay !== entry.baseDelay) restoreInlineStyles(entry);
          seekAnimations(entry.handles, localTimeMs);
          continue;
        }

        // No live CSSAnimation (no WAAPI, a hidden clip): pause keeps this pose for the next one.
        entry.el.style.animationPlayState = "paused";
        entry.el.style.animationDelay = entry.delays
          .map((delay) => `${Number((delay - localTimeMs / 1000).toFixed(3))}s`)
          .join(", ");
      }
    },
    pause: (ctx) => {
      const live = readLiveAnimations(ctx?.pageAnimations);
      for (const entry of entries) {
        if (!entry.el.isConnected) continue;
        const animations = live.get(entry.el);
        if (!animations) continue;
        pauseAnimations(animations);
        restoreInlineStyles(entry);
      }
    },
    play: () => {
      const live = readLiveAnimations();
      for (const entry of entries) {
        if (!entry.el.isConnected) continue;
        restoreInlineStyles(entry);
        playAnimations(live.get(entry.el) ?? []);
      }
    },
    revert: () => {
      entries = [];
    },
  };
}
