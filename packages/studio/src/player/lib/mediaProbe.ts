export interface MediaProbeResult {
  duration: number;
  width?: number;
  height?: number;
  hasVideo: boolean;
  hasAudio: boolean;
}

const cache = new Map<string, MediaProbeResult>();
const inflight = new Map<string, Promise<MediaProbeResult | null>>();

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

export function getCachedProbe(url: string): MediaProbeResult | undefined {
  return cache.get(normalizeUrl(url));
}

export async function probeMediaUrl(url: string): Promise<MediaProbeResult | null> {
  const key = normalizeUrl(url);
  const cached = cache.get(key);
  if (cached) return cached;

  let pending = inflight.get(key);
  if (pending) return pending;

  pending = probeOne(key).then((result) => {
    inflight.delete(key);
    if (result) cache.set(key, result);
    return result;
  });
  inflight.set(key, pending);
  return pending;
}
