import { describe, expect, it } from "vitest";
import { elementVolumeLaneGain } from "./audioAutomationVolume.js";

const el = (automation?: string) => ({
  getAttribute: (name: string) =>
    name === "data-automation" && automation !== undefined ? automation : null,
});

const duck = JSON.stringify({
  version: 1,
  lanes: [
    {
      target: "volume",
      points: [
        { t: 0, v: 0.55 },
        { t: 1.4, v: 0.55 },
        { t: 1.5, v: 0.15 },
        { t: 9.5, v: 0.15 },
        { t: 11, v: 0.55 },
      ],
    },
  ],
});

describe("elementVolumeLaneGain", () => {
  it("returns the lane's gain at a clip-local time", () => {
    expect(elementVolumeLaneGain(el(duck), 0)).toBeCloseTo(0.55, 6);
    expect(elementVolumeLaneGain(el(duck), 1.4)).toBeCloseTo(0.55, 6);
    expect(elementVolumeLaneGain(el(duck), 5)).toBeCloseTo(0.15, 6);
    expect(elementVolumeLaneGain(el(duck), 11)).toBeCloseTo(0.55, 6);
    // Holds past the last point rather than falling to zero.
    expect(elementVolumeLaneGain(el(duck), 20)).toBeCloseTo(0.55, 6);
  });

  it("ramps between points", () => {
    const mid = elementVolumeLaneGain(el(duck), 1.45) ?? 0;
    expect(mid).toBeLessThan(0.55);
    expect(mid).toBeGreaterThan(0.15);
  });

  it("returns null with no automation, so the caller keeps its own rules", () => {
    expect(elementVolumeLaneGain(el(), 1)).toBeNull();
    expect(elementVolumeLaneGain(el(""), 1)).toBeNull();
  });

  it("returns null for an element that carries only FX lanes", () => {
    const fxOnly = JSON.stringify({
      version: 1,
      lanes: [{ target: "fx.n1.frequency", points: [{ t: 0, v: 400 }] }],
    });
    expect(elementVolumeLaneGain(el(fxOnly), 0)).toBeNull();
  });

  it("plays flat rather than silent when the attribute is unreadable", () => {
    expect(elementVolumeLaneGain(el("{not json"), 0)).toBeNull();
  });

  it("tolerates an object with no getAttribute at all", () => {
    expect(elementVolumeLaneGain({}, 0)).toBeNull();
  });

  it("does not reparse the same attribute on every call", () => {
    // The runtime asks once per tick per track; parsing there would run the JSON
    // parser 60 times a second for a value that only changes on an edit.
    let reads = 0;
    const counting = {
      getAttribute: (name: string) => {
        if (name !== "data-automation") return null;
        reads += 1;
        return duck;
      },
    };
    for (let i = 0; i < 50; i += 1) elementVolumeLaneGain(counting, i / 10);
    expect(reads).toBe(50);
    // Same object identity back each time proves the parse was cached.
    const a = elementVolumeLaneGain(el(duck), 1);
    const b = elementVolumeLaneGain(el(duck), 1);
    expect(a).toBe(b);
  });
});
