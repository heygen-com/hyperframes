import {
  mediaCacheKey,
  metadataResolver,
  normalizeMediaUrl,
  type MediaProbeResult,
} from "./mediaResolver";

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

/**
 * Throws on anything that is not usable media. The resolver turns that into an
 * expiring failure record, so a transient error is retried after the TTL
 * instead of being remembered for the life of the tab.
 */
async function probeOne(url: string): Promise<MediaProbeResult> {
  const mb = await loadMediabunny();
  if (!mb) throw new Error("mediaProbe: mediabunny unavailable");

  const input = new mb.Input({
    source: new mb.UrlSource(url),
    formats: mb.ALL_FORMATS,
  });
  try {
    const duration = await input.getDurationFromMetadata();
    if (duration == null || !Number.isFinite(duration) || duration <= 0) {
      throw new Error(`mediaProbe: no usable duration for ${url}`);
    }

    const videoTrack = await input.getPrimaryVideoTrack();
    const audioTracks = await input.getAudioTracks();

    return {
      duration,
      width: videoTrack?.displayWidth,
      height: videoTrack?.displayHeight,
      hasVideo: videoTrack != null,
      hasAudio: audioTracks.length > 0,
    };
  } finally {
    input.dispose();
  }
}

function getCachedProbe(url: string): MediaProbeResult | undefined {
  return metadataResolver.peek(mediaCacheKey(url));
}

/**
 * Re-apply a known `sourceDuration` to media elements that arrive without one.
 *
 * A duration belongs to the SOURCE, not to the clip, and one file typically
 * backs many clips. Two things know it: the probe cache, and any sibling clip
 * whose live preview element has already reported `duration`. Both seed every
 * clip sharing that src — otherwise re-deriving the timeline (a clip move, or
 * the neighbourhood loader promoting one clip out of seven) leaves the siblings
 * unknown, which loses trimmed waveforms their window AND sends the probe to
 * the network for a header the page already has.
 */
export function applyCachedSourceDurations<
  T extends { src?: string; tag: string; sourceDuration?: number },
>(elements: T[]): T[] {
  const bySource = new Map<string, number>();
  for (const el of elements) {
    if (el.src && el.sourceDuration != null && el.sourceDuration > 0) {
      bySource.set(normalizeMediaUrl(el.src), el.sourceDuration);
    }
  }
  return elements.map((el) => {
    const tag = el.tag.toLowerCase();
    if (!el.src || el.sourceDuration != null || (tag !== "audio" && tag !== "video")) return el;
    const known = bySource.get(normalizeMediaUrl(el.src)) ?? getCachedProbe(el.src)?.duration;
    return known && known > 0 ? { ...el, sourceDuration: known } : el;
  });
}

/**
 * Probe (header-only, cheap) any media elements still missing sourceDuration
 * after the cache pass, applying each resolved duration via `apply(key, secs)`.
 * Skips already-cached srcs and srcs whose last probe failed within the TTL, so
 * the rAF-driven timeline re-derive neither re-fetches nor floods the console.
 *
 * Also skips `sourceDurationPending` elements — the ones the runtime is already
 * fetching for the preview. Probing those was the Studio document's single
 * largest source of request amplification: every media file in the composition
 * was downloaded once by the preview iframe and again here, to learn a number
 * the preview's own `<video>.duration` reports for free a scan later. If that
 * preview load fails, the element keeps no duration rather than gaining one
 * from a second download that would fail the same way.
 */
export async function probeMissingSourceDurations<
  T extends {
    src?: string;
    tag: string;
    sourceDuration?: number;
    sourceDurationPending?: boolean;
    key?: string;
    id: string;
  },
>(elements: T[], apply: (key: string, durationSeconds: number) => void): Promise<void> {
  // Per SOURCE, not per element: one file backs many clips, and the runtime
  // only promotes the clips near the playhead. The siblings of a promoted clip
  // carry no pending mark, and probing any one of them downloads the very file
  // the promoted one is already fetching.
  const pendingSources = new Set(
    elements
      .filter((el) => el.src && el.sourceDurationPending)
      .map((el) => normalizeMediaUrl(el.src!)),
  );
  const needs = elements.filter(
    (el) =>
      el.src &&
      el.sourceDuration == null &&
      !pendingSources.has(normalizeMediaUrl(el.src)) &&
      ["video", "audio"].includes(el.tag.toLowerCase()) &&
      !getCachedProbe(el.src) &&
      !metadataResolver.hasFreshFailure(mediaCacheKey(el.src)),
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
  try {
    return await metadataResolver.resolve(mediaCacheKey(url), () =>
      probeOne(normalizeMediaUrl(url)),
    );
  } catch {
    return null;
  }
}
