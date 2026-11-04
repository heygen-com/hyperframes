export interface FfprobeStreamCodec {
  codec_type?: string;
  codec_name?: string;
}

/** The audio track ffmpeg can decode, as N in `-map 0:a:N`; ffprobe names no codec for one it cannot. */
export function decodableAudioStream(streams: readonly FfprobeStreamCodec[]): number | null {
  const index = streams
    .filter((stream) => stream.codec_type === "audio")
    .findIndex((stream) => stream.codec_name !== undefined);
  return index < 0 ? null : index;
}
