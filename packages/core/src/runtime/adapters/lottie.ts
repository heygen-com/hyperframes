import type { RuntimeDeterministicAdapter } from "../types";
import { swallow } from "../diagnostics";

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
export function createLottieAdapter(params?: {
  resolveStartSeconds?: (element: Element) => number;
}): RuntimeDeterministicAdapter {
  const compositionStartSeconds = (anim: unknown): number => {
    const el = lottieElement(anim);
    const composition =
      el && typeof (el as Element).closest === "function"
        ? (el as Element).closest("[data-composition-id]")
        : null;
    return composition && params?.resolveStartSeconds ? params.resolveStartSeconds(composition) : 0;
  };
  const secondsIntoComposition = (anim: unknown, pageTime: number): number =>
    Math.max(0, pageTime - compositionStartSeconds(anim));

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
      } catch (err) {
        // ignore discovery failures
        swallow("runtime.adapters.lottie.site1", err);
      }
    },

    seek: (ctx) => {
      const pageTime = Math.max(0, Number(ctx.time) || 0);
      const instances = (window as LottieWindow).__hfLottie;
      if (!instances || instances.length === 0) return;

      for (const anim of instances) {
        try {
          const time = secondsIntoComposition(anim, pageTime);
          const loops = anim.loop === true;
          if (isLottieWebAnimation(anim)) {
            // lottie-web: AnimationItem
            // goToAndStop(value, isFrame) — isFrame=true means frame number, false means time in ms
            // lottie-web draws nothing past the file's end, so a loop wraps and a finished one-shot
            // holds its last frame; both seek by whole-file frame number to avoid float drift.
            const frame = time * anim.frameRate;
            if (anim.totalFrames > 0 && loops) {
              anim.goToAndStop(wrapFrame(frame, anim.totalFrames), true);
            } else if (anim.totalFrames > 0 && frame >= anim.totalFrames) {
              anim.goToAndStop(anim.totalFrames - 1, true);
            } else {
              anim.goToAndStop(time * 1000, false);
            }
          } else if (isDotLottiePlayer(anim)) {
            // @lottiefiles/dotlottie-web: DotLottie
            // .seek(frame) — frame is 0-100 percentage OR frame number depending on version
            // Newer versions use setFrame(frame) or seek(percentage)
            if (typeof anim.setCurrentRawFrameValue === "function") {
              // dotlottie-web v2+: direct frame setter
              const totalFrames = anim.totalFrames ?? 0;
              const fps = anim.frameRate ?? 30;
              const frame =
                loops && totalFrames > 0 ? wrapFrame(time * fps, totalFrames) : time * fps;
              if (totalFrames > 0) {
                anim.setCurrentRawFrameValue(Math.min(frame, totalFrames - 1));
              }
            } else if (typeof anim.seek === "function") {
              // dotlottie-web v1: seek(percentage 0-100)
              const duration = anim.duration ?? 0;
              if (Number.isFinite(duration) && duration > 0) {
                const percentage = Math.min(
                  100,
                  ((loops ? time % duration : time) / duration) * 100,
                );
                anim.seek(percentage);
              }
            }
          }
        } catch (err) {
          // ignore per-animation failures — keep going for other instances
          swallow("runtime.adapters.lottie.site2", err);
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
        } catch (err) {
          // ignore
          swallow("runtime.adapters.lottie.site3", err);
        }
      }
    },

    revert: () => {
      // Don't clear __hfLottie — the animation objects are owned by the composition.
      // Just let them be garbage collected naturally.
    },

    getInferredDurationSeconds: () => latestInstanceEnd((_, length) => length),

    // Plays from its composition's start, as seek anchors it; a removed scene's instance stays registered.
    getAnimationCycleEndSeconds: () =>
      latestInstanceEnd((anim, length) =>
        (lottieElement(anim) as Node | undefined)?.isConnected === false
          ? null
          : compositionStartSeconds(anim) + length,
      ),
  };
}

/** Max of `endOf(instance, its length)` over registered instances; null skips an instance. */
function latestInstanceEnd(
  endOf: (anim: LottieWebAnimation | DotLottiePlayer, length: number) => number | null,
): number | null {
  const instances = (window as LottieWindow).__hfLottie;
  if (!instances || instances.length === 0) return null;
  let maxSeconds = 0;
  let sawAny = false;
  for (const anim of instances) {
    let end: number | null = null;
    try {
      const length = inferAnimationDurationSeconds(anim);
      end = length == null ? null : endOf(anim, length);
    } catch (err) {
      // ignore per-animation failures — keep going for other instances
      swallow("runtime.adapters.lottie.site4", err);
    }
    if (end == null) continue;
    sawAny = true;
    maxSeconds = Math.max(maxSeconds, end);
  }
  // Not-yet-loaded animations report totalFrames=0 — return null (not 0)
  // so the caller doesn't treat "still loading" as "genuinely zero
  // duration". A later discover cycle will pick up the real value once
  // the JSON has loaded.
  return sawAny ? maxSeconds : null;
}

function lottieElement(anim: unknown): unknown {
  return isLottieWebAnimation(anim) ? anim.wrapper : (anim as DotLottiePlayer).canvas;
}

/** `frame` wrapped into [0, total); a float hair under a whole cycle is the next cycle's first frame. */
function wrapFrame(frame: number, total: number): number {
  const wrapped = frame % total;
  return total - wrapped < 1e-6 ? 0 : wrapped;
}

/** A finite, positive number in seconds derived from a frame count + rate, or null. */
function finiteFramesToSeconds(
  totalFrames: number | undefined,
  frameRate: number | undefined,
): number | null {
  if (
    !Number.isFinite(totalFrames) ||
    !totalFrames ||
    totalFrames <= 0 ||
    !Number.isFinite(frameRate) ||
    !frameRate ||
    frameRate <= 0
  ) {
    return null;
  }
  return totalFrames / frameRate;
}

/** The inferred duration in seconds for one registered lottie-web/dotLottie instance, or null. */
function inferAnimationDurationSeconds(anim: LottieWebAnimation | DotLottiePlayer): number | null {
  if (isLottieWebAnimation(anim)) {
    return finiteFramesToSeconds(anim.totalFrames, anim.frameRate);
  }
  if (!isDotLottiePlayer(anim)) return null;
  if (Number.isFinite(anim.duration) && (anim.duration ?? 0) > 0) {
    return anim.duration ?? null;
  }
  return finiteFramesToSeconds(anim.totalFrames, anim.frameRate);
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
  loop?: boolean | number;
  wrapper?: unknown;
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
  loop?: boolean;
  canvas?: unknown;
}

interface LottieWindow extends Window {
  lottie?: LottieWebGlobal;
  /** Compositions register their Lottie animation instances here for the adapter to seek. */
  __hfLottie?: Array<LottieWebAnimation | DotLottiePlayer>;
}
