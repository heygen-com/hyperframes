import { describe, expect, it } from "vitest";
import {
  rhythm,
  signalProvider,
  silence,
  type AudioAnalysisProvider,
  type AudioSignal,
} from "@hyperframes/core/audio-analysis";
import { analyzeSignal, envelopeHopMs, type MarkedBeats } from "./analyze.js";

const RATE = 8000;
const tone: AudioSignal = {
  sampleRate: RATE,
  channels: [Float32Array.from({ length: RATE }, (_, i) => (i > RATE / 2 ? 0.5 * Math.sin(i) : 0))],
};

describe("analyzeSignal", () => {
  it("reports times in file seconds when the signal starts partway into the file", async () => {
    const analysis = await analyzeSignal(tone, {
      capabilities: ["moments", "envelope"],
      fileOffset: 2,
    });
    expect((analysis.values.moments as { onset: number }).onset).toBeCloseTo(2.5, 2);
    expect(analysis.values.envelope).toMatchObject({ startsAt: 2 });
  });

  it("follows a provider pinned to a capability and says which one answered", async () => {
    const fixed: AudioAnalysisProvider<AudioSignal> = {
      id: "fixed",
      local: true,
      capabilities: ["moments"],
      analyze: async () => ({ onset: 0.1, steepest: 0.1, peak: 0.1, tailEnd: 0.2 }),
    };
    const analysis = await analyzeSignal(
      tone,
      { capabilities: ["moments", "loudness"], provider: { moments: "fixed" }, fileOffset: 1 },
      [signalProvider, fixed],
    );
    expect(analysis.provenance).toEqual({ moments: "fixed", loudness: "signal" });
    expect(analysis.values.moments).toEqual({ onset: 1.1, steepest: 1.1, peak: 1.1, tailEnd: 1.2 });
  });

  it("warns, and answers nothing, for a capability no provider offers", async () => {
    const analysis = await analyzeSignal(tone, { capabilities: ["describe"] }, [signalProvider]);
    expect(analysis.values.describe).toBeNull();
    expect(analysis.warnings).toEqual(["describe: no provider answered (none offers it)"]);
  });

  it("reads tempo off the beats of whichever provider placed them, in file seconds", async () => {
    const grid: AudioAnalysisProvider<AudioSignal> = {
      id: "grid",
      local: true,
      capabilities: ["beats"],
      analyze: async () => ({ times: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4] }),
    };
    const analysis = await analyzeSignal(tone, { capabilities: ["bpm", "beats"], fileOffset: 10 }, [
      grid,
      signalProvider,
    ]);
    expect(analysis.provenance).toEqual({ bpm: "grid", beats: "grid" });
    expect(analysis.values.bpm).toEqual({
      value: 120,
      curve: [
        { t: 10, bpm: 120 },
        { t: 14, bpm: 120 },
      ],
    });
    expect((analysis.values.beats as { times: number[] }).times[0]).toBe(10);
  });

  it("keeps a service off the ladder at quality fast", async () => {
    const service: AudioAnalysisProvider<AudioSignal> = {
      id: "service",
      local: false,
      capabilities: ["beats"],
      analyze: async () => ({ times: [1] }),
    };
    const analysis = await analyzeSignal(
      tone,
      { capabilities: ["beats"], quality: "fast", options: {} },
      [service, signalProvider],
    );
    expect(analysis.provenance.beats).toBe("signal");
    expect(analysis.warnings).toEqual([]);
  });
});

/** A 120 BPM click every half second from 0.25 s, with nothing at all from `restFrom` to `restTo`. */
function clicks(seconds: number, restFrom = Infinity, restTo = Infinity): AudioSignal {
  const samples = new Float32Array(seconds * RATE);
  let state = 7;
  for (let t = 0.25; t < seconds; t += 0.5) {
    if (t >= restFrom && t < restTo) continue;
    for (let i = 0; i < 0.05 * RATE; i++) {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      samples[Math.round(t * RATE) + i]! +=
        0.5 * ((state / 2_147_483_648) * 2 - 1) * Math.exp(-i / (0.01 * RATE));
    }
  }
  return { sampleRate: RATE, channels: [samples] };
}

// xorshift32: the clicks' LCG repeats in a short cycle, which the tracker would hear as a pulse
let hissState = 0x9e3779b9;
function hiss(): number {
  hissState ^= hissState << 13;
  hissState ^= hissState >>> 17;
  hissState ^= hissState << 5;
  return (hissState >>> 0) / 2 ** 31 - 1;
}

/** 120 BPM: a kick on every beat, a hat between, a held bass note; `db` quieter from `quietFrom` on. */
function groove(seconds: number, quietFrom: number, db: number): AudioSignal {
  const x = new Float32Array(seconds * RATE);
  for (let k = 0; k * 0.5 + 0.25 < seconds; k++) {
    const at = Math.round((0.25 + k * 0.5) * RATE);
    for (let i = 0; i < 0.2 * RATE && at + i < x.length; i++) {
      const sweep = 50 + 100 * Math.exp(-i / (0.03 * RATE));
      x[at + i]! += 0.6 * Math.sin((2 * Math.PI * sweep * i) / RATE) * Math.exp(-i / (0.06 * RATE));
    }
    const off = at + 0.25 * RATE;
    for (let i = 0; i < 0.04 * RATE && off + i < x.length; i++)
      x[off + i]! += 0.15 * hiss() * Math.exp(-i / (0.008 * RATE));
  }
  for (let i = 0; i < x.length; i++) {
    x[i]! += 0.1 * Math.sin((2 * Math.PI * 55 * i) / RATE);
    if (i >= quietFrom * RATE) x[i]! *= 10 ** (-db / 20);
  }
  return { sampleRate: RATE, channels: [x] };
}

const answering = (id: string, times: number[]): AudioAnalysisProvider<AudioSignal> => ({
  id,
  local: true,
  capabilities: ["beats"],
  analyze: async () => ({ times }),
});

describe("analyzeSignal beats, from any provider", () => {
  it("moves a provider's beats onto the signal's own when one is within a quarter beat", async () => {
    const signal = clicks(12);
    const measured = rhythm(signal).beats.times;
    // 30 ms late on every beat, plus one beat between two of the signal's
    const late = answering(
      "late",
      [...measured.map((t) => t + 0.03), 6.5].sort((a, b) => a - b),
    );
    const analysis = await analyzeSignal(signal, { capabilities: ["beats", "bpm"] }, [
      late,
      signalProvider,
    ]);
    const beats = analysis.values.beats as MarkedBeats;
    expect(analysis.provenance.beats).toBe("late");
    expect(beats.times).toEqual([...measured, 6.5].sort((a, b) => a - b));
    expect(beats.snap).toMatchObject({
      reference: "signal beats",
      snapped: measured.length,
      medianShiftMs: 30,
    });
    expect(beats.snap?.unsnapped).toEqual([6.5]);
    expect((analysis.values.bpm as { value: number }).value).toBeCloseTo(120, 0);
  });

  it("keeps the signal's own beats as measured", async () => {
    const signal = clicks(12);
    const analysis = await analyzeSignal(signal, { capabilities: ["beats"] }, [signalProvider]);
    const beats = analysis.values.beats as MarkedBeats;
    expect(beats.times).toEqual(rhythm(signal).beats.times);
    expect(beats.snap).toBeUndefined();
  });

  it("marks every beat in digital silence as unheard, from any provider, and keeps it in the grid", async () => {
    const signal = clicks(12, 4, 6);
    const quiet = silence(signal);
    const inQuiet = (t: number) => quiet.some((s) => t >= s.start && t < s.end);
    const grid = Array.from({ length: 24 }, (_, k) => 0.25 + k * 0.5);
    for (const provider of [answering("grid", grid), signalProvider]) {
      const analysis = await analyzeSignal(signal, { capabilities: ["beats"], fileOffset: 1 }, [
        provider,
      ]);
      const beats = analysis.values.beats as MarkedBeats;
      expect(beats.unheard).toHaveLength(beats.times.length);
      expect(beats.unheard).toEqual(beats.times.map((t) => inQuiet(t - 1)));
    }
    const grid24 = (
      await analyzeSignal(signal, { capabilities: ["beats"] }, [answering("grid", grid)])
    ).values.beats as MarkedBeats;
    expect(grid24.times).toHaveLength(24);
    // the four grid beats in the rest, each moved onto the signal's own grid there
    const resting = grid24.times.filter((_, k) => grid24.unheard[k]);
    expect(resting.map((t) => Math.round(t * 4) / 4)).toEqual([4.25, 4.75, 5.25, 5.75]);
  });

  it("marks beats unheard where noise plays with no pulse, though it is far from silence", async () => {
    const signal = clicks(12, 4, 8);
    const samples = signal.channels[0]!;
    for (let i = 4 * RATE; i < 8 * RATE; i++) samples[i] = 0.05 * hiss();
    expect(silence(signal).some((s) => s.start < 8 && s.end > 4)).toBe(false);
    const grid = Array.from({ length: 24 }, (_, k) => 0.25 + k * 0.5);
    const beats = (
      await analyzeSignal(signal, { capabilities: ["beats"] }, [answering("grid", grid)])
    ).values.beats as MarkedBeats;
    const inHiss = beats.times.map((t) => t > 4.1 && t < 8);
    expect(beats.unheard.filter((_, k) => inHiss[k]).every(Boolean)).toBe(true);
    expect(beats.unheard.filter((_, k) => !inHiss[k] && beats.times[k]! < 11.5).some(Boolean)).toBe(
      false,
    );
  });

  it.each([30, 45])("keeps beats heard in a section %i dB under the loudest", async (db) => {
    const signal = groove(24, 12, db);
    const grid = Array.from({ length: 48 }, (_, k) => 0.25 + k * 0.5);
    const beats = (
      await analyzeSignal(signal, { capabilities: ["beats"] }, [answering("grid", grid)])
    ).values.beats as MarkedBeats;
    const quiet = beats.unheard.filter((_, k) => beats.times[k]! > 12.1 && beats.times[k]! < 23.5);
    expect(quiet.length).toBeGreaterThan(18);
    expect(quiet.some(Boolean)).toBe(false);
  });

  it("marks downbeats the same way, and moves them by the bar's own beat", async () => {
    const signal = clicks(12, 4, 6);
    const measured = rhythm(signal).beats.times;
    const bars: AudioAnalysisProvider<AudioSignal> = {
      id: "bars",
      local: true,
      capabilities: ["downbeats"],
      analyze: async () => ({ times: [0.27, 2.27, 4.27, 6.27, 8.27, 10.27], meter: 4 }),
    };
    const downbeats = (await analyzeSignal(signal, { capabilities: ["downbeats"] }, [bars])).values
      .downbeats as MarkedBeats;
    expect(downbeats.snap?.toleranceMs).toBe(125);
    expect(downbeats.unheard).toEqual([false, false, true, false, false, false]);
    expect(
      downbeats.times.filter((_, k) => !downbeats.unheard[k]).every((t) => measured.includes(t)),
    ).toBe(true);
  });
});

describe("analyzeSignal quality", () => {
  const service: AudioAnalysisProvider<AudioSignal> = {
    id: "service",
    local: false,
    capabilities: ["describe"],
    analyze: async () => ({ tags: [{ label: "speech", score: 0.9 }] }),
  };

  it("keeps audio on this machine unless best is asked for, and says what best would add", async () => {
    const local = await analyzeSignal(tone, { capabilities: ["describe"] }, [service]);
    expect(local.values.describe).toBeNull();
    expect(local.ladder.describe).toEqual([
      {
        provider: "service",
        outcome: "excluded",
        reason: "quality local keeps audio on this machine",
      },
    ]);
    expect(local.warnings.at(-1)).toContain("--quality best");

    const best = await analyzeSignal(tone, { capabilities: ["describe"], quality: "best" }, [
      service,
    ]);
    expect(best.provenance.describe).toBe("service");
    expect(best.warnings).toEqual([]);
  });
});

describe("envelopeHopMs", () => {
  it("keeps short sounds at 5 ms and coarsens long ones to about 2,000 values", () => {
    expect(envelopeHopMs(1)).toBe(5);
    expect(envelopeHopMs(180)).toBe(90);
    expect(envelopeHopMs(180, 20)).toBe(20);
  });
});
