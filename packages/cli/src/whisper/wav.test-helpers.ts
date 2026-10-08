import { wavHeader } from "./wav.js";

/** A 16-bit mono PCM WAV of `samples` (-1..1), as prepareWav writes one. */
export function encodeWav(samples: ArrayLike<number>, sampleRate: number): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i]! * 32768))), 2 * i);
  }
  return Buffer.concat([wavHeader(data.length, sampleRate), data]);
}
