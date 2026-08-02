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
export function readWav(path: string): WavData {
  const buf = readFileSync(path);
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF") {
    throw new AudioFxRenderError(`Not a WAV file: ${path}`);
  }
  let offset = 12;
  let format = 1;
  let channels = 1;
  let sampleRate = 48000;
  let bits = 16;
  let data: Buffer | undefined;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      format = buf.readUInt16LE(offset + 8);
      channels = buf.readUInt16LE(offset + 10);
      sampleRate = buf.readUInt32LE(offset + 12);
      bits = buf.readUInt16LE(offset + 22);
    } else if (id === "data") {
      data = buf.subarray(offset + 8, Math.min(buf.length, offset + 8 + size));
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (!data) throw new AudioFxRenderError(`WAV has no data chunk: ${path}`);

  let samples: Float32Array;
  if (format === 3 && bits === 32) {
    samples = new Float32Array(data.buffer, data.byteOffset, Math.floor(data.length / 4));
  } else if (format === 1 && bits === 16) {
    const n = Math.floor(data.length / 2);
    samples = new Float32Array(n);
    for (let i = 0; i < n; i++) samples[i] = data.readInt16LE(i * 2) / 32768;
  } else {
    throw new AudioFxRenderError(`Unsupported WAV format ${format}/${bits}-bit: ${path}`);
  }
  return { samples, sampleRate, channels };
}

export function writeWav(path: string, samples: Float32Array, sampleRate: number): void {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(3, 20); // IEEE float
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(32, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(n * 4, 40);
  Buffer.from(samples.buffer, samples.byteOffset, n * 4).copy(buf, 44);
  writeFileSync(path, buf);
}

/**
 * Mix a multi-channel interleaved buffer down to mono. The FX graph is mono —
 * the mixer lays tracks out and handles stereo placement downstream — so a
 * stereo source is folded rather than having one channel silently dropped.
 */
function toMono(samples: Float32Array, channels: number): Float32Array {
  if (channels <= 1) return samples;
  const frames = Math.floor(samples.length / channels);
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += samples[i * channels + c] ?? 0;
    out[i] = sum / channels;
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
  options: { trackId: string; signal?: AbortSignal; automation?: HfAutomation },
): Promise<string> {
  if (enabledAudioFxNodes(chain).length === 0) return inputWav;
  if (!existsSync(inputWav)) {
    throw new AudioFxRenderError(`Audio FX input is missing: ${inputWav}`);
  }

  const { samples, sampleRate, channels } = readWav(inputWav);
  const mono = toMono(samples, channels);

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
        async ([b64, rate, chainJson, automationJson]: [string, number, string, string]) => {
          const bin = atob(b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const pcm = new Float32Array(bytes.buffer);
          const api = (
            window as unknown as {
              __HF_AUDIO_FX?: {
                render(p: Float32Array, r: number, c: string, a?: string): Promise<Float32Array>;
              };
            }
          ).__HF_AUDIO_FX;
          if (!api) throw new Error("audio FX runtime failed to load");
          const out = await api.render(pcm, rate, chainJson, automationJson || undefined);
          const u8 = new Uint8Array(out.buffer, out.byteOffset, out.length * 4);
          let s = "";
          const CHUNK = 0x8000;
          for (let i = 0; i < u8.length; i += CHUNK) {
            s += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + CHUNK)));
          }
          return btoa(s);
        },
        [
          Buffer.from(mono.buffer, mono.byteOffset, mono.length * 4).toString("base64"),
          sampleRate,
          JSON.stringify(chain),
          options.automation ? serializeAutomation(options.automation) : "",
        ] as [string, number, string, string],
      )) as string;

      const out = new Float32Array(Buffer.from(rendered, "base64").buffer);
      if (out.length === 0) {
        throw new AudioFxRenderError(`Audio FX produced no samples for track ${options.trackId}`);
      }
      writeWav(outputWav, out, sampleRate);
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

export type { HfAudioFxChain, HfAutomation };
