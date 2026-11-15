import { expect, it } from "vitest";
import { previewDecodeTime, previewPresentationTime } from "./previewVideoTime";

const cfr = {
  frameRate: 30,
  variableFrameRate: false,
  sourceLead: 0,
  inputLead: 0,
  timeResolution: 1000,
};
it("matches export at rounded WebM ticks without selecting the nearest future frame", () => {
  expect(previewDecodeTime(2 / 30, cfr)).toBeCloseTo(0.06701, 8);
  expect(previewPresentationTime(0.067, 2 / 30, cfr).timestamp).toBeCloseTo(2 / 30, 8);
  expect(previewDecodeTime(3.33, cfr)).toBeCloseTo(3.30001, 8);
  expect(previewDecodeTime(0.0666, cfr)).toBeCloseTo(0.03301, 8);
});
it("preserves a nonzero source lead when a prepared file starts at zero", () => {
  const timing = { ...cfr, sourceLead: 5, inputLead: 0 };
  expect(previewDecodeTime(5 + 2 / 30, timing)).toBeCloseTo(0.06701, 8);
  expect(previewPresentationTime(0.067, 5 + 2 / 30, timing).timestamp).toBeCloseTo(5 + 2 / 30, 8);
});
it("retains raw VFR times and holds a prior frame through a timestamp gap", () => {
  const timing = { ...cfr, variableFrameRate: true };
  expect(previewDecodeTime(0.1, timing)).toBeCloseTo(0.1, 8);
  const held = previewPresentationTime(0.04, 0.1, timing);
  expect(held.timestamp).toBe(0.04);
  expect(held.timestamp + held.duration).toBeGreaterThan(0.1);
  expect(held.timestamp + held.duration).toBeLessThan(0.101);
});
it("does not advance to the next CFR frame just before its boundary", () => {
  expect(previewDecodeTime(2 / 30 - 0.000005, cfr)).toBeCloseTo(0.03301, 8);
  const timing = { ...cfr, frameRate: 30000 / 1001, sourceLead: 5 };
  expect(previewDecodeTime(5 + (2 * 1001) / 30000 - 0.000005, timing)).toBeCloseTo(0.03301, 8);
});
it("does not cross a real VFR timestamp when querying just before it", () => {
  const timing = { ...cfr, variableFrameRate: true, sourceLead: 5, inputLead: 2 };
  expect(previewDecodeTime(5.1 - 0.000005, timing)).toBeLessThan(2.1);
});
