import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyVolumeEnvelopeToWav } from "./audioVolumeEnvelope.js";
import { defaultAudioFxParams, type HfAudioFxChain } from "@hyperframes/core/audio-fx";
import { applyAudioFxChain, AudioFxRenderError, readWav, writeWav } from "./audioFxRender.js";

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

  it("reads 16-bit PCM, which the trim step can emit", () => {
    const p = join(dir, "pcm16.wav");
    execFileSync("ffmpeg", [
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
    expect(out).toBe(input);
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
describe("browser render", () => {
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
    expect(result).toBe(outPath);
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
