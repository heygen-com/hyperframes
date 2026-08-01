import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

const rms = (s: Float32Array): number =>
  Math.sqrt(s.reduce((a, x) => a + x * x, 0) / Math.max(1, s.length));
const db = (x: number): number => 20 * Math.log10(x + 1e-30);

describe("readWav / writeWav", () => {
  it("round-trips float samples", () => {
    const p = join(dir, "rt.wav");
    const src = new Float32Array([0, 0.5, -0.5, 0.25]);
    writeWav(p, src, SR);
    const back = readWav(p);
    expect(back.sampleRate).toBe(SR);
    expect(back.channels).toBe(1);
    expect(Array.from(back.samples)).toEqual(Array.from(src));
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
