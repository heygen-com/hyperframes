/**
 * Applies an audio FX chain to a WAV at render time.
 *
 * The processing runs in an OfflineAudioContext inside the headless browser the
 * engine already drives, using the same graph builders the studio previews
 * with. There is one implementation of each effect, so the render matching the
 * preview is a property of the architecture rather than a tolerance to police.
 *
 * The alternative — reimplementing every effect as an FFmpeg filter — means two
 * implementations that have to be kept in agreement, and four of them (the
 * dynamics processors and the modulated delays) have no filter that behaves the
 * same way, so preview would quietly stop predicting the render.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getAudioFxRuntimeScript } from "@hyperframes/core/audio-fx-runtime";
import { enabledAudioFxNodes, type HfAudioFxChain } from "@hyperframes/core/audio-fx";
import { acquireBrowser } from "./browserManager.js";

export class AudioFxRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudioFxRenderError";
  }
}

interface WavData {
  samples: Float32Array;
  sampleRate: number;
  channels: number;
}

/**
 * Minimal reader for the WAVs the mixer produces upstream. Handles 16-bit PCM
 * and 32-bit float, the two formats the trim/extract steps emit; anything else
 * is refused rather than silently misread as noise.
 */
/** Walk the chunks for the format and the payload, in whatever order they sit. */
function readWavChunks(buf: Buffer): {
  format: number;
  channels: number;
  sampleRate: number;
  bits: number;
  data?: Buffer;
} {
  let offset = 12;
  const head = { format: 1, channels: 1, sampleRate: 48000, bits: 16 };
  let data: Buffer | undefined;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      head.format = buf.readUInt16LE(offset + 8);
      head.channels = buf.readUInt16LE(offset + 10);
      head.sampleRate = buf.readUInt32LE(offset + 12);
      head.bits = buf.readUInt16LE(offset + 22);
    } else if (id === "data") {
      data = buf.subarray(offset + 8, Math.min(buf.length, offset + 8 + size));
      break;
    }
    offset += 8 + size + (size % 2);
  }
  return { ...head, data };
}

export function readWav(path: string): WavData {
  const buf = readFileSync(path);
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF") {
    throw new AudioFxRenderError(`Not a WAV file: ${path}`);
  }
  const { format, channels, sampleRate, bits, data } = readWavChunks(buf);
  if (!data) throw new AudioFxRenderError(`WAV has no data chunk: ${path}`);
  return { samples: decodeSamples(data, format, bits, path), sampleRate, channels };
}

/** Interleaved samples as floats, for the two formats the mixer emits upstream. */
function decodeSamples(data: Buffer, format: number, bits: number, path: string): Float32Array {
  if (format === 3 && bits === 32) {
    const n = Math.floor(data.length / 4);
    // A Float32Array view demands a 4-aligned offset, and chunk layouts that put
    // `data` on an odd boundary (an 18-byte fmt plus a fact chunk, which
    // ffmpeg's pcm_f32le writes) would otherwise throw RangeError. Copy then.
    if (data.byteOffset % 4 === 0) return new Float32Array(data.buffer, data.byteOffset, n);
    const copied = new Float32Array(n);
    for (let i = 0; i < n; i++) copied[i] = data.readFloatLE(i * 4);
    return copied;
  }
  if (format === 1 && bits === 16) {
    const n = Math.floor(data.length / 2);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = data.readInt16LE(i * 2) / 32768;
    return out;
  }
  throw new AudioFxRenderError(`Unsupported WAV format ${format}/${bits}-bit: ${path}`);
}

/**
 * Write 16-bit PCM, interleaved, preserving the channel count.
 *
 * 16-bit rather than the float32 this used to emit: the very next step in the
 * mixer bakes the volume envelope into the samples, and that baker accepts only
 * 16-bit PCM. Emitting float meant enabling any effect silently downgraded a
 * track's volume automation to the ffmpeg expression path, which is capped at 32
 * straight segments — so a curved envelope was quantised and a dense one could
 * fall back to rendering at base volume.
 */
export function writeWav(
  path: string,
  samples: Float32Array,
  sampleRate: number,
  channels = 1,
): void {
  const n = samples.length;
  const bytes = n * 2;
  const buf = Buffer.alloc(44 + bytes);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + bytes, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // WAVE_FORMAT_PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * 2, 28);
  buf.writeUInt16LE(channels * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(bytes, 40);
  for (let i = 0; i < n; i++) {
    // Clamp before scaling: a limiter set to 0 dB or a resonant filter can push
    // past full scale, and wrapping would turn that into a click.
    const v = Math.max(-1, Math.min(1, samples[i] ?? 0));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  writeFileSync(path, buf);
}

/**
 * Split an interleaved buffer into one array per channel.
 *
 * The graph used to fold everything to mono, which collapsed a stereo bed's
 * width for the render only — and cost ~3 dB through the very mono-to-stereo
 * rematrix that `prepareAudioTrack`'s pan filter exists to avoid. Preview kept
 * the track stereo, so the two diverged the moment any effect was enabled.
 */
function deinterleave(samples: Float32Array, channels: number): Float32Array[] {
  if (channels <= 1) return [samples];
  const frames = Math.floor(samples.length / channels);
  const out = Array.from({ length: channels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      (out[c] as Float32Array)[i] = samples[i * channels + c] ?? 0;
    }
  }
  return out;
}

/** Re-interleave per-channel arrays for the WAV writer. */
function interleave(planes: readonly Float32Array[]): Float32Array {
  if (planes.length === 1) return planes[0] as Float32Array;
  const frames = planes[0]?.length ?? 0;
  const out = new Float32Array(frames * planes.length);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < planes.length; c++) {
      out[i * planes.length + c] = (planes[c] as Float32Array)[i] ?? 0;
    }
  }
  return out;
}

/**
 * Run a chain over `inputWav`, writing `outputWav`. Resolves to the path to use
 * downstream: `outputWav` when the chain did something, `inputWav` untouched
 * when the chain was empty.
 *
 * Failure is fatal to the caller rather than a soft per-track warning: quietly
 * rendering the dry signal ships a mix that sounds plausible and is not what
 * the author set up.
 */
export async function applyAudioFxChain(
  inputWav: string,
  chain: HfAudioFxChain,
  outputWav: string,
  options: { trackId: string; signal?: AbortSignal },
): Promise<string> {
  if (enabledAudioFxNodes(chain).length === 0) return inputWav;
  if (!existsSync(inputWav)) {
    throw new AudioFxRenderError(`Audio FX input is missing: ${inputWav}`);
  }

  const { samples, sampleRate, channels } = readWav(inputWav);
  const planes = deinterleave(samples, channels);

  // Audio processing needs no GPU or special capture mode; a plain sandboxed
  // browser is enough, and the lease pool reuses one across tracks.
  const lease = await acquireBrowser([
    "--no-sandbox",
    "--autoplay-policy=no-user-gesture-required",
  ]);
  const hostDir = mkdtempSync(join(tmpdir(), "hf-fx-host-"));
  try {
    if (options.signal?.aborted) {
      throw new AudioFxRenderError(`Audio FX cancelled for track ${options.trackId}`);
    }
    const page = await lease.browser.newPage();
    try {
      // AudioWorklet is only exposed in a secure context, and about:blank is
      // not one — the module would fail with an opaque error. A file:// page
      // qualifies and needs no listening socket.
      const hostPage = join(hostDir, "audio-fx.html");
      writeFileSync(hostPage, "<!doctype html><meta charset=utf-8><title>audio fx</title>");
      await page.goto(pathToFileURL(hostPage).href, { waitUntil: "domcontentloaded" });
      await page.addScriptTag({ content: getAudioFxRuntimeScript() });

      const rendered = (await page.evaluate(
        async ([channelB64, rate, chainJson]: [string[], number, string]) => {
          const decode = (b64: string): Float32Array => {
            const bin = atob(b64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            return new Float32Array(bytes.buffer);
          };
          const api = (
            window as unknown as {
              __HF_AUDIO_FX?: {
                render(p: Float32Array[], r: number, c: string): Promise<Float32Array[]>;
              };
            }
          ).__HF_AUDIO_FX;
          if (!api) throw new Error("audio FX runtime failed to load");
          const out = await api.render(channelB64.map(decode), rate, chainJson);
          const encode = (plane: Float32Array): string => {
            const u8 = new Uint8Array(plane.buffer, plane.byteOffset, plane.length * 4);
            let s = "";
            const CHUNK = 0x8000;
            for (let i = 0; i < u8.length; i += CHUNK) {
              s += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + CHUNK)));
            }
            return btoa(s);
          };
          return out.map(encode);
        },
        [
          planes.map((plane) =>
            Buffer.from(plane.buffer, plane.byteOffset, plane.length * 4).toString("base64"),
          ),
          sampleRate,
          JSON.stringify(chain),
        ] as [string[], number, string],
      )) as string[];

      // byteOffset and byteLength matter: Node pools small allocations, so a
      // short payload decodes into an 8 KiB pool and a view over the whole
      // ArrayBuffer would read kilobytes of unrelated memory at the wrong length.
      const outPlanes = rendered.map((b64) => {
        const buf = Buffer.from(b64, "base64");
        return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      });
      if (outPlanes.length === 0 || (outPlanes[0]?.length ?? 0) === 0) {
        throw new AudioFxRenderError(`Audio FX produced no samples for track ${options.trackId}`);
      }
      writeWav(outputWav, interleave(outPlanes), sampleRate, outPlanes.length);
      return outputWav;
    } finally {
      await page.close().catch(() => undefined);
    }
  } catch (err) {
    if (err instanceof AudioFxRenderError) throw err;
    throw new AudioFxRenderError(
      `Audio FX failed for track ${options.trackId}: ${(err as Error).message}`,
    );
  } finally {
    rmSync(hostDir, { recursive: true, force: true });
    await lease.release().catch(() => undefined);
  }
}

export type { HfAudioFxChain };
