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

import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getAudioFxRuntimeScript } from "@hyperframes/core/audio-fx-runtime";
import { enabledAudioFxNodes, type HfAudioFxChain } from "@hyperframes/core/audio-fx";
import { serializeAutomation, type HfAutomation } from "@hyperframes/core/audio-automation";
import { acquireBrowser } from "./browserManager.js";
import { createEnvelopeWalker } from "./audioVolumeEnvelope.js";
import { riffChunks, wavFormatTag } from "./wavChunks.js";
import { windowPrerollSeconds } from "./audioFxWarmup.js";
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
  /** True when the source was 32-bit float rather than 16-bit PCM. Carried so
   *  the output can be written back in the same format — see `writeWav`. */
  float: boolean;
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
  dataBody?: number;
  dataSize?: number;
} {
  const head = { format: 1, channels: 1, sampleRate: 48000, bits: 16 };
  let data: Buffer | undefined;
  let dataBody: number | undefined;
  let dataSize: number | undefined;
  for (const { id, body, size } of riffChunks(buf)) {
    if (id === "fmt ") {
      const format = wavFormatTag(buf, body, size);
      if (format === null) throw new AudioFxRenderError("Invalid or unsupported WAV format header");
      head.format = format;
      head.channels = buf.readUInt16LE(body + 2);
      head.sampleRate = buf.readUInt32LE(body + 4);
      head.bits = buf.readUInt16LE(body + 14);
    } else if (id === "data") {
      data = buf.subarray(body, body + resolveDataBytes(size, buf.length - body));
      dataBody = body;
      dataSize = size;
      // The payload is the rest of the file for anything the mixer writes, and
      // reading past it buys nothing: `fmt ` precedes `data` in every WAV these
      // steps produce, and the alternative is walking a several-hundred-megabyte
      // tail chunk by chunk.
      break;
    }
  }
  return { ...head, data, dataBody, dataSize };
}

/** Where a WAV's samples sit, read from its head alone. */
export interface WavHeader {
  format: number;
  channels: number;
  sampleRate: number;
  bits: number;
  float: boolean;
  dataOffset: number;
  dataBytes: number;
}

/** The most `readFileSync` returns in one call. */
const MAX_WHOLE_FILE_BYTES = 2 ** 31 - 1;

const HEADER_PROBE_BYTES = 64 * 1024;

/** A declared size of 0 or 0xFFFFFFFF (live-written, or past 4 GiB), or one past the end, means "to the end"; both WAV readers use it. */
export function resolveDataBytes(declared: number, availableBytes: number): number {
  return declared === 0 || declared === 0xffffffff
    ? availableBytes
    : Math.min(declared, availableBytes);
}

/** The header of `path`, or null when the head holds no readable `fmt `/`data` pair. */
export function readWavHeader(path: string): WavHeader | null {
  const fd = openSync(path, "r");
  try {
    const head = Buffer.alloc(HEADER_PROBE_BYTES);
    const read = readSync(fd, head, 0, head.length, 0);
    const buf = head.subarray(0, read);
    if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF") return null;
    const { format, channels, sampleRate, bits, dataBody, dataSize } = readWavChunks(buf);
    if (dataBody === undefined || dataSize === undefined) return null;
    const dataBytes = resolveDataBytes(dataSize, statSync(path).size - dataBody);
    return {
      format,
      channels,
      sampleRate,
      bits,
      float: format === 3 && bits === 32,
      dataOffset: dataBody,
      dataBytes,
    };
  } finally {
    closeSync(fd);
  }
}

export function readWav(path: string): WavData {
  const buf = readFileSync(path);
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF") {
    throw new AudioFxRenderError(`Not a WAV file: ${path}`);
  }
  const { format, channels, sampleRate, bits, data } = readWavChunks(buf);
  if (!data) throw new AudioFxRenderError(`WAV has no data chunk: ${path}`);
  return {
    samples: decodeSamples(data, format, bits, path),
    sampleRate,
    channels,
    float: format === 3 && bits === 32,
  };
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

function wavHeader(bytes: number, sampleRate: number, channels: number, float: boolean): Buffer {
  const bytesPerSample = float ? 4 : 2;
  const buf = Buffer.alloc(44);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(Math.min(0xffffffff, 36 + bytes), 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(float ? 3 : 1, 20); // IEEE_FLOAT / PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buf.writeUInt16LE(channels * bytesPerSample, 32);
  buf.writeUInt16LE(float ? 32 : 16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(Math.min(0xffffffff, bytes), 40);
  return buf;
}

function encodeSamples(samples: Float32Array, float: boolean): Buffer {
  const n = samples.length;
  const buf = Buffer.alloc(n * (float ? 4 : 2));
  for (let i = 0; i < n; i++) {
    if (float) {
      buf.writeFloatLE(samples[i] ?? 0, i * 4);
      continue;
    }
    // Clamp before scaling: a limiter set to 0 dB or a resonant filter can push
    // past full scale, and wrapping would turn that into a click.
    const v = Math.max(-1, Math.min(1, samples[i] ?? 0));
    buf.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  return buf;
}

/**
 * Write interleaved samples, preserving the channel count.
 *
 * 16-bit by default rather than the float32 this used to emit: the very next
 * step in the mixer bakes the volume envelope into the samples, and that baker
 * accepted only 16-bit PCM. Emitting float meant enabling any effect silently
 * downgraded a track's volume automation to the ffmpeg expression path, which is
 * capped at 32 straight segments — so a curved envelope was quantised and a
 * dense one could fall back to rendering at base volume.
 *
 * `float` opts back out, for the ONE input that needs it: a group sub-mix. Its
 * members sum at unity, so the sum can legitimately exceed full scale, and the
 * group's fader is applied downstream — clamping here handed that headroom back
 * one step before the thing that was going to reduce it, which is the same bug
 * the float intermediate exists to avoid. Safe now only because the envelope
 * baker reads float too; before that it was not.
 */
export function writeWav(
  path: string,
  samples: Float32Array,
  sampleRate: number,
  channels = 1,
  float = false,
): void {
  const body = encodeSamples(samples, float);
  const buf = Buffer.concat([wavHeader(body.length, sampleRate, channels, float), body]);
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

/** Split an interleaved buffer into one array per channel, keeping stereo width as preview does. */
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
    render(
      p: Float32Array[],
      r: number,
      c: string,
      a?: string,
      elapsed?: number,
    ): Promise<Float32Array[]>;
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
  startFrame = 0,
): void {
  const frames = planes[0]?.length ?? 0;
  for (let frame = 0; frame < frames; frame += 1) {
    const gain = gainAt((startFrame + frame) / sampleRate);
    for (const plane of planes) plane[frame] = (plane[frame] ?? 0) * gain;
  }
}

/** The clip's `data-volume`, ahead of the chain where an editor puts clip gain. */
function applyInputGain(planes: readonly Float32Array[], gain = 1): void {
  if (gain !== 1) applyEnvelopeToPlanes(planes, 1, () => gain);
}

/** Inputs over `aboveBytes` render in windows: Node reads no file past 2 GiB whole, and the page would hold it twice. */
export interface AudioFxStreamingLimits {
  aboveBytes: number;
  segmentSeconds: number;
  /** Audio rendered ahead of each window and discarded; the least, when the chain needs more. */
  prerollSeconds: number;
  /** The most pre-roll a chain's own memory can ask for. */
  maxPrerollSeconds: number;
  /** Audio rendered after each window and discarded, for look-ahead. */
  postrollSeconds: number;
}

const DEFAULT_STREAMING_LIMITS: AudioFxStreamingLimits = {
  aboveBytes: 512 * 1024 * 1024,
  segmentSeconds: 300,
  prerollSeconds: 10,
  maxPrerollSeconds: 300,
  postrollSeconds: 1,
};

export interface AudioFxSegment {
  /** The frames this window contributes to the output. */
  keepFrom: number;
  keepTo: number;
  /** The frames rendered to produce them. */
  readFrom: number;
  readTo: number;
  last: boolean;
}

/** Frames the audio graph processes at a time; a window starting on one sees the same blocks a whole render does. */
const RENDER_QUANTUM = 128;

/** Tile `totalFrames` into windows that each carry their pre/post-roll. */
export function planAudioFxSegments(
  totalFrames: number,
  sampleRate: number,
  limits: AudioFxStreamingLimits,
): AudioFxSegment[] {
  const step = Math.max(1, Math.round(limits.segmentSeconds * sampleRate));
  const pre = Math.round(limits.prerollSeconds * sampleRate);
  const post = Math.round(limits.postrollSeconds * sampleRate);
  const segments: AudioFxSegment[] = [];
  for (let keepFrom = 0; keepFrom < totalFrames; keepFrom += step) {
    const keepTo = Math.min(totalFrames, keepFrom + step);
    segments.push({
      keepFrom,
      keepTo,
      readFrom: Math.max(0, Math.floor((keepFrom - pre) / RENDER_QUANTUM) * RENDER_QUANTUM),
      readTo: Math.min(totalFrames, keepTo + post),
      last: keepTo === totalFrames,
    });
  }
  return segments;
}

function readFrames(fd: number, header: WavHeader, from: number, to: number): Float32Array {
  const frameBytes = (header.channels * header.bits) / 8;
  const data = Buffer.alloc((to - from) * frameBytes);
  for (let filled = 0; filled < data.length; ) {
    const n = readSync(
      fd,
      data,
      filled,
      data.length - filled,
      header.dataOffset + from * frameBytes + filled,
    );
    if (n === 0) break;
    filled += n;
  }
  return decodeSamples(data, header.format, header.bits, "streamed input");
}

/** A chain remembers longer than the floor: size the pre-roll to its slowest state, up to the cap. */
function chainPrerollSeconds(
  chain: HfAudioFxChain,
  limits: AudioFxStreamingLimits,
  trackId: string,
): number {
  const { seconds, capped } = windowPrerollSeconds(
    chain,
    limits.prerollSeconds,
    limits.maxPrerollSeconds,
  );
  if (capped) {
    console.warn(
      `Audio FX for track ${trackId}: the chain remembers longer than the ${limits.maxPrerollSeconds}s pre-roll cap, so its oldest repeats are cut at window seams`,
    );
  }
  return seconds;
}

async function renderInSegments(
  openPage: () => Promise<FxPage>,
  inputWav: string,
  header: WavHeader,
  chain: HfAudioFxChain,
  outputWav: string,
  options: {
    trackId: string;
    signal?: AbortSignal;
    envelope?: AudioFxEnvelope;
    inputGain?: number;
  },
  limits: AudioFxStreamingLimits,
): Promise<boolean> {
  const { sampleRate, channels, float } = header;
  const totalFrames = Math.floor(header.dataBytes / ((channels * header.bits) / 8));
  const gainAt = envelopeWalkerFor(options.envelope);
  const prerollSeconds = chainPrerollSeconds(chain, limits, options.trackId);
  const inFd = openSync(inputWav, "r");
  let outFd: number | undefined;
  try {
    // Same directory rule as writeWav: the caller's mkdtemp work dir.
    outFd = openSync(outputWav, "w");
    writeSync(outFd, wavHeader(0, sampleRate, channels, float));
    let written = 0;
    for (const seg of planAudioFxSegments(totalFrames, sampleRate, {
      ...limits,
      prerollSeconds,
    })) {
      if (options.signal?.aborted) {
        throw new AudioFxRenderError(`Audio FX cancelled for track ${options.trackId}`);
      }
      const planes = deinterleave(readFrames(inFd, header, seg.readFrom, seg.readTo), channels);
      applyInputGain(planes, options.inputGain);
      // A fresh page per window, so the browser never holds more than one window of audio.
      const page = await openPage();
      let outPlanes: Float32Array[];
      try {
        await sendPlanesToPage(page, planes);
        outPlanes = await readPlanesFromPage(
          page,
          await renderPlanesInPage(page, sampleRate, chain, "", seg.readFrom / sampleRate),
        );
      } finally {
        await page.close().catch(() => undefined);
      }
      const rendered = outPlanes[0]?.length ?? 0;
      if (rendered === 0) {
        throw new AudioFxRenderError(`Audio FX produced no samples for track ${options.trackId}`);
      }
      // The last window keeps the chain's tail (reverb, delay), as a whole-file render does.
      const skip = seg.keepFrom - seg.readFrom;
      const kept = outPlanes.map((plane) =>
        plane.subarray(skip, seg.last ? rendered : seg.keepTo - seg.readFrom),
      );
      if (gainAt) applyEnvelopeToPlanes(kept, sampleRate, gainAt, seg.keepFrom);
      const bytes = encodeSamples(interleave(kept), float);
      writeFileSync(outFd, bytes);
      written += bytes.length;
    }
    writeSync(outFd, wavHeader(written, sampleRate, channels, float), 0, 44, 0);
  } finally {
    closeSync(inFd);
    if (outFd !== undefined) closeSync(outFd);
  }
  return gainAt !== null;
}

type AudioFxEnvelope = {
  keyframes: AudioVolumeKeyframe[];
  trackStart: number;
  baseVolume: number;
};

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
    envelope?: AudioFxEnvelope;
    inputGain?: number;
    streaming?: Partial<AudioFxStreamingLimits>;
  },
): Promise<{ path: string; envelopeBaked: boolean }> {
  if (enabledAudioFxNodes(chain).length === 0) return { path: inputWav, envelopeBaked: false };
  if (!existsSync(inputWav)) {
    throw new AudioFxRenderError(`Audio FX input is missing: ${inputWav}`);
  }

  // Automation is clocked from the file's own start, so a windowed render leaves it to the whole path.
  const limits = { ...DEFAULT_STREAMING_LIMITS, ...options.streaming };
  const header = options.automation ? null : readWavHeader(inputWav);
  const streamed = header !== null && header.dataBytes > limits.aboveBytes;

  if (streamed) {
    return withFxBrowser(options, async (openPage) => ({
      path: outputWav,
      envelopeBaked: await renderInSegments(
        openPage,
        inputWav,
        header,
        chain,
        outputWav,
        options,
        limits,
      ),
    }));
  }

  if (statSync(inputWav).size > MAX_WHOLE_FILE_BYTES) {
    const why = options.automation
      ? "parameter automation is not supported on inputs over 2 GiB"
      : "the WAV header of an input over 2 GiB could not be read";
    throw new AudioFxRenderError(`Audio FX for track ${options.trackId}: ${why} (${inputWav})`);
  }
  const input = readWav(inputWav);
  const planes = deinterleave(input.samples, input.channels);
  applyInputGain(planes, options.inputGain);
  // An empty track has nothing to process — and an OfflineAudioContext of zero
  // length throws, which is fatal for the WHOLE render rather than this track:
  // the error travels past the mixer's per-track failure collector. ffmpeg
  // writes an empty but structurally valid WAV whenever a clip's trim starts
  // past the end of its source, so one mis-set `data-media-start` used to take
  // the render down. Guarded here as well as in the runtime so an empty track
  // never costs a browser.
  if ((planes[0]?.length ?? 0) === 0) return { path: inputWav, envelopeBaked: false };

  return withFxBrowser(options, async (openPage) => {
    const page = await openPage();
    try {
      await sendPlanesToPage(page, planes);
      const outLengths = await renderPlanesInPage(
        page,
        input.sampleRate,
        chain,
        options.automation ? serializeAutomation(options.automation) : "",
      );
      const outPlanes = await readPlanesFromPage(page, outLengths);
      if (outPlanes.length === 0 || (outPlanes[0]?.length ?? 0) === 0) {
        throw new AudioFxRenderError(`Audio FX produced no samples for track ${options.trackId}`);
      }
      // Null when the keyframes normalise away to nothing — then the mixer's
      // own paths still own this track's gain, so say so rather than claiming
      // a bake that never happened.
      const gainAt = envelopeWalkerFor(options.envelope);
      if (gainAt) applyEnvelopeToPlanes(outPlanes, input.sampleRate, gainAt);
      // Same format in as out: a float input is a group sub-mix whose headroom
      // must survive to its fader (see writeWav).
      writeWav(outputWav, interleave(outPlanes), input.sampleRate, outPlanes.length, input.float);
      return { path: outputWav, envelopeBaked: gainAt !== null };
    } finally {
      await page.close().catch(() => undefined);
    }
  });
}

/** Run `body` with a leased browser and a way to open pages on the runtime; both are released in the same try that takes them. */
async function withFxBrowser<T>(
  options: { trackId: string; signal?: AbortSignal },
  body: (openPage: () => Promise<FxPage>) => Promise<T>,
): Promise<T> {
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
    const { browser } = lease;
    return await body(() => openFxPage(browser, hostDir));
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

/** The page handle `acquireBrowser().browser.newPage()` returns. */
type FxPage = Awaited<ReturnType<Awaited<ReturnType<typeof acquireBrowser>>["browser"]["newPage"]>>;

async function openFxPage(
  browser: Awaited<ReturnType<typeof acquireBrowser>>["browser"],
  hostDir: string,
): Promise<FxPage> {
  const page = await browser.newPage();
  try {
    // AudioWorklet is only exposed in a secure context, and about:blank is
    // not one — the module would fail with an opaque error. A file:// page
    // qualifies and needs no listening socket.
    const hostPage = join(hostDir, "audio-fx.html");
    writeFileSync(hostPage, "<!doctype html><meta charset=utf-8><title>audio fx</title>");
    await page.goto(pathToFileURL(hostPage).href, {
      waitUntil: "domcontentloaded",
    });
    await page.addScriptTag({ content: getAudioFxRuntimeScript() });
    return page;
  } catch (err) {
    await page.close().catch(() => undefined);
    throw err;
  }
}

/**
 * Hand the input planes to the page a chunk at a time.
 *
 * The chunks stay separate byte arrays page-side rather than being concatenated
 * into one string, so neither the CDP frame cap nor V8's string limit ever sees
 * the whole track.
 */
async function sendPlanesToPage(page: FxPage, planes: readonly Float32Array[]): Promise<void> {
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
}

/** Run the chain in the page and return each output plane's sample count. The
 *  samples themselves stay page-side until `readPlanesFromPage` pulls them. */
async function renderPlanesInPage(
  page: FxPage,
  sampleRate: number,
  chain: HfAudioFxChain,
  automationJson: string,
  elapsed = 0,
): Promise<number[]> {
  return (await page.evaluate(
    async ([rate, chainJson, automation, at]: [number, string, string, number]) => {
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
      // Dropped before the render allocates its own buffers, so the page does
      // not hold two copies of the track at once.
      io.in = [];
      io.out = await w.__HF_AUDIO_FX.render(inPlanes, rate, chainJson, automation || undefined, at);
      return io.out.map((plane) => plane.length);
    },
    [sampleRate, JSON.stringify(chain), automationJson, elapsed] as [
      number,
      string,
      string,
      number,
    ],
  )) as number[];
}

/** Pull one output plane back over CDP, `TRANSFER_BYTES` at a time. */
async function readPlaneFromPage(
  page: FxPage,
  index: number,
  byteLength: number,
): Promise<Float32Array> {
  const parts: Buffer[] = [];
  for (let at = 0; at < byteLength; at += TRANSFER_BYTES) {
    const b64 = (await page.evaluate(
      ([plane_index, offset, limit]: [number, number, number]) => {
        const plane = (window as unknown as AudioFxWindow).__HF_FX_IO?.out[plane_index];
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
          s += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK) as unknown as number[]);
        }
        return btoa(s);
      },
      [index, at, TRANSFER_BYTES] as [number, number, number],
    )) as string;
    parts.push(Buffer.from(b64, "base64"));
  }
  // byteOffset and byteLength matter: Node pools small allocations, so a short
  // payload decodes into an 8 KiB pool and a view over the whole ArrayBuffer
  // would read kilobytes of unrelated memory at the wrong length.
  const buf = Buffer.concat(parts);
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

async function readPlanesFromPage(page: FxPage, outLengths: number[]): Promise<Float32Array[]> {
  const outPlanes: Float32Array[] = [];
  for (let p = 0; p < outLengths.length; p += 1) {
    outPlanes.push(await readPlaneFromPage(page, p, (outLengths[p] ?? 0) * 4));
  }
  return outPlanes;
}

/** The envelope walker for a track that has keyframes, or null when it has none. */
function envelopeWalkerFor(
  envelope:
    | {
        keyframes: AudioVolumeKeyframe[];
        trackStart: number;
        baseVolume: number;
      }
    | undefined,
): ReturnType<typeof createEnvelopeWalker> | null {
  if (!envelope) return null;
  return createEnvelopeWalker(envelope.keyframes, envelope.trackStart, envelope.baseVolume);
}

export type { HfAudioFxChain, HfAutomation };
