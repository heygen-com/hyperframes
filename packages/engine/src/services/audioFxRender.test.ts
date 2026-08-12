import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyVolumeEnvelopeToWav } from "./audioVolumeEnvelope.js";
import { defaultAudioFxParams, type HfAudioFxChain } from "@hyperframes/core/audio-fx";
import { applyAudioFxChain, AudioFxRenderError, readWav, writeWav } from "./audioFxRender.js";
import { resolveHeadlessShellPath } from "./browserManager.js";
import { getFfmpegBinary } from "../utils/ffmpegBinaries.js";

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
  nodes: types.map((t) => ({ type: t, enabled: true, params: defaultAudioFxParams(t) })),
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
        nodes: [{ type: "peaking", enabled: true, params: { frequency: 440, gain: -30, q: 1 } }],
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
            params: { ...defaultAudioFxParams("compressor"), threshold: -40, ratio: 20 },
          },
        ],
      },
      outPath,
      { trackId: "t" },
    );
    expect(db(rms(readWav(outPath).samples))).toBeLessThan(db(rms(readWav(input).samples)) - 3);
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
        nodes: [{ type: "lowpass", id: "n1", enabled: true, params: { frequency: 300, q: 0.707 } }],
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
        nodes: [{ type: "peaking", enabled: true, params: { frequency: 440, gain: 6, q: 1 } }],
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
        nodes: [{ type: "peaking", enabled: true, params: { frequency: 1000, gain: 0, q: 1 } }],
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
