import { describe, expect, it, vi } from "vitest";
import { decodeAudio } from "../analysis/decode.js";
import { decodeMono, levelWhileHeardDb, levels, READ_RATE } from "./signal.js";

vi.mock("../analysis/decode.js", () => ({ decodeAudio: vi.fn() }));

describe("read signal boundaries", () => {
  it.each([NaN, Infinity, -Infinity])("rejects decoded non-finite PCM (%s)", async (value) => {
    vi.mocked(decodeAudio).mockResolvedValue({
      signal: { channels: [Float32Array.of(0, value, 0)], sampleRate: READ_RATE },
      stream: { audioStream: 0, channels: 1, sampleRate: READ_RATE, duration: 3 / READ_RATE },
    });
    await expect(decodeMono("invalid.wav")).rejects.toThrow("non-finite audio samples");
  });

  it("omits silence, empty tracks and levels below the audibility floor", () => {
    expect(levelWhileHeardDb(new Float32Array(), READ_RATE)).toBeNull();
    expect(levelWhileHeardDb(new Float32Array(READ_RATE), READ_RATE)).toBeNull();
    expect(levelWhileHeardDb(new Float32Array(READ_RATE).fill(0.001), READ_RATE)).toBeNull();
    expect(levelWhileHeardDb(new Float32Array(READ_RATE).fill(0.002), READ_RATE)).toBe(-54);
  });

  it("averages audible power rather than dB, without diluting a stem with silence", () => {
    const samples = new Float32Array(20 * READ_RATE);
    samples.fill(0.1, 0, 10 * READ_RATE);
    samples.fill(0.01, 10 * READ_RATE);
    expect(levelWhileHeardDb(samples, READ_RATE)).toBe(-23);
    const sparse = new Float32Array(30 * READ_RATE);
    sparse.fill(0.1, 10 * READ_RATE, 20 * READ_RATE);
    expect(levelWhileHeardDb(sparse, READ_RATE)).toBe(-20);
  });
});

describe("levels", () => {
  it("keeps fractional sample hops aligned late in a recording", () => {
    const samples = new Float32Array(601 * READ_RATE);
    samples.fill(0.5, 600 * READ_RATE, Math.round(600.1 * READ_RATE));
    const db = levels(samples, READ_RATE, 0.01);
    expect(db).toHaveLength(60100);
    expect(db[60005]).toBeCloseTo(20 * Math.log10(0.5), 3);
    expect(db[59990]).toBe(-120);
  });
});
