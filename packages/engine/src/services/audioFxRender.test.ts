import { execFileSync, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyVolumeEnvelopeToWav } from "./audioVolumeEnvelope.js";
import { defaultAudioFxParams, type HfAudioFxChain } from "@hyperframes/core/audio-fx";
import {
  applyAudioFxChain,
  AudioFxRenderError,
  planAudioFxSegments,
  readWav,
  readWavHeader,
  resolveDataBytes,
  writeWav,
} from "./audioFxRender.js";
import {
  MIXED_AUDIO_FILENAME,
  parseAudioElements,
  parseMasterFxChain,
  processCompositionAudio,
} from "./audioMixer.js";
import { resolveHeadlessShellPath } from "./browserManager.js";
import { getFfmpegBinary } from "../utils/ffmpegBinaries.js";

const wholeFileReads = vi.hoisted(() => ({ paths: [] as string[] }));
const openedFds = vi.hoisted(() => ({
  log: [] as { path: string; fd: number; closed: boolean }[],
}));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const readFileSync = ((path: Parameters<typeof actual.readFileSync>[0], ...rest: unknown[]) => {
    wholeFileReads.paths.push(String(path));
    return (actual.readFileSync as (...a: unknown[]) => unknown)(path, ...rest);
  }) as typeof actual.readFileSync;
  const openSync = ((path: Parameters<typeof actual.openSync>[0], ...rest: unknown[]) => {
    const fd = (actual.openSync as (...a: unknown[]) => number)(path, ...rest);
    openedFds.log.push({ path: String(path), fd, closed: false });
    return fd;
  }) as typeof actual.openSync;
  const closeSync = ((fd: number) => {
    const open = openedFds.log.findLast((entry) => entry.fd === fd && !entry.closed);
    if (open) open.closed = true;
    return actual.closeSync(fd);
  }) as typeof actual.closeSync;
  return { ...actual, readFileSync, openSync, closeSync };
});

/** Same probe the ffmpeg-dependent suites use: ask the binary, don't assume it. */
const HAS_FFMPEG = spawnSync(getFfmpegBinary(), ["-version"], { encoding: "utf-8" }).status === 0;

/**
 * Whether a Chrome is actually on this machine, asked the same way the render
 * asks — `resolveHeadlessShellPath` is what `acquireBrowser` resolves through,
 * so this cannot drift from the thing it is guarding the way a hard-coded cache
 * path would.
 *
 * The repo's `Test` job installs ffmpeg and no browser, on purpose. Without
 * this guard the four browser cases below fail there with a spawn error that
 * says nothing about the code under test, and the same pattern already covers
 * the ffmpeg-dependent suites (`describe.skipIf(!HAS_FFMPEG)`).
 *
 * They still run wherever a browser exists — every developer machine, and any
 * job that has run `hyperframes browser ensure`.
 */
const HAS_BROWSER = ((): boolean => {
  try {
    const path = resolveHeadlessShellPath();
    if (!path) return false;
    // ASK the binary rather than trusting that the file is there. CI carries a
    // chrome-headless-shell in its cache that resolves and then fails to spawn
    // — a partial download is indistinguishable from a working one by
    // existsSync, and the first version of this guard was fooled by exactly
    // that. Same probe the ffmpeg suites use.
    return spawnSync(path, ["--version"], { encoding: "utf-8" }).status === 0;
  } catch {
    // An explicitly-configured path that does not exist throws. That is a
    // broken environment rather than an absent browser, but either way these
    // cases cannot run.
    return false;
  }
})();

const SR = 48000;

const chainOf = (...types: string[]): HfAudioFxChain => ({
  version: 1,
  nodes: types.map((t) => ({
    type: t,
    enabled: true,
    params: defaultAudioFxParams(t),
  })),
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hf-audiofx-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A 440 Hz tone written as float WAV, the shape the mixer hands us. */
function tone(path: string, seconds = 0.3, freq = 440): void {
  const n = Math.floor(SR * seconds);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = 0.5 * Math.sin((2 * Math.PI * freq * i) / SR);
  writeWav(path, s, SR);
}

/** RMS of one slice, for comparing how loud a moment is against another. */
const sliceRms = (s: Float32Array, from: number, to: number): number => {
  const a = Math.max(0, Math.floor(from * SR));
  const b = Math.min(s.length, Math.floor(to * SR));
  let sum = 0;
  for (let i = a; i < b; i++) sum += (s[i] ?? 0) * (s[i] ?? 0);
  return Math.sqrt(sum / Math.max(1, b - a));
};

const rms = (s: Float32Array): number =>
  Math.sqrt(s.reduce((a, x) => a + x * x, 0) / Math.max(1, s.length));
const db = (x: number): number => 20 * Math.log10(x + 1e-30);

/**
 * Rising zero-crossings per second, over `[from, to)` seconds.
 *
 * `to` matters as much as `from`: a chain with a tail (reverb, delay,
 * pitchshift) renders extra silence/decay past the input's own end, and
 * averaging crossings over that stretch too dilutes the estimate toward zero
 * — measure only the steady, driven portion.
 */
function estimateFreq(s: Float32Array, sampleRate: number, from = 0.05, to?: number): number {
  const start = Math.round(from * sampleRate);
  const end = to === undefined ? s.length : Math.min(s.length, Math.round(to * sampleRate));
  let crossings = 0;
  for (let i = start + 1; i < end; i++) {
    if ((s[i - 1] ?? 0) < 0 && (s[i] ?? 0) >= 0) crossings++;
  }
  return crossings / ((end - start) / sampleRate);
}

describe("readWav / writeWav", () => {
  it("round-trips samples as 16-bit PCM, the format the volume bake requires", () => {
    const p = join(dir, "rt.wav");
    const src = new Float32Array([0, 0.5, -0.5, 0.25]);
    writeWav(p, src, SR);
    const back = readWav(p);
    expect(back.sampleRate).toBe(SR);
    expect(back.channels).toBe(1);
    // Quantised, not bit-exact: one 16-bit step is the tolerance.
    for (let i = 0; i < src.length; i++) {
      expect(back.samples[i]).toBeCloseTo(src[i] as number, 4);
    }
  });

  it("preserves the channel count, interleaved", () => {
    // Folding to mono collapsed a stereo bed's width for the render only.
    const p = join(dir, "stereo.wav");
    writeWav(p, new Float32Array([0.5, -0.5, 0.25, -0.25]), SR, 2);
    const back = readWav(p);
    expect(back.channels).toBe(2);
    expect(back.samples.length).toBe(4);
    expect(back.samples[0]).toBeCloseTo(0.5, 4);
    expect(back.samples[1]).toBeCloseTo(-0.5, 4);
  });

  it("writes a file the volume envelope baker will accept", () => {
    // This is why the writer emits 16-bit: the mixer bakes the envelope into the
    // samples immediately after, and that baker refuses anything else — so float
    // output silently downgraded a track to the 32-segment ffmpeg path.
    const p = join(dir, "bakeable.wav");
    writeWav(p, new Float32Array(4800).fill(0.5), SR);
    const baked = applyVolumeEnvelopeToWav(
      p,
      [
        { time: 0, volume: 1 },
        { time: 0.1, volume: 0 },
      ],
      0,
      1,
    );
    expect(baked).toBe(true);
    const after = readWav(p);
    // Faded within the clip: the tail is quieter than the head.
    expect(Math.abs(after.samples[4700] as number)).toBeLessThan(
      Math.abs(after.samples[10] as number),
    );
  });

  it("clamps past full scale rather than wrapping it into a click", () => {
    const p = join(dir, "hot.wav");
    writeWav(p, new Float32Array([1.8, -1.8]), SR);
    const back = readWav(p);
    expect(back.samples[0]).toBeCloseTo(1, 3);
    expect(back.samples[1]).toBeCloseTo(-1, 3);
  });

  // Needs a real ffmpeg to author the 16-bit fixture. The Test job installs one,
  // but a bare "ffmpeg" is not on PATH there — hence getFfmpegBinary above — and
  // a contributor without it should skip rather than fail.
  it.skipIf(!HAS_FFMPEG)("reads 16-bit PCM, which the trim step can emit", () => {
    const p = join(dir, "pcm16.wav");
    execFileSync(getFfmpegBinary(), [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=440:duration=0.1:sample_rate=${SR}`,
      "-c:a",
      "pcm_s16le",
      "-ac",
      "1",
      p,
      "-y",
    ]);
    const back = readWav(p);
    expect(back.sampleRate).toBe(SR);
    expect(back.samples.length).toBeGreaterThan(0);
    // 16-bit values must be scaled into the float range, not left as integers.
    expect(Math.max(...Array.from(back.samples, Math.abs))).toBeLessThanOrEqual(1);
  });

  it("refuses a file it cannot read rather than returning noise", () => {
    const p = join(dir, "junk.wav");
    writeFileSync(p, Buffer.from("not a wav at all"));
    expect(() => readWav(p)).toThrow(AudioFxRenderError);
  });
});

describe("applyAudioFxChain", () => {
  it("returns the input untouched when nothing is enabled", async () => {
    const input = join(dir, "in.wav");
    tone(input);
    const out = await applyAudioFxChain(
      input,
      { version: 1, nodes: [{ type: "peaking", enabled: false }] },
      join(dir, "out.wav"),
      { trackId: "t" },
    );
    expect(out).toEqual({ path: input, envelopeBaked: false });
    expect(existsSync(join(dir, "out.wav"))).toBe(false);
  });

  it("throws when there is work to do but the input is missing", async () => {
    await expect(
      applyAudioFxChain(join(dir, "nope.wav"), chainOf("peaking"), join(dir, "out.wav"), {
        trackId: "t",
      }),
    ).rejects.toThrow(/input is missing/);
  });
});

/**
 * These drive a real headless browser, which is the point: the render path is
 * an OfflineAudioContext running the same graph the studio previews with. They
 * are the only place that proves the injected runtime loads and processes
 * audio, so they are worth the seconds they cost.
 */
describe.skipIf(!HAS_BROWSER)("browser render", () => {
  it("notches out the tone it is tuned to", async () => {
    const input = join(dir, "in.wav");
    tone(input);
    const outPath = join(dir, "out.wav");
    const result = await applyAudioFxChain(
      input,
      {
        version: 1,
        nodes: [
          {
            type: "peaking",
            enabled: true,
            params: { frequency: 440, gain: -30, q: 1 },
          },
        ],
      },
      outPath,
      { trackId: "t" },
    );
    expect(result).toEqual({ path: outPath, envelopeBaked: false });
    const before = readWav(input).samples;
    const after = readWav(outPath).samples;
    expect(after.length).toBe(before.length);
    expect(db(rms(after))).toBeLessThan(db(rms(before)) - 15);
  }, 180_000);

  it("runs a worklet-backed effect, not just the native nodes", async () => {
    // The dynamics processors are AudioWorklets; if the module fails to load in
    // the render context, this is where it surfaces.
    const input = join(dir, "in.wav");
    tone(input, 0.3, 200);
    const outPath = join(dir, "out.wav");
    await applyAudioFxChain(
      input,
      {
        version: 1,
        nodes: [
          {
            type: "compressor",
            enabled: true,
            params: {
              ...defaultAudioFxParams("compressor"),
              threshold: -40,
              ratio: 20,
            },
          },
        ],
      },
      outPath,
      { trackId: "t" },
    );
    expect(db(rms(readWav(outPath).samples))).toBeLessThan(db(rms(readWav(input).samples)) - 3);
  }, 180_000);

  it("applies clip gain ahead of the chain, so a compressor sees it", async () => {
    const input = join(dir, "in.wav");
    tone(input, 0.5, 200);
    const chain: HfAudioFxChain = {
      version: 1,
      nodes: [
        {
          type: "compressor",
          enabled: true,
          params: { ...defaultAudioFxParams("compressor"), threshold: -40, ratio: 20 },
        },
      ],
    };
    const levelAt = async (inputGain: number): Promise<number> => {
      const outPath = join(dir, `gain-${inputGain}.wav`);
      await applyAudioFxChain(input, chain, outPath, { trackId: "t", inputGain });
      return db(rms(readWav(outPath).samples));
    };
    // After the chain, a quarter gain would land exactly 12.04 dB down; ahead of
    // it, the compressor takes most of that back.
    const drop = (await levelAt(1)) - (await levelAt(0.25));
    expect(drop).toBeGreaterThan(0);
    expect(drop).toBeLessThan(6);
  }, 180_000);

  it("shifts pitch up an octave, matching the preview worklet", async () => {
    const input = join(dir, "in.wav");
    tone(input, 0.5, 220);
    const outPath = join(dir, "out.wav");
    await applyAudioFxChain(
      input,
      {
        version: 1,
        nodes: [
          {
            type: "pitchshift",
            enabled: true,
            params: {
              ...defaultAudioFxParams("pitchshift"),
              semitones: 12,
              mix: 1,
            },
          },
        ],
      },
      outPath,
      { trackId: "t" },
    );
    // Measure only the driven portion — chainTailSeconds appends ~0.2s of
    // decaying tail past the clip's own 0.5s, and averaging crossings over
    // that too dilutes the estimate.
    const freq = estimateFreq(readWav(outPath).samples, SR, 0.05, 0.45);
    expect(freq).toBeGreaterThan(220 * 1.7);
    expect(freq).toBeLessThan(220 * 2.3);
  }, 180_000);

  it("holds a true peak under the ceiling and trims its own lookahead", async () => {
    // fs/4 at 45 degrees: samples of +-0.707 whose waveform reaches 1.0. Preceded
    // by a quiet impulse so the output position proves the latency was trimmed.
    const input = join(dir, "isp-in.wav");
    const n = Math.floor(SR * 0.4);
    const samples = new Float32Array(n);
    samples[100] = 0.1;
    for (let i = 4800; i < n; i++) samples[i] = Math.sin((Math.PI / 2) * i + Math.PI / 4);
    writeWav(input, samples, SR, 1, true);
    const outPath = join(dir, "isp-out.wav");
    const ceiling = -6;
    await applyAudioFxChain(
      input,
      {
        version: 1,
        nodes: [
          {
            type: "truepeak",
            id: "n1",
            enabled: true,
            params: { ceiling, lookahead: 3, release: 80 },
          },
        ],
      },
      outPath,
      { trackId: "t" },
    );
    const out = readWav(outPath).samples;
    expect(out.length).toBe(n);
    expect(out[100]).toBeCloseTo(0.1, 3);
    // Sample peak of the steady part is 0.707 * gain; the gain that holds the
    // 1.0 true peak at -6 dBTP leaves it at -9 dBFS.
    let peak = 0;
    for (let i = 9600; i < n; i++) peak = Math.max(peak, Math.abs(out[i] ?? 0));
    expect(db(peak)).toBeCloseTo(-9.03, 0);
  }, 180_000);

  it("sweeps a filter across the clip when a lane automates it", async () => {
    // A 2 kHz tone under a lowpass whose cutoff rises from below it to well
    // above: the start should be attenuated and the end should not. This is
    // the whole point of the render path — the envelope has to be *scheduled*
    // offline, not merely parsed.
    const input = join(dir, "sweep-in.wav");
    tone(input, 1.5, 2000);
    const outPath = join(dir, "sweep-out.wav");
    await applyAudioFxChain(
      input,
      {
        version: 1,
        nodes: [
          {
            type: "lowpass",
            id: "n1",
            enabled: true,
            params: { frequency: 300, q: 0.707 },
          },
        ],
      },
      outPath,
      {
        trackId: "t",
        automation: {
          version: 1,
          lanes: [
            {
              target: "fx.n1.frequency",
              points: [
                { t: 0, v: 300 },
                { t: 1.5, v: 16000 },
              ],
            },
          ],
        },
      },
    );
    const after = readWav(outPath).samples;
    const head = db(sliceRms(after, 0.05, 0.25));
    const tail = db(sliceRms(after, 1.2, 1.45));
    // Opening the filter past the tone has to leave it far louder than when
    // the cutoff sat an octave and a half below it.
    expect(tail).toBeGreaterThan(head + 15);
  }, 180_000);

  it("ducks a hot chain before quantising it, not after", async () => {
    // A +6 dB peaking band on a 0.9 tone leaves the chain output around 1.8 —
    // well past full scale — and the volume lane immediately halves it. Baking
    // the envelope into the float samples lands that at ~0.9 intact. Letting
    // writeWav clamp first and ducking the file afterwards lands at ~0.5 with
    // the tops sheared off: distortion the render bakes in and preview, which
    // is float all the way through, never has.
    //
    // Stereo with a step partway through, so the same run also proves the
    // envelope is walked per frame across all channels rather than per channel:
    // one walker restarted for a second plane would hand it the tail gain for
    // its whole length.
    const input = join(dir, "hot-in.wav");
    const frames = Math.floor(SR * 0.3);
    const s = new Float32Array(frames * 2);
    for (let i = 0; i < frames; i++) {
      const v = 0.9 * Math.sin((2 * Math.PI * 440 * i) / SR);
      s[i * 2] = v;
      s[i * 2 + 1] = v;
    }
    writeWav(input, s, SR, 2);

    const outPath = join(dir, "hot-out.wav");
    const result = await applyAudioFxChain(
      input,
      {
        version: 1,
        nodes: [
          {
            type: "peaking",
            enabled: true,
            params: { frequency: 440, gain: 6, q: 1 },
          },
        ],
      },
      outPath,
      {
        trackId: "t",
        envelope: {
          // 0.5 for the first 150 ms, then 0.25 — the step is a segment
          // advance, which is what the walker's cursor exists for.
          keyframes: [
            { time: 0, volume: 0.5 },
            { time: 0.15, volume: 0.5 },
            { time: 0.1501, volume: 0.25 },
            { time: 0.3, volume: 0.25 },
          ],
          trackStart: 0,
          baseVolume: 1,
        },
      },
    );
    expect(result.envelopeBaked).toBe(true);

    const out = readWav(outPath);
    expect(out.channels).toBe(2);
    const channel = (c: number): Float32Array =>
      Float32Array.from({ length: frames }, (_, i) => out.samples[i * 2 + c] ?? 0);
    const window = (s: Float32Array, from: number, to: number): Float32Array =>
      s.slice(Math.floor(from * SR), Math.floor(to * SR));

    for (const c of [0, 1]) {
      const plane = channel(c);
      // Past the filter's settling transient, before the step.
      const loud = window(plane, 0.1, 0.14);
      const peak = Math.max(...Array.from(loud, Math.abs));
      // ~0.9. Clamped-then-ducked gives 0.5; a dropped envelope gives 1.0; a
      // walker restarted per plane gives channel 1 the 0.25 tail gain.
      expect(peak).toBeGreaterThan(0.8);
      expect(peak).toBeLessThan(0.95);
      // And still a sine, not a squared-off one: clipping 1.8 down to 1.0 pulls
      // the crest factor from 1.41 towards 1.15.
      expect(peak / rms(loud)).toBeGreaterThan(1.35);
      // The step landed, so the envelope was sampled over time, not once.
      const quiet = window(plane, 0.2, 0.29);
      expect(Math.max(...Array.from(quiet, Math.abs))).toBeCloseTo(peak / 2, 1);
    }
  }, 180_000);

  it("round-trips a track larger than one transfer chunk", async () => {
    // The PCM used to cross in a single evaluate pair, so a stereo track past
    // ~8.7 minutes blew puppeteer's 256 MB frame cap and failed the render.
    // It now goes a chunk at a time; this clip is 45 s stereo, so each plane
    // spans two chunks and the seam is inside the audio rather than at its end.
    //
    // A ramp, not a tone: every sample is a unique position marker, so a chunk
    // dropped, reordered or over-read shows up as a value at the wrong place
    // instead of hiding inside a periodic signal.
    const input = join(dir, "long-in.wav");
    const frames = SR * 45;
    const at = (i: number): number => -0.9 + (1.8 * i) / (frames - 1);
    const s = new Float32Array(frames * 2);
    for (let i = 0; i < frames; i++) {
      s[i * 2] = at(i);
      s[i * 2 + 1] = -at(i);
    }
    writeWav(input, s, SR, 2);

    const outPath = join(dir, "long-out.wav");
    await applyAudioFxChain(
      input,
      // Transparent: a peaking band at 0 dB is unity, so the output is the
      // input and any difference is the transfer's doing.
      {
        version: 1,
        nodes: [
          {
            type: "peaking",
            enabled: true,
            params: { frequency: 1000, gain: 0, q: 1 },
          },
        ],
      },
      outPath,
      { trackId: "t" },
    );

    const out = readWav(outPath);
    expect(out.channels).toBe(2);
    // A dropped tail chunk shows up here first.
    expect(out.samples.length).toBe(frames * 2);

    // Probe across the whole clip and tightly around the 8 MiB seam.
    const seam = (8 * 1024 * 1024) / 4;
    const probes = [
      ...Array.from({ length: 60 }, (_, k) => Math.floor((k * (frames - 1)) / 59)),
      ...[-2, -1, 0, 1, 2].map((d) => seam + d),
    ].filter((i) => i >= 0 && i < frames);
    for (const i of probes) {
      // Two 16-bit steps of tolerance: the input was quantised on the way in
      // and the output again on the way out.
      expect(out.samples[i * 2]).toBeCloseTo(at(i), 3);
      expect(out.samples[i * 2 + 1]).toBeCloseTo(-at(i), 3);
    }

    // The ramp only ever rises, so this reads every sample and fails on a
    // chunk reordered, duplicated or over-read anywhere in the file — not just
    // at the points probed above.
    let breaks = 0;
    for (let i = 1; i < frames; i++) {
      if ((out.samples[i * 2] ?? 0) < (out.samples[(i - 1) * 2] ?? 0)) breaks += 1;
    }
    expect(breaks).toBe(0);
  }, 180_000);

  it("renders a multi-effect chain including reverb", async () => {
    const input = join(dir, "in.wav");
    tone(input);
    const outPath = join(dir, "out.wav");
    await applyAudioFxChain(input, chainOf("highpass", "reverb", "delay"), outPath, {
      trackId: "t",
    });
    expect(readWav(outPath).samples.length).toBeGreaterThan(0);
  }, 180_000);
});

/**
 * ffmpeg exits 0 and writes a structurally valid but EMPTY wav whenever a
 * clip's trim starts past the end of its source (`-ss 10 -t 5` on a 2 s file).
 * That track used to reach `new OfflineAudioContext(ch, 0, rate)`, which throws
 * — and the error travels past the mixer's per-track failure collector, so one
 * mis-set `data-media-start` took the whole render down.
 */
describe("an empty track", () => {
  it("is handed back untouched rather than failing the render", async () => {
    const input = join(dir, "empty.wav");
    writeWav(input, new Float32Array(0), SR);
    const output = join(dir, "out.wav");

    // Returns the input path, the same contract as a chain with nothing enabled
    // — and without paying for a browser to decide it.
    await expect(
      applyAudioFxChain(input, chainOf("peaking"), output, { trackId: "t" }),
    ).resolves.toEqual({ path: input, envelopeBaked: false });
    expect(existsSync(output)).toBe(false);
  });
});

/** Highest sample level of a file in dBFS, as ffmpeg's volumedetect reports it. */
function maxVolumeDb(path: string): number {
  const result = spawnSync(
    getFfmpegBinary(),
    ["-nostdin", "-hide_banner", "-i", path, "-af", "volumedetect", "-f", "null", "-"],
    { encoding: "utf-8" },
  );
  const match = result.stderr.match(/max_volume:\s*(-?[\d.]+) dB/);
  if (!match?.[1]) throw new Error(`Could not measure ${path}: ${result.stderr}`);
  return Number(match[1]);
}

const chainJson = (...nodes: Record<string, unknown>[]): string =>
  JSON.stringify({
    version: 1,
    nodes: nodes.map((node, i) => ({
      id: `n${i + 1}`,
      enabled: true,
      ...node,
    })),
  });

describe("master bus: reading it", () => {
  const html = (root: string, inner = ""): string =>
    `<div ${root}>${inner}<audio id="a" src="a.wav" data-start="0" data-duration="1"></audio></div>`;
  const CHAIN = '{"version":1,"nodes":[]}';
  const attr = `data-fx-chain='${CHAIN}'`;

  it("reads the root's chain as the master, not as a clip's own", () => {
    const doc = html(`data-composition-id="main" ${attr}`);
    expect(parseMasterFxChain(doc)).toBe(CHAIN);
    const [a] = parseAudioElements(doc);
    expect(a?.fxChain).toBeUndefined();
    expect(a?.groupFxChain).toBeUndefined();
  });

  it("has none when the root carries none", () => {
    expect(parseMasterFxChain(html(`data-composition-id="main"`))).toBeUndefined();
  });

  it("leaves a sub-composition root's chain as it was: not the master, not its clips' chain", () => {
    const inner = `<div data-composition-id="inner" ${attr}><audio id="b" src="b.wav" data-start="0" data-duration="1"></audio></div>`;
    const doc = html(`data-composition-id="main"`, inner);
    expect(parseMasterFxChain(doc)).toBeUndefined();
    const [a, b] = parseAudioElements(doc);
    for (const el of [a, b]) {
      expect(el?.fxChain).toBeUndefined();
      expect(el?.groupFxChain).toBeUndefined();
    }
  });

  it("takes the master from the top-level root when a sub-composition root carries one too", () => {
    const MASTER = '{"version":1,"nodes":[{"type":"gain","id":"m","params":{"gain":-3}}]}';
    const inner = `<div data-composition-id="inner" ${attr}></div>`;
    expect(
      parseMasterFxChain(html(`data-composition-id="main" data-fx-chain='${MASTER}'`, inner)),
    ).toBe(MASTER);
  });
});

describe.skipIf(!HAS_FFMPEG)("master bus: reporting an unreadable chain", () => {
  it("fails the mix with a failure instead of throwing", async () => {
    writeWav(join(dir, "a.wav"), new Float32Array(SR).fill(0.1), SR);
    const result = await processCompositionAudio(
      [
        {
          id: "a",
          src: "a.wav",
          start: 0,
          end: 1,
          mediaStart: 0,
          layer: 0,
          volume: 1,
          type: "audio",
        },
      ],
      dir,
      join(dir, "work"),
      join(dir, `bad-${MIXED_AUDIO_FILENAME}`),
      1,
      undefined,
      { masterFxChain: "{not json" },
    );
    expect(result.success).toBe(false);
    expect(result.failures?.[0]?.elementId).toBe("master");
  });
});

describe.skipIf(!HAS_BROWSER || !HAS_FFMPEG)("master bus: rendering it", () => {
  const element = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    src: `${id}.wav`,
    start: 0,
    end: 1,
    mediaStart: 0,
    layer: 0,
    volume: 1,
    type: "audio" as const,
    ...extra,
  });
  const steady = (peak: number, freq: number): Float32Array =>
    Float32Array.from({ length: SR }, (_, i) => peak * Math.sin((2 * Math.PI * freq * i) / SR));

  it("limits the sum of everything that feeds it", async () => {
    // Two tones at -1 dBFS sum to about +5 dBFS: no clip's own chain can see that.
    writeWav(join(dir, "a.wav"), steady(0.9, 300), SR, 1, true);
    writeWav(join(dir, "b.wav"), steady(0.9, 300), SR, 1, true);
    const master = chainJson({
      type: "truepeak",
      params: { ceiling: -6, lookahead: 3, release: 80 },
    });
    const out = join(dir, `limited-${MIXED_AUDIO_FILENAME}`);
    const flat = join(dir, `flat-${MIXED_AUDIO_FILENAME}`);
    const mix = (path: string, masterFxChain?: string) =>
      processCompositionAudio(
        [element("a"), element("b")],
        dir,
        join(dir, "work"),
        path,
        1,
        undefined,
        { masterFxChain },
      );
    expect((await mix(flat)).success).toBe(true);
    expect((await mix(out, master)).success).toBe(true);
    // The unprocessed sum has nowhere to go but full scale.
    expect(maxVolumeDb(flat)).toBeGreaterThan(-1);
    expect(maxVolumeDb(out)).toBeLessThanOrEqual(-5.5);
  }, 180_000);

  /** Mix `elements` for one second and read the file's highest level in dBFS. */
  const mixedPeakDb = async (
    name: string,
    elements: Parameters<typeof processCompositionAudio>[0],
    masterFxChain?: string,
  ): Promise<number> => {
    const out = join(dir, `${name}-${MIXED_AUDIO_FILENAME}`);
    const result = await processCompositionAudio(
      elements,
      dir,
      join(dir, "work"),
      out,
      1,
      undefined,
      { masterFxChain },
    );
    expect(result.success).toBe(true);
    return maxVolumeDb(out);
  };
  const writeTone = (id: string, peak: number): void =>
    writeWav(join(dir, `${id}.wav`), steady(peak, 300), SR, 1, true);

  it("applies the root's data-fx-chain once over the sum, from authored HTML", async () => {
    // Two in-phase 0.3 tones sum to -4.4 dBFS. A -6 dBTP limiter then a -6 dB gain
    // land that at -12. Per clip, neither clip reaches the ceiling and the result is
    // -10.4; applied twice it is -18. A linear chain alone could not tell these apart.
    writeTone("a", 0.3);
    writeTone("b", 0.3);
    const master = chainJson(
      { type: "truepeak", params: { ceiling: -6, lookahead: 3, release: 80 } },
      { type: "gain", params: { gain: -6 } },
    );
    const clip = (id: string) =>
      `<audio id="${id}" src="${id}.wav" data-start="0" data-end="1" data-duration="1"></audio>`;
    const html = `<div data-composition-id="main" data-fx-chain='${master}'>${clip("a")}${clip("b")}</div>`;
    const elements = parseAudioElements(html);
    expect(elements).toHaveLength(2);
    expect(await mixedPeakDb("once", elements, parseMasterFxChain(html))).toBeCloseTo(-12, 0);
  }, 180_000);

  it("keeps the sum in float until the chain has read it", async () => {
    // The sum is +5 dBFS. A -6 dB master gain lands it at -1 if the sum is float; a sum
    // clipped to 16 bits at full scale first would land at -6.
    writeTone("a", 0.9);
    writeTone("b", 0.9);
    const masterFxChain = chainJson({ type: "gain", params: { gain: -6 } });
    const peak = await mixedPeakDb("float", [element("a"), element("b")], masterFxChain);
    expect(peak).toBeGreaterThan(-2);
  }, 180_000);

  it("runs after each group's own chain and fader", async () => {
    // The group limits its 0.5 tone to -20 dBFS, then its fader takes 6 dB off: -26. A
    // +12 dB master gain after both lands at -14. A fader ahead of the limiter would
    // leave -20 and end at -8; a master ahead of the group would be limited away at -26.
    writeTone("g", 0.5);
    const group = {
      groupId: "bus",
      groupFxChain: chainJson({
        type: "truepeak",
        params: { ceiling: -20, lookahead: 3, release: 80 },
      }),
      groupVolume: 0.5,
    };
    const masterFxChain = chainJson({ type: "gain", params: { gain: 12 } });
    expect(await mixedPeakDb("ordered", [element("g", group)], masterFxChain)).toBeCloseTo(-14, 0);
  }, 180_000);
});

describe("windowed rendering of a long input", () => {
  const limits = {
    aboveBytes: 0,
    segmentSeconds: 1,
    prerollSeconds: 1,
    maxPrerollSeconds: 1,
    postrollSeconds: 0.1,
  };

  it("tiles the input exactly, each window carrying its pre- and post-roll", () => {
    const segments = planAudioFxSegments(Math.round(3.5 * SR), SR, limits);
    expect(segments.map((s) => [s.keepFrom, s.keepTo])).toEqual([
      [0, SR],
      [SR, 2 * SR],
      [2 * SR, 3 * SR],
      [3 * SR, Math.round(3.5 * SR)],
    ]);
    expect(segments.map((s) => s.last)).toEqual([false, false, false, true]);
    expect(segments[0]).toMatchObject({ readFrom: 0, readTo: SR + SR / 10 });
    expect(segments[2]).toMatchObject({
      readFrom: SR,
      readTo: 3 * SR + SR / 10,
    });
    expect(segments[3]?.readTo).toBe(Math.round(3.5 * SR));
  });

  it("starts every window on a render quantum, so block-level state lines up with a whole render", () => {
    const odd = { ...limits, prerollSeconds: 0.337 };
    const segments = planAudioFxSegments(Math.round(3.5 * SR), SR, odd);
    for (const seg of segments) {
      expect(seg.readFrom % 128).toBe(0);
      expect(seg.keepFrom - seg.readFrom).toBeGreaterThanOrEqual(
        Math.min(seg.keepFrom, Math.round(0.337 * SR)),
      );
    }
  });

  it("reads the head of a file Node cannot read whole", () => {
    // 2.5 GiB of samples: past the 2 GiB ceiling readFileSync enforces, sparse on disk.
    const path = join(dir, "huge.wav");
    writeWav(path, new Float32Array(0), SR, 2, true);
    const fd = openSync(path, "r+");
    truncateSync(path, 2.5 * 1024 ** 3);
    closeSync(fd);
    expect(() => readWav(path)).toThrow(/greater than 2 GiB/);
    const header = readWavHeader(path);
    expect(header).toMatchObject({
      channels: 2,
      sampleRate: SR,
      float: true,
      dataOffset: 44,
    });
  });

  it("reads a data size of 0xFFFFFFFF, or 0, as running to the end of the file", () => {
    const FIVE_GIB = 5 * 1024 ** 3;
    expect(resolveDataBytes(0xffffffff, FIVE_GIB)).toBe(FIVE_GIB);
    expect(resolveDataBytes(0, FIVE_GIB)).toBe(FIVE_GIB);
    expect(resolveDataBytes(1000, FIVE_GIB)).toBe(1000);
    expect(resolveDataBytes(2000, 1500)).toBe(1500);

    // The same header as ffmpeg leaves on a stream, on a file small enough to write.
    const path = join(dir, "stream.wav");
    writeWav(path, new Float32Array(100), SR, 2, true);
    const bytes = readFileSync(path);
    bytes.writeUInt32LE(0xffffffff, 40);
    writeFileSync(path, bytes);
    expect(readWavHeader(path)).toMatchObject({
      dataOffset: 44,
      dataBytes: 400,
    });
  });

  it("names the cause when a file past 2 GiB cannot be streamed", async () => {
    const path = join(dir, "huge-bad-header.wav");
    writeFileSync(path, "not a wav");
    truncateSync(path, 2.5 * 1024 ** 3);
    await expect(
      applyAudioFxChain(path, chainOf("gain"), join(dir, "out.wav"), {
        trackId: "t",
      }),
    ).rejects.toThrow(/WAV header of an input over 2 GiB could not be read/);
  });

  it("reads a data size of 0 or 0xFFFFFFFF as the rest of the file in both readers", () => {
    for (const declared of [0, 0xffffffff]) {
      const path = join(dir, `declared-${declared}.wav`);
      writeWav(path, new Float32Array(200), SR, 2, true);
      const bytes = readFileSync(path);
      bytes.writeUInt32LE(declared, 40);
      writeFileSync(path, bytes);
      expect(readWav(path).samples.length).toBe(200);
      expect(readWavHeader(path)?.dataBytes).toBe(800);
    }
  });

  it.skipIf(!HAS_BROWSER)(
    "warns when a chain remembers longer than the pre-roll cap",
    async () => {
      const input = join(dir, "warn.wav");
      writeWav(input, new Float32Array(SR), SR, 1, true);
      const delay = (feedback: number): HfAudioFxChain => ({
        version: 1,
        nodes: [
          { type: "delay", id: "d", enabled: true, params: { time: 400, feedback, mix: 0.5 } },
        ],
      });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      try {
        const streaming = { ...limits, prerollSeconds: 0.5, maxPrerollSeconds: 2 };
        await applyAudioFxChain(input, delay(0.95), join(dir, "w1.wav"), {
          trackId: "t1",
          streaming,
        });
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]?.[0])).toContain("track t1");
        await applyAudioFxChain(input, delay(0.1), join(dir, "w2.wav"), {
          trackId: "t2",
          streaming,
        });
        expect(warn).toHaveBeenCalledTimes(1);
      } finally {
        warn.mockRestore();
      }
    },
    180_000,
  );

  it.skipIf(!HAS_BROWSER)(
    "closes the input when the output cannot be opened",
    async () => {
      const input = join(dir, "in.wav");
      writeWav(input, new Float32Array(SR * 2), SR, 1, true);
      openedFds.log.length = 0;
      await expect(
        applyAudioFxChain(input, chainOf("gain"), join(dir, "no-such-dir", "out.wav"), {
          trackId: "t",
          streaming: limits,
        }),
      ).rejects.toThrow();
      const onInput = openedFds.log.filter((entry) => entry.path === input);
      expect(onInput.length).toBeGreaterThan(0);
      expect(onInput.every((entry) => entry.closed)).toBe(true);
    },
    180_000,
  );

  it("names the unsupported case when automation meets a file past 2 GiB", async () => {
    const path = join(dir, "huge-auto.wav");
    writeWav(path, new Float32Array(0), SR, 2, true);
    truncateSync(path, 2.5 * 1024 ** 3);
    await expect(
      applyAudioFxChain(path, chainOf("gain"), join(dir, "out.wav"), {
        trackId: "t",
        automation: { version: 1, lanes: [] },
      }),
    ).rejects.toThrow(/parameter automation is not supported on inputs over 2 GiB/);
  });

  const hot = (seconds: number): Float32Array => {
    const frames = Math.floor(SR * seconds);
    const s = new Float32Array(frames * 2);
    for (let i = 0; i < frames; i++) {
      const swell = 0.5 + 0.9 * Math.abs(Math.sin((2 * Math.PI * i) / (SR * 1.7)));
      s[i * 2] = swell * Math.sin((2 * Math.PI * 300 * i) / SR);
      s[i * 2 + 1] = swell * Math.sin((2 * Math.PI * 450 * i) / SR);
    }
    return s;
  };
  const limiter: HfAudioFxChain = {
    version: 1,
    nodes: [
      {
        type: "truepeak",
        id: "m1",
        enabled: true,
        params: { ceiling: -6, lookahead: 3, release: 80 },
      },
    ],
  };

  it.skipIf(!HAS_BROWSER)(
    "renders a long mix window by window, never reading the file whole, and matches the whole render",
    async () => {
      const input = join(dir, "long.wav");
      writeWav(input, hot(4.4), SR, 2, true);
      const whole = join(dir, "whole.wav");
      const windowed = join(dir, "windowed.wav");
      await applyAudioFxChain(input, limiter, whole, { trackId: "whole" });

      wholeFileReads.paths.length = 0;
      const result = await applyAudioFxChain(input, limiter, windowed, {
        trackId: "windowed",
        streaming: limits,
      });

      expect(result.path).toBe(windowed);
      expect(wholeFileReads.paths).not.toContain(input);
      const a = readWav(whole);
      const b = readWav(windowed);
      expect(b).toMatchObject({ channels: 2, sampleRate: SR, float: true });
      expect(b.samples.length).toBe(a.samples.length);
      let worst = 0;
      // The final 10 ms is left out: a lookahead limiter's last frames come back silent or not
      // depending on the input's length, whole or windowed alike.
      for (let i = 0; i < a.samples.length - SR / 50; i++) {
        worst = Math.max(worst, Math.abs((a.samples[i] ?? 0) - (b.samples[i] ?? 0)));
      }
      expect(worst).toBeLessThan(0.01);
    },
    180_000,
  );

  /** A tone with a loud burst ending just ahead of each 5 s seam. */
  const bursts = (seconds: number): Float32Array => {
    const frames = Math.floor(SR * seconds);
    const s = new Float32Array(frames * 2);
    for (let i = 0; i < frames; i++) {
      const t = i / SR;
      const loud = t % 5 >= 3.4 && t % 5 < 3.9;
      const amp = loud ? 0.9 : 0.12;
      s[i * 2] = amp * Math.sin((2 * Math.PI * 330 * i) / SR);
      s[i * 2 + 1] = amp * Math.sin((2 * Math.PI * 520 * i) / SR);
    }
    return s;
  };
  const memoryChain = (): HfAudioFxChain => ({
    version: 1,
    nodes: [
      // A hold of 5 does not divide the windows' 128-aligned starts, so an unseeded counter drifts.
      { type: "bitcrush", id: "b", enabled: true, params: { bits: 5, samples: 5, mix: 0.7 } },
      {
        type: "chorus",
        id: "c",
        enabled: true,
        params: { ...defaultAudioFxParams("chorus"), speed: 0.25 },
      },
      {
        type: "pitchshift",
        id: "p",
        enabled: true,
        params: { semitones: 3, mix: 1 },
      },
      {
        type: "compressor",
        id: "k",
        enabled: true,
        params: {
          ...defaultAudioFxParams("compressor"),
          threshold: -30,
          ratio: 10,
          makeup: 20,
          release: 700,
        },
      },
      {
        type: "delay",
        id: "d",
        enabled: true,
        params: { time: 400, feedback: 0.5, mix: 0.5 },
      },
      {
        type: "reverb",
        id: "r",
        enabled: true,
        params: { size: 0.5, wet: 0.3 },
      },
    ],
  });
  const memoryLimits = {
    ...limits,
    segmentSeconds: 5,
    prerollSeconds: 0.5,
    maxPrerollSeconds: 12,
  };

  const renderBoth = async (
    streaming: typeof memoryLimits,
  ): Promise<{ whole: Float32Array; windowed: Float32Array }> => {
    const input = join(dir, "mem.wav");
    writeWav(input, bursts(22), SR, 2, true);
    await applyAudioFxChain(input, memoryChain(), join(dir, "mem-whole.wav"), {
      trackId: "w",
    });
    await applyAudioFxChain(input, memoryChain(), join(dir, "mem-windowed.wav"), {
      trackId: "s",
      streaming,
    });
    return {
      whole: readWav(join(dir, "mem-whole.wav")).samples,
      windowed: readWav(join(dir, "mem-windowed.wav")).samples,
    };
  };
  const worstDifference = (a: Float32Array, b: Float32Array): number => {
    let worst = 0;
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
    return worst;
  };

  it.skipIf(!HAS_BROWSER)(
    "carries bitcrush, modulation, delay, reverb and compressor state across window seams",
    async () => {
      const { whole, windowed } = await renderBoth(memoryLimits);
      // The tail of the last window is kept: dropping it would shorten the file.
      expect(windowed.length).toBe(whole.length);
      expect(whole.length).toBeGreaterThan(22 * SR * 2);
      expect(worstDifference(whole, windowed)).toBeLessThan(0.001);
    },
    240_000,
  );

  it.skipIf(!HAS_BROWSER)(
    "cannot match the whole render without the pre-roll the chain asks for",
    async () => {
      const { whole, windowed } = await renderBoth({
        ...memoryLimits,
        maxPrerollSeconds: 0.5,
      });
      expect(worstDifference(whole, windowed)).toBeGreaterThan(0.05);
    },
    240_000,
  );

  it.skipIf(!HAS_BROWSER)(
    "a lookahead limiter keeps the last of its input and the file's length",
    async () => {
      const input = join(dir, "tp.wav");
      const frames = Math.round(0.5 * SR);
      const steady = new Float32Array(frames).fill(0.3);
      writeWav(input, steady, SR, 1, true);
      const out = join(dir, "tp-out.wav");
      await applyAudioFxChain(input, chainOf("truepeak"), out, { trackId: "tp" });
      const samples = readWav(out).samples;
      expect(samples.length).toBe(frames);
      // The lookahead is 7 ms by default; the final 5 ms must still carry the signal.
      expect(sliceRms(samples, 0.495, 0.5)).toBeGreaterThan(0.25);
    },
    120_000,
  );

  it.skipIf(!HAS_BROWSER)(
    "a pitch shifter keeps the last 90 ms of its input",
    async () => {
      const input = join(dir, "ps.wav");
      const frames = Math.round(0.4 * SR);
      writeWav(input, new Float32Array(frames).fill(0.3), SR, 1, true);
      const out = join(dir, "ps-out.wav");
      const chain: HfAudioFxChain = {
        version: 1,
        nodes: [
          {
            type: "pitchshift",
            id: "p",
            enabled: true,
            params: { ...defaultAudioFxParams("pitchshift"), semitones: 7, mix: 1 },
          },
        ],
      };
      await applyAudioFxChain(input, chain, out, { trackId: "ps" });
      const samples = readWav(out).samples;
      // The shifter reads up to a grain behind its write head, so the last 90 ms of the clip comes
      // out after the input ends. A steady level stays steady, so quiet there is dropped audio.
      expect(samples.length).toBeGreaterThan(frames);
      expect(sliceRms(samples, 0.31, 0.4)).toBeGreaterThan(0.2);
      expect(sliceRms(samples, 0.4, 0.45)).toBeGreaterThan(0.1);
    },
    120_000,
  );

  it.skipIf(!HAS_BROWSER)(
    "bakes a volume envelope on the file's own clock across window boundaries",
    async () => {
      const input = join(dir, "env.wav");
      writeWav(input, new Float32Array(SR * 3 * 2).fill(0.25), SR, 2, true);
      const out = join(dir, "env-out.wav");
      const gain: HfAudioFxChain = {
        version: 1,
        nodes: [{ type: "gain", id: "g", enabled: true, params: { gain: 0 } }],
      };
      const result = await applyAudioFxChain(input, gain, out, {
        trackId: "env",
        streaming: limits,
        envelope: {
          keyframes: [
            { time: 0, volume: 1 },
            { time: 1.5, volume: 1 },
            { time: 1.5001, volume: 0.5 },
            { time: 3, volume: 0.5 },
          ],
          trackStart: 0,
          baseVolume: 1,
        },
      });
      expect(result.envelopeBaked).toBe(true);
      const samples = readWav(out).samples;
      expect(samples[Math.floor(1.2 * SR) * 2]).toBeCloseTo(0.25, 2);
      expect(samples[Math.floor(2.2 * SR) * 2]).toBeCloseTo(0.125, 2);
    },
    180_000,
  );
});
