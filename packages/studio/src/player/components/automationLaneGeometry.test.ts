// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { automationTargets, fromUnit, toUnit } from "./automationLaneGeometry";
import { resolveAutomationRange, VOLUME_RANGE } from "@hyperframes/core/audio-automation";
import type { HfAudioFxChain } from "@hyperframes/core/audio-fx";

const chain: HfAudioFxChain = {
  version: 1,
  nodes: [
    { type: "lowpass", id: "n1", enabled: true, params: {} },
    // No id: the panel has not touched it, so nothing can address it.
    { type: "peaking", enabled: true, params: {} },
    // Worklet-backed: no AudioParams to schedule.
    { type: "compressor", id: "n3", enabled: true, params: {} },
  ],
};

describe("automationTargets", () => {
  it("offers volume plus every addressable automatable knob", () => {
    const targets = automationTargets(chain).map((t) => t.target);
    expect(targets[0]).toBe("volume");
    expect(targets).toContain("fx.n1.frequency");
    expect(targets).toContain("fx.n1.q");
  });

  it("skips a node with no id — a lane could not address it stably", () => {
    expect(automationTargets(chain).some((t) => t.target.includes("peaking"))).toBe(false);
  });

  it("skips a worklet effect, which exposes no AudioParams", () => {
    expect(automationTargets(chain).some((t) => t.target.startsWith("fx.n3."))).toBe(false);
  });

  it("offers just the fader for a track with no chain", () => {
    expect(automationTargets(null).map((t) => t.target)).toEqual(["volume"]);
  });

  it("labels an fx target with its effect and knob", () => {
    const found = automationTargets(chain).find((t) => t.target === "fx.n1.frequency");
    expect(found?.label).toMatch(/Cutoff/);
    expect(found?.range.scale).toBe("log");
  });
});

describe("value ↔ lane position", () => {
  it("maps a linear range straight onto the lane", () => {
    expect(toUnit(VOLUME_RANGE, 0)).toBe(0);
    expect(toUnit(VOLUME_RANGE, 1)).toBe(1);
    expect(toUnit(VOLUME_RANGE, 0.25)).toBeCloseTo(0.25, 10);
  });

  it("maps a log-read knob on its own scale, so its middle is geometric", () => {
    const range = resolveAutomationRange("fx.n1.frequency", chain)!;
    const mid = fromUnit(range, 0.5);
    expect(mid).toBeCloseTo(Math.sqrt(range.min * range.max), 4);
    // Round trip: a value put in comes back out.
    expect(fromUnit(range, toUnit(range, 900))).toBeCloseTo(900, 6);
  });

  it("clamps a pointer that has left the lane", () => {
    expect(fromUnit(VOLUME_RANGE, -3)).toBe(0);
    expect(fromUnit(VOLUME_RANGE, 4)).toBe(1);
  });

  it("reads a zero-width range as the bottom rather than dividing by zero", () => {
    expect(toUnit({ ...VOLUME_RANGE, min: 1, max: 1 }, 1)).toBe(0);
  });
});
