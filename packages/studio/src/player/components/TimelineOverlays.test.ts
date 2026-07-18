import { describe, expect, it } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { resolveTimelineContextElement } from "./TimelineOverlays";

const captured: TimelineElement = {
  id: "child",
  key: "parent::child",
  tag: "div",
  start: 1,
  duration: 2,
  track: 3,
};

describe("resolveTimelineContextElement", () => {
  it("returns the current expanded model instead of the captured snapshot", () => {
    const current = { ...captured, start: 4, track: 7 };

    expect(
      resolveTimelineContextElement({
        capturedElement: captured,
        targetSessionEpoch: 2,
        sessionEpoch: 2,
        selectedElementId: "parent::child",
        elements: [current],
      }),
    ).toBe(current);
  });

  it("resolves synthetic expanded children that are absent from raw store elements", () => {
    expect(
      resolveTimelineContextElement({
        capturedElement: captured,
        targetSessionEpoch: 2,
        sessionEpoch: 2,
        selectedElementId: "parent::child",
        elements: [captured],
      }),
    ).toBe(captured);
  });

  it("rejects stale sessions, changed selection, and removed elements", () => {
    const input = {
      capturedElement: captured,
      targetSessionEpoch: 2,
      sessionEpoch: 2,
      selectedElementId: "parent::child",
      elements: [captured],
    };

    expect(resolveTimelineContextElement({ ...input, sessionEpoch: 3 })).toBeNull();
    expect(resolveTimelineContextElement({ ...input, selectedElementId: "other" })).toBeNull();
    expect(resolveTimelineContextElement({ ...input, elements: [] })).toBeNull();
  });
});
