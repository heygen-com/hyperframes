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
    seek: (ctx) => {
      const time = Number(ctx.time) || 0;
      for (const entry of entries) {
        if (!entry.el.isConnected) continue;
        const start = params?.resolveStartSeconds
          ? params.resolveStartSeconds(entry.el)
          : Number.parseFloat(entry.el.getAttribute("data-start") ?? "0") || 0;
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
