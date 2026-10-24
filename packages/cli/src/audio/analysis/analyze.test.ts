import { describe, expect, it } from "vitest";
import {
  signalProvider,
  type AudioAnalysisProvider,
  type AudioSignal,
} from "@hyperframes/core/audio-analysis";
import { analyzeSignal, envelopeHopMs } from "./analyze.js";

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
