import { Input, UrlSource, ALL_FORMATS } from "mediabunny";

export interface MediaProbeResult {
  duration: number;
  width?: number;
  height?: number;
  hasVideo: boolean;
  hasAudio: boolean;
}

const cache = new Map<string, MediaProbeResult>();
const inflight = new Map<string, Promise<MediaProbeResult | null>>();

function normalizeUrl(url: string): string {
  try {
    return new URL(url, window.location.href).href;
  } catch {
    return url;
  }
}

async function probeOne(url: string): Promise<MediaProbeResult | null> {
  const input = new Input({
    source: new UrlSource(url),
    formats: ALL_FORMATS,
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
