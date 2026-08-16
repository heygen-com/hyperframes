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
import { riffChunks } from "./wavChunks.js";

const PCM_FORMAT = 1; // WAVE_FORMAT_PCM
const FLOAT_FORMAT = 3; // WAVE_FORMAT_IEEE_FLOAT

interface WavLayout {
  numChannels: number;
  sampleRate: number;
  dataOffset: number;
  dataSize: number;
  /** 16-bit integer, or 32-bit float — the group sub-mix writes float so an
   *  over-unity member sum is not hard-clipped before the group's own FX and
   *  fader get to act on it. */
  float: boolean;
}

/**
 * Locate the `fmt ` and `data` chunks and validate the format we know how to edit.
 *
 * Scans every chunk rather than assuming an ordering: the loop always advances
 * past a chunk's body (using its declared size), so `data` may precede `fmt `
 * and trailing chunks (LIST/fact/etc.) are skipped harmlessly. Returns null on
 * anything unexpected so the caller falls back to the expression path.
 */
interface WavFmt {
  numChannels: number;
  sampleRate: number;
  /** 16-bit integer PCM, or 32-bit IEEE float. Anything else is unreadable. */
  float: boolean;
}

/** The `fmt ` chunk, or null for a format this cannot safely edit in place. */
function readFmtChunk(buffer: Buffer, body: number): WavFmt | null {
  const format = buffer.readUInt16LE(body);
  const bits = buffer.readUInt16LE(body + 14);
  const float = format === FLOAT_FORMAT;
  if (!float && format !== PCM_FORMAT) return null;
  if (bits !== (float ? 32 : 16)) return null;
  const numChannels = buffer.readUInt16LE(body + 2);
  if (numChannels < 1) return null;
  return { numChannels, sampleRate: buffer.readUInt32LE(body + 4), float };
}

function isRiffWave(buffer: Buffer): boolean {
  return (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WAVE"
  );
}

function parseWavLayout(buffer: Buffer): WavLayout | null {
  if (!isRiffWave(buffer)) return null;

  let fmt: WavFmt | null = null;
  let data: { offset: number; size: number } | null = null;

  for (const { id, body, size } of riffChunks(buffer)) {
    if (id === "fmt " && body + 16 <= buffer.length) {
      fmt = readFmtChunk(buffer, body);
    } else if (id === "data") {
      data = { offset: body, size: Math.min(size, buffer.length - body) };
    }
  }

  if (!fmt || !data) return null;
  return { ...fmt, dataOffset: data.offset, dataSize: data.size };
}

/**
 * A gain lookup that walks forward through the envelope with a segment cursor,
 * so a whole track costs O(N+M) rather than O(N×M). `interpolateVolumeGain`
 * restarts from segment 0 on every call — fine for the preview path (once per
 * RAF tick), not for a per-sample walk over 48k×duration frames.
 *
 * The cursor only ever advances, so callers must pass non-decreasing times.
 * Returns null when the keyframes normalise to nothing, which the callers read
 * as "no automation here".
 */
export function createEnvelopeWalker(
  keyframes: AudioVolumeKeyframe[],
  trackStart: number,
  baseVolume: number,
): ((time: number) => number) | null {
  const envelope = normaliseEnvelope(keyframes, trackStart, baseVolume);
  const first = envelope[0];
  if (!first) return null;

  let segment = 0;
  return (time: number): number => {
    for (;;) {
      const next = envelope[segment + 1];
      if (segment >= envelope.length - 2 || !next || time < next.time) break;
      segment += 1;
    }
    const a = envelope[segment] ?? first;
    const b = envelope[segment + 1] ?? a;
    const span = b.time - a.time;
    const progress = span <= 0 ? 0 : Math.min(1, Math.max(0, (time - a.time) / span));
    return a.volume + (b.volume - a.volume) * progress;
  };
}

/** Every sample scaled by the envelope, in place, in whichever of the two
 *  formats the layout reports. Float is NOT clamped: it is the format the group
 *  sub-mix writes precisely so an over-unity sum keeps its headroom until
 *  something downstream chooses to reduce it. */
function scaleSamples(
  buffer: Buffer,
  layout: WavLayout,
  gainAt: (seconds: number) => number,
): void {
  const { numChannels, sampleRate, dataOffset, dataSize, float } = layout;
  const bytesPerSample = float ? 4 : 2;
  const frameBytes = numChannels * bytesPerSample;
  const frameCount = Math.floor(dataSize / frameBytes);
  const scaleOne = float
    ? (at: number, gain: number) => buffer.writeFloatLE(buffer.readFloatLE(at) * gain, at)
    : (at: number, gain: number) => {
        const scaled = Math.round(buffer.readInt16LE(at) * gain);
        buffer.writeInt16LE(scaled < -32768 ? -32768 : scaled > 32767 ? 32767 : scaled, at);
      };

  for (let frame = 0; frame < frameCount; frame += 1) {
    const gain = gainAt(frame / sampleRate);
    const base = dataOffset + frame * frameBytes;
    for (let channel = 0; channel < numChannels; channel += 1) {
      scaleOne(base + channel * bytesPerSample, gain);
    }
  }
}

/**
 * Multiply a prepared WAV's samples by a time-varying gain envelope in place.
 *
 * @returns `true` if the envelope was applied; `false` if the file is neither
 *   16-bit PCM nor 32-bit float (caller should fall back to the expression path).
 */
export function applyVolumeEnvelopeToWav(
  wavPath: string,
  keyframes: AudioVolumeKeyframe[],
  trackStart: number,
  baseVolume: number,
): boolean {
  const gainAt = createEnvelopeWalker(keyframes, trackStart, baseVolume);
  if (!gainAt) return false;

  try {
    const buffer = readFileSync(wavPath);
    const layout = parseWavLayout(buffer);
    if (!layout) return false;

    scaleSamples(buffer, layout, gainAt);

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
