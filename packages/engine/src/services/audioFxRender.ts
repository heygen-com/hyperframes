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
import { serializeAutomation, type HfAutomation } from "@hyperframes/core/audio-automation";
import { acquireBrowser } from "./browserManager.js";
import { createEnvelopeWalker } from "./audioVolumeEnvelope.js";
import { riffChunks } from "./wavChunks.js";
import type { AudioVolumeKeyframe } from "./audioMixer.types.js";

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
  const head = { format: 1, channels: 1, sampleRate: 48000, bits: 16 };
  let data: Buffer | undefined;
  for (const { id, body, size } of riffChunks(buf)) {
    if (id === "fmt ") {
      head.format = buf.readUInt16LE(body);
      head.channels = buf.readUInt16LE(body + 2);
      head.sampleRate = buf.readUInt32LE(body + 4);
      head.bits = buf.readUInt16LE(body + 14);
    } else if (id === "data") {
      data = buf.subarray(body, Math.min(buf.length, body + size));
      // The payload is the rest of the file for anything the mixer writes, and
      // reading past it buys nothing: `fmt ` precedes `data` in every WAV these
      // steps produce, and the alternative is walking a several-hundred-megabyte
      // tail chunk by chunk.
      break;
    }
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
  // lgtm[js/insecure-temporary-file] — `path` is always inside a directory the
  // caller made with `mkdtempSync`, never a name assembled directly under
  // `tmpdir()`. Both routes here are covered: the browser host page writes into
  // `mkdtempSync(join(tmpdir(), "hf-fx-host-"))` below, and the render output
  // goes to the producer's work dir, itself created as
  // `mkdtempSync(join(tempRoot, "producer-project-"))`. mkdtemp picks the random
  // suffix and creates the directory 0700 in one syscall, so the predictable
  // FILENAME inside it (`<elementId>-fx.wav`) cannot be pre-created or
  // symlinked by another user — which is the attack this rule is about. CodeQL
  // flags it because the dataflow reaches `tmpdir()` without seeing the mkdtemp
  // in between.
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
 * Bytes of PCM per CDP message.
 *
 * The whole track used to cross in a single `page.evaluate` pair — ~184 MB of
 * base64 for a 3-minute stereo 48 kHz clip, in one WebSocket frame each way.
 * puppeteer-core caps its frames at 256 MB and the browser pool does not use
 * the pipe transport, so stereo past ~8.7 minutes failed the render outright;
 * V8's max string length is a second wall not far beyond it. Chunking bounds
 * both, and bounds the peak Node-side allocation with them: the mixer renders
 * tracks concurrently, so every track's payload was live at once.
 *
 * 8 MiB encodes to ~11 MB of base64. A multiple of 4, so a chunk boundary
 * never falls inside a float.
 */
const TRANSFER_BYTES = 8 * 1024 * 1024;

/** The page-side handover buffers, named off `window` so each step can find them. */
interface AudioFxPageIo {
  in: Uint8Array[][];
  out: Float32Array[];
}

interface AudioFxWindow {
  __HF_AUDIO_FX?: {
    render(p: Float32Array[], r: number, c: string, a?: string): Promise<Float32Array[]>;
  };
  __HF_FX_IO?: AudioFxPageIo;
}

/**
 * Multiply every channel by the envelope, in place, one gain per frame.
 *
 * Frame-outer rather than plane-outer on purpose: the walker's cursor only
 * moves forward, so restarting each channel at t=0 would hand the second one
 * the tail gain for its whole length.
 */
function applyEnvelopeToPlanes(
  planes: readonly Float32Array[],
  sampleRate: number,
  gainAt: (time: number) => number,
): void {
  const frames = planes[0]?.length ?? 0;
  for (let frame = 0; frame < frames; frame += 1) {
    const gain = gainAt(frame / sampleRate);
    for (const plane of planes) plane[frame] = (plane[frame] ?? 0) * gain;
  }
}

/**
 * Run a chain over `inputWav`, writing `outputWav`. Resolves to the path to use
 * downstream — `outputWav` when the chain did something, `inputWav` untouched
 * when the chain was empty — plus whether the volume envelope was baked here.
 *
 * The envelope is applied to the float samples the chain produced, BEFORE
 * `writeWav` quantises them. Leaving it to the mixer's second pass meant a
 * chain that overshoots full scale was destructively clipped to ±1 and only
 * then ducked, so a track the lane pulls 12 dB down still rendered the
 * distortion — which preview, working in float throughout, never had.
 * `writeWav`'s clamp stays: it is the correct last resort for a signal that is
 * still hot after the duck.
 *
 * Failure is fatal to the caller rather than a soft per-track warning: quietly
 * rendering the dry signal ships a mix that sounds plausible and is not what
 * the author set up.
 */
export async function applyAudioFxChain(
  inputWav: string,
  chain: HfAudioFxChain,
  outputWav: string,
  options: {
    trackId: string;
    signal?: AbortSignal;
    automation?: HfAutomation;
    envelope?: { keyframes: AudioVolumeKeyframe[]; trackStart: number; baseVolume: number };
  },
): Promise<{ path: string; envelopeBaked: boolean }> {
  if (enabledAudioFxNodes(chain).length === 0) return { path: inputWav, envelopeBaked: false };
  if (!existsSync(inputWav)) {
    throw new AudioFxRenderError(`Audio FX input is missing: ${inputWav}`);
  }

  const { samples, sampleRate, channels } = readWav(inputWav);
  const planes = deinterleave(samples, channels);
  // An empty track has nothing to process — and an OfflineAudioContext of zero
  // length throws, which is fatal for the WHOLE render rather than this track:
  // the error travels past the mixer's per-track failure collector. ffmpeg
  // writes an empty but structurally valid WAV whenever a clip's trim starts
  // past the end of its source, so one mis-set `data-media-start` used to take
  // the render down. Guarded here as well as in the runtime so an empty track
  // never costs a browser.
  if ((planes[0]?.length ?? 0) === 0) return { path: inputWav, envelopeBaked: false };

  // Both resources are taken INSIDE the try that releases them. The lease used
  // to be acquired above it, with the mkdtemp between — so a failure there
  // (a full disk, a read-only tmpdir) leaked a pooled browser, and a pool with
  // no leases left hangs every later render rather than failing one.
  const hostDir = mkdtempSync(join(tmpdir(), "hf-fx-host-"));
  let lease: Awaited<ReturnType<typeof acquireBrowser>> | null = null;
  try {
    // Audio processing needs no GPU or special capture mode; a plain sandboxed
    // browser is enough, and the lease pool reuses one across tracks.
    // Checked before the lease, not after: an already-cancelled track has no
    // reason to take a browser out of the pool just to hand it straight back.
    if (options.signal?.aborted) {
      throw new AudioFxRenderError(`Audio FX cancelled for track ${options.trackId}`);
    }
    lease = await acquireBrowser(["--no-sandbox", "--autoplay-policy=no-user-gesture-required"]);
    const page = await lease.browser.newPage();
    try {
      // AudioWorklet is only exposed in a secure context, and about:blank is
      // not one — the module would fail with an opaque error. A file:// page
      // qualifies and needs no listening socket.
      const hostPage = join(hostDir, "audio-fx.html");
      writeFileSync(hostPage, "<!doctype html><meta charset=utf-8><title>audio fx</title>");
      await page.goto(pathToFileURL(hostPage).href, { waitUntil: "domcontentloaded" });
      await page.addScriptTag({ content: getAudioFxRuntimeScript() });

      // Hand the input over a chunk at a time. The chunks stay separate byte
      // arrays page-side rather than being concatenated into one string, so
      // neither the frame cap nor V8's string limit sees the whole track.
      await page.evaluate((count: number) => {
        (window as unknown as AudioFxWindow).__HF_FX_IO = {
          in: Array.from({ length: count }, (): Uint8Array[] => []),
          out: [],
        };
      }, planes.length);

      for (let p = 0; p < planes.length; p += 1) {
        const plane = planes[p];
        if (!plane) continue;
        const bytes = Buffer.from(plane.buffer, plane.byteOffset, plane.length * 4);
        for (let at = 0; at < bytes.length; at += TRANSFER_BYTES) {
          await page.evaluate(
            ([index, b64]: [number, string]) => {
              const bin = atob(b64);
              const chunk = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) chunk[i] = bin.charCodeAt(i);
              (window as unknown as AudioFxWindow).__HF_FX_IO?.in[index]?.push(chunk);
            },
            [p, bytes.subarray(at, at + TRANSFER_BYTES).toString("base64")] as [number, string],
          );
        }
      }

      const outLengths = (await page.evaluate(
        async ([rate, chainJson, automationJson]: [number, string, string]) => {
          const w = window as unknown as AudioFxWindow;
          const io = w.__HF_FX_IO;
          if (!w.__HF_AUDIO_FX || !io) throw new Error("audio FX runtime failed to load");
          const inPlanes = io.in.map((chunks) => {
            const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
            let at = 0;
            for (const chunk of chunks) {
              bytes.set(chunk, at);
              at += chunk.length;
            }
            return new Float32Array(bytes.buffer);
          });
          // Dropped before the render allocates its own buffers, so the page
          // does not hold two copies of the track at once.
          io.in = [];
          io.out = await w.__HF_AUDIO_FX.render(
            inPlanes,
            rate,
            chainJson,
            automationJson || undefined,
          );
          return io.out.map((plane) => plane.length);
        },
        [
          sampleRate,
          JSON.stringify(chain),
          options.automation ? serializeAutomation(options.automation) : "",
        ] as [number, string, string],
      )) as number[];

      const outPlanes: Float32Array[] = [];
      for (let p = 0; p < outLengths.length; p += 1) {
        const byteLength = (outLengths[p] ?? 0) * 4;
        const parts: Buffer[] = [];
        for (let at = 0; at < byteLength; at += TRANSFER_BYTES) {
          const b64 = (await page.evaluate(
            ([index, offset, limit]: [number, number, number]) => {
              const plane = (window as unknown as AudioFxWindow).__HF_FX_IO?.out[index];
              if (!plane) return "";
              const u8 = new Uint8Array(
                plane.buffer,
                plane.byteOffset + offset,
                Math.min(limit, plane.length * 4 - offset),
              );
              let s = "";
              const CHUNK = 0x8000;
              for (let i = 0; i < u8.length; i += CHUNK) {
                // `apply` takes array-likes, so the subarray goes in as it is;
                // Array.from boxed every byte of a 32 KiB window for nothing.
                s += String.fromCharCode.apply(
                  null,
                  u8.subarray(i, i + CHUNK) as unknown as number[],
                );
              }
              return btoa(s);
            },
            [p, at, TRANSFER_BYTES] as [number, number, number],
          )) as string;
          parts.push(Buffer.from(b64, "base64"));
        }
        // byteOffset and byteLength matter: Node pools small allocations, so a
        // short payload decodes into an 8 KiB pool and a view over the whole
        // ArrayBuffer would read kilobytes of unrelated memory at the wrong length.
        const buf = Buffer.concat(parts);
        outPlanes.push(
          new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
        );
      }
      if (outPlanes.length === 0 || (outPlanes[0]?.length ?? 0) === 0) {
        throw new AudioFxRenderError(`Audio FX produced no samples for track ${options.trackId}`);
      }
      // Null when the keyframes normalise away to nothing — then the mixer's
      // own paths still own this track's gain, so say so rather than claiming
      // a bake that never happened.
      const gainAt = options.envelope
        ? createEnvelopeWalker(
            options.envelope.keyframes,
            options.envelope.trackStart,
            options.envelope.baseVolume,
          )
        : null;
      if (gainAt) applyEnvelopeToPlanes(outPlanes, sampleRate, gainAt);
      writeWav(outputWav, interleave(outPlanes), sampleRate, outPlanes.length);
      return { path: outputWav, envelopeBaked: gainAt !== null };
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
    await lease?.release().catch(() => undefined);
  }
}

export type { HfAudioFxChain, HfAutomation };
