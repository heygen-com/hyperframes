/**
 * Sample-accurate volume automation.
 *
 * The audio mixer's primary path for time-varying volume bakes the envelope
 * directly into the prepared PCM rather than encoding it as an FFmpeg `volume`
 * expression. The expression approach nests one `if(lt(t,...))` per keyframe and
 * overflows FFmpeg's expression evaluator past ~95 levels (a dense GSAP fade
 * emits hundreds of keyframes), which fails the whole mix and drops the audio
 * track. Multiplying the samples in-house has no such ceiling, is exact at every
 * sample, and keeps the downstream ffmpeg `amix`/AAC encode untouched — so the
 * output (and the golden baselines) only change where a fade is actually applied.
 *
 * The prepared tracks are always `pcm_s16le`, 48 kHz, stereo (see
 * `prepareAudioTrack` / `extractAudioFromVideo`). Anything else is rejected so
 * the caller can fall back to the expression path rather than corrupting audio.
 */

import { readFileSync, renameSync, writeFileSync } from "fs";
import { randomBytes } from "crypto";
import type { AudioVolumeKeyframe } from "./audioMixer.types.js";
import { normaliseEnvelope } from "@hyperframes/core/media-volume-envelope";

const PCM_FORMAT = 1; // WAVE_FORMAT_PCM
const SUPPORTED_BITS = 16;

interface WavLayout {
  numChannels: number;
  sampleRate: number;
  dataOffset: number;
  dataSize: number;
}

/**
 * Locate the `fmt ` and `data` chunks and validate the format we know how to edit.
 *
 * Scans every chunk rather than assuming an ordering: the loop always advances
 * past a chunk's body (using its declared size), so `data` may precede `fmt `
 * and trailing chunks (LIST/fact/etc.) are skipped harmlessly. Returns null on
 * anything unexpected so the caller falls back to the expression path.
 */
function parseWavLayout(buffer: Buffer): WavLayout | null {
  if (buffer.length < 12 || buffer.toString("ascii", 0, 4) !== "RIFF") return null;
  if (buffer.toString("ascii", 8, 12) !== "WAVE") return null;

  let offset = 12;
  let fmt: { numChannels: number; sampleRate: number; bitsPerSample: number } | null = null;
  let data: { offset: number; size: number } | null = null;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (chunkId === "fmt " && body + 16 <= buffer.length) {
      if (buffer.readUInt16LE(body) !== PCM_FORMAT) return null;
      fmt = {
        numChannels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bitsPerSample: buffer.readUInt16LE(body + 14),
      };
    } else if (chunkId === "data") {
      data = { offset: body, size: Math.min(chunkSize, buffer.length - body) };
    }
    // Chunks are word-aligned: an odd size carries a trailing pad byte.
    offset = body + chunkSize + (chunkSize % 2);
  }

  if (!fmt || !data) return null;
  if (fmt.bitsPerSample !== SUPPORTED_BITS || fmt.numChannels < 1) return null;
  return {
    numChannels: fmt.numChannels,
    sampleRate: fmt.sampleRate,
    dataOffset: data.offset,
    dataSize: data.size,
  };
}

/**
 * Multiply a prepared WAV's samples by a time-varying gain envelope in place.
 *
 * @returns `true` if the envelope was applied; `false` if the file isn't the
 *   expected 16-bit PCM (caller should fall back to the expression path).
 */
export function applyVolumeEnvelopeToWav(
  wavPath: string,
  keyframes: AudioVolumeKeyframe[],
  trackStart: number,
  baseVolume: number,
): boolean {
  const envelope = normaliseEnvelope(keyframes, trackStart, baseVolume);
  if (envelope.length === 0) return false;

  try {
    const buffer = readFileSync(wavPath);
    const layout = parseWavLayout(buffer);
    if (!layout) return false;

    const { numChannels, sampleRate, dataOffset, dataSize } = layout;
    const bytesPerSample = SUPPORTED_BITS / 8;
    const frameBytes = numChannels * bytesPerSample;
    const frameCount = Math.floor(dataSize / frameBytes);

    // Maintain an incremental segment cursor so the per-frame envelope lookup
    // is O(N+M) overall, not O(N×M). interpolateVolumeGain restarts from 0 on
    // each call — fine for the preview path (one call per RAF tick) but not for
    // the PCM path (one call per sample, 48k×duration frames total).
    let segment = 0;
    for (let frame = 0; frame < frameCount; frame += 1) {
      const time = frame / sampleRate;
      while (segment < envelope.length - 2 && time >= envelope[segment + 1]!.time) segment += 1;

      const a = envelope[segment]!;
      const b = envelope[segment + 1] ?? a;
      const span = b.time - a.time;
      const progress = span <= 0 ? 0 : Math.min(1, Math.max(0, (time - a.time) / span));
      const gain = a.volume + (b.volume - a.volume) * progress;

      const base = dataOffset + frame * frameBytes;
      for (let channel = 0; channel < numChannels; channel += 1) {
        const at = base + channel * bytesPerSample;
        const scaled = Math.round(buffer.readInt16LE(at) * gain);
        buffer.writeInt16LE(scaled < -32768 ? -32768 : scaled > 32767 ? 32767 : scaled, at);
      }
    }

    // Write to a uniquely-named sibling then atomically rename over the
    // original. The random name avoids following a pre-planted symlink at a
    // predictable path, and the rename means a crash mid-write can't leave a
    // truncated WAV for the downstream mix.
    const tempPath = `${wavPath}.${randomBytes(6).toString("hex")}.tmp`;
    writeFileSync(tempPath, buffer);
    renameSync(tempPath, wavPath);
    return true;
  } catch {
    // Any read/parse/write failure → leave the file untouched and let the
    // caller fall back to the ffmpeg expression path rather than losing audio.
    return false;
  }
}
