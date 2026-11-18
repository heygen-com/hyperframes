export interface FfprobeStreamCodec {
  codec_type?: string;
  codec_name?: string;
}

export interface FfprobePcmFields extends FfprobeStreamCodec {
  sample_rate?: string;
  channels?: number;
  bit_rate?: string;
  bits_per_sample?: number;
}

/** PCM whose header byte rate is not sample rate x channels x sample size: a seek by it lands wrong. */
export function misstatesPcmByteRate(stream: FfprobePcmFields): boolean {
  const declared = Number(stream.bit_rate);
  const { channels, bits_per_sample: bits } = stream;
  const rate = Number(stream.sample_rate);
  if (!stream.codec_name?.startsWith("pcm_") || !declared || !channels || !bits || !rate) {
    return false;
  }
  return declared !== rate * channels * bits;
}

/** The audio track ffmpeg can decode, as N in `-map 0:a:N`; ffprobe names no codec for one it cannot. */
export function decodableAudioStream(streams: readonly FfprobeStreamCodec[]): number | null {
  const index = streams
    .filter((stream) => stream.codec_type === "audio")
    .findIndex((stream) => stream.codec_name !== undefined);
  return index < 0 ? null : index;
}
