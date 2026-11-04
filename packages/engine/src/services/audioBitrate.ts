const DEFAULT_AAC_AUDIO_BITRATE = "192k";
const DEFAULT_OPUS_AUDIO_BITRATE = "128k";
// libopus accepts 500 bps to 512 kbps for stereo; AAC rates sit well inside it.
const MIN_AUDIO_BITRATE_BPS = 500;
const MAX_AUDIO_BITRATE_BPS = 512_000;
const SUFFIX_MULTIPLIER: Record<string, number> = { "": 1, k: 1_000, K: 1_000, M: 1_000_000 };

/** Whether `audioBitrate` (a number with an optional k/K/M suffix) is a rate every audio encoder accepts. */
export function isValidAudioBitrate(audioBitrate: string): boolean {
  const match = /^(\d+(?:\.\d+)?)([kKM]?)$/.exec(audioBitrate.trim());
  if (!match) return false;
  const bps = Number(match[1]) * SUFFIX_MULTIPLIER[match[2]!]!;
  return bps >= MIN_AUDIO_BITRATE_BPS && bps <= MAX_AUDIO_BITRATE_BPS;
}

function trimmedBitrate(audioBitrate: string | undefined): string | undefined {
  const trimmed = audioBitrate?.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveAacAudioBitrate(audioBitrate?: string): string {
  return trimmedBitrate(audioBitrate) ?? DEFAULT_AAC_AUDIO_BITRATE;
}

export function resolveOpusAudioBitrate(audioBitrate?: string): string {
  return trimmedBitrate(audioBitrate) ?? DEFAULT_OPUS_AUDIO_BITRATE;
}
