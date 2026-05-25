import { refreshRuntimeMediaCache, type RuntimeMediaClip } from "./media";

// Start lazy preload management at 3 clips to keep memory pressure low from
// the start. The previous threshold of 6 let medium compositions (4–5 heavy
// videos) saturate browser memory before the preloader kicked in.
const LAZY_THRESHOLD = 3;
const LOOKAHEAD_SECONDS = 10;
const LOOKBEHIND_SECONDS = 3;
const LOOKAHEAD_MIN_CLIPS = 2;
// Adaptive cap: base of 4 for small sets, clamped to 6 for larger ones.
// The window-based eviction in syncWindow() is the primary memory bound;
// this cap is defense-in-depth for compositions with many short clips
// packed into the lookahead window.
const MAX_PROMOTED_BASE = 4;
const MAX_PROMOTED_CEIL = 6;

export interface MediaPreloadManager {
  refresh(): void;
  sync(currentTimeSeconds: number): void;
  preloadAroundTime(timeSeconds: number): void;
  isLazy(): boolean;
}

export function createMediaPreloadManager(options?: {
  resolveStartSeconds?: (element: Element) => number;
  resolveDurationSeconds?: (element: HTMLVideoElement | HTMLAudioElement) => number | null;
  shouldIncludeElement?: (element: HTMLVideoElement | HTMLAudioElement) => boolean;
  onActivation?: (clipCount: number) => void;
}): MediaPreloadManager {
  let clips: RuntimeMediaClip[] = [];
  const promoted = new Set<HTMLMediaElement>();
  /** Insertion-order queue for LRU eviction (oldest first). */
  const promotionOrder: HTMLMediaElement[] = [];
  /** Stashed original src so we can restore after eviction. */
  const originalSrc = new Map<HTMLMediaElement, string>();
  let lazy = false;
  let activationEmitted = false;

  function refresh(): void {
    const cache = refreshRuntimeMediaCache(options);
    clips = cache.mediaClips;
    const configuredThreshold =
      typeof (window as Record<string, unknown>).__HF_LAZY_PRELOAD_THRESHOLD === "number"
        ? ((window as Record<string, unknown>).__HF_LAZY_PRELOAD_THRESHOLD as number)
        : LAZY_THRESHOLD;
    lazy = clips.length >= configuredThreshold;
    if (lazy && !activationEmitted) {
      activationEmitted = true;
      options?.onActivation?.(clips.length);
    }
  }

  function evictClip(clip: RuntimeMediaClip): void {
    if (!promoted.has(clip.el)) return;
    // Stash original src before clearing
    if (!originalSrc.has(clip.el)) {
      originalSrc.set(clip.el, clip.el.src);
    }
    // Release buffered data: only way to free memory per MDN
    clip.el.removeAttribute("src");
    clip.el.load();
    clip.el.preload = "metadata";
    promoted.delete(clip.el);
    const idx = promotionOrder.indexOf(clip.el);
    if (idx !== -1) promotionOrder.splice(idx, 1);
  }

  function promoteClip(clip: RuntimeMediaClip): void {
    if (promoted.has(clip.el)) return;

    // Restore src if previously evicted
    const stashedSrc = originalSrc.get(clip.el);
    if (stashedSrc !== undefined && !clip.el.src) {
      clip.el.src = stashedSrc;
      originalSrc.delete(clip.el);
    }

    promoted.add(clip.el);
    promotionOrder.push(clip.el);

    if (clip.el.preload !== "auto") {
      clip.el.preload = "auto";
    }
    if (clip.el.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
      clip.el.load();
    }
  }

  function evictOutsideWindow(inWindow: Set<RuntimeMediaClip>): void {
    const windowEls = new Set<HTMLMediaElement>();
    for (const clip of inWindow) {
      windowEls.add(clip.el);
    }

    for (const clip of clips) {
      if (promoted.has(clip.el) && !windowEls.has(clip.el)) {
        evictClip(clip);
      }
    }

    const maxPromoted = Math.min(
      MAX_PROMOTED_CEIL,
      MAX_PROMOTED_BASE + Math.floor(clips.length / 10),
    );
    while (promotionOrder.length > maxPromoted) {
      const oldest = promotionOrder[0];
      if (windowEls.has(oldest)) break;
      const clip = clips.find((c) => c.el === oldest);
      if (clip) {
        evictClip(clip);
      } else {
        promoted.delete(oldest);
        promotionOrder.shift();
      }
    }
  }

  function getClipsInWindow(timeSeconds: number): Set<RuntimeMediaClip> {
    const windowStart = timeSeconds - LOOKBEHIND_SECONDS;
    const windowEnd = timeSeconds + LOOKAHEAD_SECONDS;
    const inWindow = new Set<RuntimeMediaClip>();

    for (const clip of clips) {
      const active = timeSeconds >= clip.start && timeSeconds < clip.end;
      const inLookahead = clip.start >= timeSeconds && clip.start <= windowEnd;
      const inLookbehind = clip.end > windowStart && clip.end <= timeSeconds;
      if (active || inLookahead || inLookbehind) {
        inWindow.add(clip);
      }
    }

    if (inWindow.size < LOOKAHEAD_MIN_CLIPS) {
      const sorted = clips
        .filter((c) => c.start >= timeSeconds && !inWindow.has(c))
        .sort((a, b) => a.start - b.start);
      for (const clip of sorted) {
        inWindow.add(clip);
        if (inWindow.size >= LOOKAHEAD_MIN_CLIPS) break;
      }
    }

    return inWindow;
  }

  function syncWindow(timeSeconds: number): void {
    const window = getClipsInWindow(timeSeconds);
    evictOutsideWindow(window);
    for (const clip of clips) {
      if (window.has(clip)) {
        promoteClip(clip);
      }
    }
  }

  function sync(currentTimeSeconds: number): void {
    if (!lazy) return;
    syncWindow(currentTimeSeconds);
  }

  function preloadAroundTime(timeSeconds: number): void {
    if (!lazy) return;
    syncWindow(timeSeconds);
  }

  function isLazy(): boolean {
    return lazy;
  }

  return { refresh, sync, preloadAroundTime, isLazy };
}
