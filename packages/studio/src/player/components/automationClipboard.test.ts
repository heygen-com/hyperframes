import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAutomationClipboard,
  copyRange,
  pastePoints,
  readClipboard,
} from "./automationClipboard";
import { resolveAutomationRange, VOLUME_RANGE } from "@hyperframes/core/audio-automation";
import type { HfAutomationLane } from "@hyperframes/core/audio-automation";

const duck: HfAutomationLane = {
  target: "volume",
  points: [
    { t: 2, v: 1, curve: -0.4 },
    { t: 3, v: 0.25 },
    { t: 4, v: 1 },
  ],
};

beforeEach(clearAutomationClipboard);

describe("automation clipboard", () => {
  it("copies the range rebased to zero", () => {
    copyRange(duck, VOLUME_RANGE, 2, 4);
    const entry = readClipboard();
    expect(entry?.span).toBe(2);
    expect(entry?.points.map((p) => p.t)).toEqual([0, 1, 2]);
    expect(entry?.points[0]?.curve).toBe(-0.4);
  });

  it("pastes at a new time on the same axis unchanged", () => {
    copyRange(duck, VOLUME_RANGE, 2, 4);
    const entry = readClipboard();
    expect(entry).not.toBeNull();
    if (!entry) return;
    const pts = pastePoints(entry, VOLUME_RANGE, 10);
    expect(pts.map((p) => p.t)).toEqual([10, 11, 12]);
    expect(pts.map((p) => p.v)).toEqual([1, 0.25, 1]);
  });

  it("maps values through unit space onto a different parameter", () => {
    const wet = resolveAutomationRange("fx.r.wet", {
      version: 1,
      nodes: [{ type: "reverb", id: "r", params: {} }],
    });
    expect(wet).toBeTruthy();
    if (!wet) return;
    copyRange(duck, VOLUME_RANGE, 2, 4);
    const entry = readClipboard();
    if (!entry) return;
    const pts = pastePoints(entry, wet, 0);
    // volume 1 (unit 1) → wet max; volume 0.25 (unit 0.25) → a quarter up wet's axis
    expect(pts[0]?.v).toBeCloseTo(wet.max, 5);
    expect(pts[1]?.v).toBeCloseTo(wet.min + 0.25 * (wet.max - wet.min), 5);
  });

  it("reads null when nothing was copied", () => {
    expect(readClipboard()).toBeNull();
  });
});
