interface MediaProbeResult {
  duration: number;
  width?: number;
  height?: number;
  hasVideo: boolean;
  hasAudio: boolean;
}

const cache = new Map<string, MediaProbeResult>();
const inflight = new Map<string, Promise<MediaProbeResult | null>>();
// URLs whose probe failed (CORS, 404, non-media). Remembered so the rAF-driven
// timeline re-derive doesn't re-fetch them every frame and flood the console.
const failed = new Set<string>();

let mediabunnyModule: typeof import("mediabunny") | null | false = null;

async function loadMediabunny() {
  if (mediabunnyModule === false) return null;
  if (mediabunnyModule) return mediabunnyModule;
  try {
    mediabunnyModule = await import("mediabunny");
    return mediabunnyModule;
  } catch {
    mediabunnyModule = false;
    return null;
  }
}

function normalizeUrl(url: string): string {
  try {
    return new URL(url, window.location.href).href;
  } catch {
    return url;
  }
}

async function probeOne(url: string): Promise<MediaProbeResult | null> {
  const mb = await loadMediabunny();
  if (!mb) return null;

  const input = new mb.Input({
    source: new mb.UrlSource(url),
    formats: mb.ALL_FORMATS,
  });
  try {
    const duration = await input.getDurationFromMetadata();
    if (duration == null || !Number.isFinite(duration) || duration <= 0) return null;

    const videoTrack = await input.getPrimaryVideoTrack();
    const audioTracks = await input.getAudioTracks();

    const result: MediaProbeResult = {
      duration,
      width: videoTrack?.displayWidth,
      height: videoTrack?.displayHeight,
      hasVideo: videoTrack != null,
      hasAudio: audioTracks.length > 0,
    };
    return result;
  } catch {
    return null;
  } finally {
    input.dispose();
  }
}

function getCachedProbe(url: string): MediaProbeResult | undefined {
  return cache.get(normalizeUrl(url));
}

/**
 * Re-apply the cached probe `sourceDuration` to media elements that arrive
 * without it. Re-deriving the timeline (e.g. after a clip move) produces fresh
 * objects whose duration the DOM scan may not have, and the async probe skips
 * already-cached srcs — so without this, trimmed waveforms lose their window.
 */
export function applyCachedSourceDurations<
  T extends { src?: string; tag: string; sourceDuration?: number },
>(elements: T[]): T[] {
  return elements.map((el) => {
    const tag = el.tag.toLowerCase();
    if (!el.src || el.sourceDuration != null || (tag !== "audio" && tag !== "video")) return el;
    const cached = getCachedProbe(el.src);
    return cached?.duration && cached.duration > 0
      ? { ...el, sourceDuration: cached.duration }
      : el;
  });
}

/**
 * Probe (header-only, cheap) any media elements still missing sourceDuration
 * after the cache pass, applying each resolved duration via `apply(key, secs)`.
 * Skips already-cached srcs.
 */
export async function probeMissingSourceDurations<
  T extends { src?: string; tag: string; sourceDuration?: number; key?: string; id: string },
>(elements: T[], apply: (key: string, durationSeconds: number) => void): Promise<void> {
  const needs = elements.filter(
    (el) =>
      el.src &&
      el.sourceDuration == null &&
      ["video", "audio"].includes(el.tag.toLowerCase()) &&
      !getCachedProbe(el.src) &&
      !failed.has(normalizeUrl(el.src)),
  );
  if (needs.length === 0) return;
  await Promise.allSettled(
    needs.map(async (el) => {
      const result = await probeMediaUrl(el.src!);
      if (result) apply(el.key ?? el.id, result.duration);
    }),
  );
}

async function probeMediaUrl(url: string): Promise<MediaProbeResult | null> {
  const key = normalizeUrl(url);
  const cached = cache.get(key);
  if (cached) return cached;
  if (failed.has(key)) return null;

  let pending = inflight.get(key);
  if (pending) return pending;

  pending = probeOne(key).then((result) => {
    inflight.delete(key);
    if (result) cache.set(key, result);
    else failed.add(key);
    return result;
  });
  inflight.set(key, pending);
  return pending;
}
