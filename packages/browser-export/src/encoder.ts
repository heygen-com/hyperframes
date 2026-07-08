// fallow-ignore-file complexity
// Browser-only runtime (WebCodecs/mediabunny), not coverable by Node unit
// tests; the CRAP score is inflated by the missing coverage.
import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  WebMOutputFormat,
} from "mediabunny";
import { codecsForFormat } from "./codecs.js";
import type { ExportFormat } from "./types.js";

export interface EncoderOptions {
  format: ExportFormat;
  fps: number;
  videoBitrate?: number;
  audioBitrate?: number;
  withAudio: boolean;
}

export interface Encoder {
  mimeType: string;
  addFrame(timestampSeconds: number, durationSeconds: number, keyFrame: boolean): Promise<void>;
  addAudio(buffer: AudioBuffer): Promise<void>;
  finalize(): Promise<Blob>;
}

export async function createEncoder(
  canvas: HTMLCanvasElement,
  options: EncoderOptions,
): Promise<Encoder> {
  const codecs = codecsForFormat(options.format);
  const output = new Output({
    format: options.format === "webm" ? new WebMOutputFormat() : new Mp4OutputFormat(),
    target: new BufferTarget(),
  });
  const videoSource = new CanvasSource(canvas, {
    codec: codecs.video,
    bitrate: options.videoBitrate ?? QUALITY_HIGH,
  });
  output.addVideoTrack(videoSource, { frameRate: options.fps });
  const audioSource = options.withAudio
    ? new AudioBufferSource({
        codec: codecs.audio,
        bitrate: options.audioBitrate ?? QUALITY_HIGH,
      })
    : null;
  if (audioSource) output.addAudioTrack(audioSource);
  await output.start();
  return {
    mimeType: codecs.mimeType,
    addFrame: (timestampSeconds, durationSeconds, keyFrame) =>
      videoSource.add(timestampSeconds, durationSeconds, { keyFrame }),
    async addAudio(buffer) {
      if (!audioSource) return;
      await audioSource.add(buffer);
      audioSource.close();
    },
    async finalize() {
      videoSource.close();
      await output.finalize();
      const bytes = (output.target as BufferTarget).buffer;
      if (!bytes) throw new Error("Encoder produced no output");
      return new Blob([bytes], { type: codecs.mimeType });
    },
  };
}
