import { describe, expect, it } from "vitest";
import {
  resolveNaturalMediaTimelineDuration,
  resolveNaturalMediaTimelineDurationFromValues,
} from "./playbackRate";

function elementWith(attributes: Record<string, string>): Pick<Element, "getAttribute"> {
  return {
    getAttribute(name) {
      return attributes[name] ?? null;
    },
  };
}

describe("resolveNaturalMediaTimelineDuration", () => {
  it.each([
    ["2x", 5],
    ["0x2", 10],
  ])("matches native playback-rate parsing for %s", (rate, expected) => {
    expect(
      resolveNaturalMediaTimelineDuration(elementWith({ "data-playback-rate": rate }), 10),
    ).toBe(expected);
  });

  it.each([10, 11])("returns a known zero span at or past source EOF (start=%s)", (start) => {
    expect(
      resolveNaturalMediaTimelineDuration(elementWith({ "data-media-start": String(start) }), 10),
    ).toBe(0);
  });

  it("returns null only when source duration is unknown", () => {
    expect(resolveNaturalMediaTimelineDuration(elementWith({}), Number.NaN)).toBeNull();
  });
});

describe("rate lane duration", () => {
  it("resolves natural media duration through the lane", () => {
    const lane = { target: "rate", points: [{ t: 0, v: 1 }, { t: 2, v: 3 }] };
    expect(resolveNaturalMediaTimelineDurationFromValues(4, 0, lane)).toBeCloseTo(2 + (4 - 3.6410) / 3, 2);
    expect(resolveNaturalMediaTimelineDurationFromValues(10, 0, lane)).toBeCloseTo(2 + (10 - 3.6410) / 3, 2);
  });
});
