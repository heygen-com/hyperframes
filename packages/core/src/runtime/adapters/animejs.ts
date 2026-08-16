import type { RuntimeDeterministicAdapter } from "../types";
import { swallow } from "../diagnostics";

/**
 * anime.js adapter for HyperFrames
 *
 * Supports anime.js v4+ (the `.seek(timeMs)` API).
 *
 * ## Usage in a composition
 *
 * The v4 global `anime` is a namespace object, not a callable — `anime.animate()`,
 * `anime.createTimeline()`. v3's `anime({ targets })` form does not exist in v4.
 * (4.1+ also moved the bundles from `lib/` to `dist/bundles/`.)
 *
 * ```html
 * <script src="https://cdn.jsdelivr.net/npm/animejs@4.5.0/dist/bundles/anime.umd.min.js"></script>
 * <script>
 *   const anim = anime.animate('.box', {
 *     x: 250,
 *     rotate: '1turn',
 *     duration: 2000,
 *     ease: 'outExpo',
 *     autoplay: false,
 *   });
 *   window.__hfAnime = window.__hfAnime || [];
 *   window.__hfAnime.push(anim);
 * </script>
 * ```
 *
 * Timelines work the same way — note `add(targets, params, position)`:
 *
 * ```html
 * <script>
 *   const tl = anime.createTimeline({ autoplay: false });
 *   tl.add('.a', { opacity: [0, 1], duration: 500 })
 *     .add('.b', { y: [-40, 0], duration: 400 });
 *   window.__hfAnime = window.__hfAnime || [];
 *   window.__hfAnime.push(tl);
 * </script>
 * ```
 *
 * Multiple instances are supported — all are seeked in sync.
 *
 * ## Auto-discovery (v3 only — inert on v4)
 *
 * `discover()` checks `anime.running`, which v4 no longer exports, so it always
 * returns empty against a v4 build. Compositions MUST push every instance onto
 * `window.__hfAnime` themselves; an unregistered instance is never seeked.
 */
export function createAnimeJsAdapter(): RuntimeDeterministicAdapter {
  return {
    name: "animejs",

    discover: () => {
      try {
        const animeGlobal = (window as AnimeWindow).anime;
        if (!animeGlobal || typeof animeGlobal.running === "undefined") return;

        const running = animeGlobal.running;
        if (!Array.isArray(running) || running.length === 0) return;

        const existing = (window as AnimeWindow).__hfAnime ?? [];
        const existingSet = new Set(existing);
        for (const instance of running) {
          if (!existingSet.has(instance)) {
            existing.push(instance);
          }
        }
        (window as AnimeWindow).__hfAnime = existing;
      } catch (err) {
        // ignore discovery failures
        swallow("runtime.adapters.animejs.site1", err);
      }
    },

    seek: (ctx) => {
      const timeMs = Math.max(0, (Number(ctx.time) || 0) * 1000);
      const instances = (window as AnimeWindow).__hfAnime;
      if (!instances || instances.length === 0) return;

      for (const instance of instances) {
        try {
          if (typeof instance.seek === "function") {
            instance.seek(timeMs);
          }
        } catch (err) {
          // ignore per-instance failures — keep going for other instances
          swallow("runtime.adapters.animejs.site2", err);
        }
      }
    },

    pause: () => {
      const instances = (window as AnimeWindow).__hfAnime;
      if (!instances || instances.length === 0) return;

      for (const instance of instances) {
        try {
          if (typeof instance.pause === "function") {
            instance.pause();
          }
        } catch (err) {
          // ignore
          swallow("runtime.adapters.animejs.site3", err);
        }
      }
    },

    play: () => {
      const instances = (window as AnimeWindow).__hfAnime;
      if (!instances || instances.length === 0) return;

      for (const instance of instances) {
        try {
          if (typeof instance.play === "function") {
            instance.play();
          }
        } catch (err) {
          // ignore
          swallow("runtime.adapters.animejs.site4", err);
        }
      }
    },

    revert: () => {
      // Don't clear __hfAnime — instances are owned by the composition.
    },
  };
}

// ── Minimal type shapes (no anime.js package dependency) ──────────────────────

interface AnimeInstance {
  seek: (timeMs: number) => void;
  pause: () => void;
  play: () => void;
  duration?: number;
}

interface AnimeGlobal {
  animate?: (targets: unknown, params?: unknown) => AnimeInstance;
  createTimeline?: (params?: unknown) => AnimeInstance;
  /** Legacy v3 registry retained for backward-compatible discovery. */
  running?: AnimeInstance[];
}

interface AnimeWindow extends Window {
  anime?: AnimeGlobal;
  /** anime.js instances registered by compositions for the adapter to seek. */
  __hfAnime?: AnimeInstance[];
}
