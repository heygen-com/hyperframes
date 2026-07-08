// fallow-ignore-file complexity
// Browser-only runtime (OfflineAudioContext), not coverable by Node unit
// tests; the CRAP score is inflated by the missing coverage.
import type { AudioClip } from "./audioClips.js";

export interface AudioMixOptions {
  sampleRate?: number;
  numberOfChannels?: number;
}

const DEFAULT_SAMPLE_RATE = 48000;
const DEFAULT_CHANNELS = 2;

async function decodeClip(
  context: OfflineAudioContext,
  clip: AudioClip,
): Promise<AudioBuffer | null> {
  try {
    const response = await fetch(clip.src);
    if (!response.ok) return null;
    return await context.decodeAudioData(await response.arrayBuffer());
  } catch {
    // Unreachable/CORS-blocked/non-audio sources are skipped, not fatal —
    // matches the producer's behavior of rendering whatever audio it can.
    return null;
  }
}

function scheduleClip(
  context: OfflineAudioContext,
  clip: AudioClip,
  buffer: AudioBuffer,
  totalDurationSeconds: number,
): void {
  const available = Math.max(0, buffer.duration - clip.mediaStart);
  const remaining = Math.max(0, totalDurationSeconds - clip.start);
  const playDuration = Math.min(clip.duration ?? available, available, remaining);
  if (playDuration <= 0) return;
  const source = context.createBufferSource();
  source.buffer = buffer;
  const gain = context.createGain();
  gain.gain.value = clip.volume;
  source.connect(gain);
  gain.connect(context.destination);
  source.start(clip.start, clip.mediaStart, playDuration);
}

/**
 * Decode every clip and mix them offline into a single AudioBuffer spanning
 * the whole composition. Returns null when there is nothing audible.
 */
export async function mixAudioClips(
  clips: readonly AudioClip[],
  durationSeconds: number,
  options: AudioMixOptions = {},
): Promise<AudioBuffer | null> {
  if (clips.length === 0 || durationSeconds <= 0) return null;
  const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const context = new OfflineAudioContext(
    options.numberOfChannels ?? DEFAULT_CHANNELS,
    Math.ceil(durationSeconds * sampleRate),
    sampleRate,
  );
  let scheduled = 0;
  for (const clip of clips) {
    const buffer = await decodeClip(context, clip);
    if (!buffer) continue;
    scheduleClip(context, clip, buffer, durationSeconds);
    scheduled += 1;
  }
  if (scheduled === 0) return null;
  return context.startRendering();
}
