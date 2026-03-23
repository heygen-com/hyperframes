import type { RuntimeDeterministicAdapter } from "../types";

/**
 * Lottie adapter for HyperFrames
 *
 * Supports lottie-web and @lottiefiles/dotlottie-web.
 *
 * ## Usage in a composition
 *
 * ### lottie-web (classic):
 * ```html
 * <script src="https://cdnjs.cloudflare.com/ajax/libs/bodymovin/5.12.2/lottie.min.js"></script>
 * <div id="anim"></div>
 * <script>
 *   const anim = lottie.loadAnimation({
 *     container: document.getElementById('anim'),
 *     renderer: 'svg',
 *     loop: false,
 *     autoplay: false,
 *     path: 'animation.json',
 *   });
 *   // Register so the adapter can seek it:
 *   window.__hfLottie = window.__hfLottie || [];
 *   window.__hfLottie.push(anim);
 * </script>
 * ```
 *
 * ### @lottiefiles/dotlottie-web:
 * ```html
 * <script src="https://unpkg.com/@lottiefiles/dotlottie-web"></script>
 * <canvas id="anim"></canvas>
 * <script>
 *   const player = new DotLottie({
 *     canvas: document.getElementById('anim'),
 *     src: 'animation.lottie',
 *     autoplay: false,
 *   });
 *   window.__hfLottie = window.__hfLottie || [];
 *   window.__hfLottie.push(player);
 * </script>
 * ```
 *
 * Multiple animations are supported — all are seeked in sync.
 *
 * ## Auto-discovery
 *
 * The adapter also attempts to auto-discover Lottie animations registered
 * via the global `lottie` object, so compositions that call
 * `lottie.loadAnimation(...)` without manually registering still work.
 */
export function createLottieAdapter(): RuntimeDeterministicAdapter {
  return {
    name: "lottie",

    discover: () => {
      // Auto-discover animations registered via the global lottie API.
      // lottie-web exposes registered animations at lottie.getRegisteredAnimations().
      try {
        const lottieGlobal = (window as LottieWindow).lottie;
        if (lottieGlobal && typeof lottieGlobal.getRegisteredAnimations === "function") {
          const registered = lottieGlobal.getRegisteredAnimations();
          if (Array.isArray(registered) && registered.length > 0) {
            const existing = (window as LottieWindow).__hfLottie ?? [];
            const existingSet = new Set(existing);
            for (const anim of registered) {
              if (!existingSet.has(anim)) {
                existing.push(anim);
              }
            }
            (window as LottieWindow).__hfLottie = existing;
          }
        }
      } catch {
        // ignore discovery failures
      }
    },

    seek: (ctx) => {
      const time = Math.max(0, Number(ctx.time) || 0);
      const instances = (window as LottieWindow).__hfLottie;
      if (!instances || instances.length === 0) return;

      for (const anim of instances) {
        try {
          if (isLottieWebAnimation(anim)) {
            // lottie-web: AnimationItem
            // goToAndStop(value, isFrame) — isFrame=true means frame number, false means time in ms
            // We use isFrame=false and pass time in ms for precision.
            anim.goToAndStop(time * 1000, false);
          } else if (isDotLottiePlayer(anim)) {
            // @lottiefiles/dotlottie-web: DotLottie
            // .seek(frame) — frame is 0-100 percentage OR frame number depending on version
            // Newer versions use setFrame(frame) or seek(percentage)
            if (typeof anim.setCurrentRawFrameValue === "function") {
              // dotlottie-web v2+: direct frame setter
              const totalFrames = anim.totalFrames ?? 0;
              const fps = anim.frameRate ?? 30;
              const frame = time * fps;
              if (totalFrames > 0) {
                anim.setCurrentRawFrameValue(Math.min(frame, totalFrames - 1));
              }
            } else if (typeof anim.seek === "function") {
              // dotlottie-web v1: seek(percentage 0-100)
              const duration = anim.duration ?? 1;
              const percentage = Math.min(100, (time / duration) * 100);
              anim.seek(percentage);
            }
          }
        } catch {
          // ignore per-animation failures — keep going for other instances
        }
      }
    },

    pause: () => {
      const instances = (window as LottieWindow).__hfLottie;
      if (!instances || instances.length === 0) return;

      for (const anim of instances) {
        try {
          if (isLottieWebAnimation(anim)) {
            anim.pause();
          } else if (isDotLottiePlayer(anim)) {
            anim.pause();
          }
        } catch {
          // ignore
        }
      }
    },

    play: () => {
      const instances = (window as LottieWindow).__hfLottie;
      if (!instances || instances.length === 0) return;

      for (const anim of instances) {
        try {
          if (isLottieWebAnimation(anim)) {
            anim.play();
          } else if (isDotLottiePlayer(anim)) {
            anim.play();
          }
        } catch {
          // ignore
        }
      }
    },

    revert: () => {
      // Don't clear __hfLottie — the animation objects are owned by the composition.
      // Just let them be garbage collected naturally.
    },
  };
}

// ── Type guards ────────────────────────────────────────────────────────────────

function isLottieWebAnimation(anim: unknown): anim is LottieWebAnimation {
  return (
    typeof anim === "object" &&
    anim !== null &&
    typeof (anim as LottieWebAnimation).goToAndStop === "function"
  );
}

function isDotLottiePlayer(anim: unknown): anim is DotLottiePlayer {
  return (
    typeof anim === "object" &&
    anim !== null &&
    typeof (anim as DotLottiePlayer).pause === "function" &&
    ("totalFrames" in (anim as object) || "duration" in (anim as object))
  );
}

// ── Minimal type shapes (no lottie package dependency) ─────────────────────────

interface LottieWebAnimation {
  play: () => void;
  pause: () => void;
  stop: () => void;
  goToAndStop: (value: number, isFrame: boolean) => void;
  goToAndPlay: (value: number, isFrame: boolean) => void;
  totalFrames: number;
  frameRate: number;
}

interface LottieWebGlobal {
  loadAnimation: (params: unknown) => LottieWebAnimation;
  getRegisteredAnimations: () => LottieWebAnimation[];
}

interface DotLottiePlayer {
  play: () => void;
  pause: () => void;
  seek?: (percentage: number) => void;
  setCurrentRawFrameValue?: (frame: number) => void;
  totalFrames?: number;
  frameRate?: number;
  duration?: number;
}

interface LottieWindow extends Window {
  lottie?: LottieWebGlobal;
  /** Compositions register their Lottie animation instances here for the adapter to seek. */
  __hfLottie?: Array<LottieWebAnimation | DotLottiePlayer>;
}
