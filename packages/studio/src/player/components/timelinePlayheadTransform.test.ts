import { describe, expect, it } from "vitest";
import { getTimelinePlayheadTransform } from "./timelinePlayheadTransform";

describe("getTimelinePlayheadTransform", () => {
  it("lands the playhead on whole device pixels, so its 1px line is never split across two", () => {
    // The wrapper sits half a head (4.5px) left of the line: origin 80 puts it at 75.5.
    expect(getTimelinePlayheadTransform(0, 100, 80, 1)).toBe("translateX(76px)");
    expect(getTimelinePlayheadTransform(0, 100, 80, 2)).toBe("translateX(75.5px)");
    expect(getTimelinePlayheadTransform(0.003, 100, 80, 2)).toBe("translateX(76px)");
  });
});
