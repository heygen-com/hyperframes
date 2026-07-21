import { describe, expect, it } from "vitest";
import {
  timelineKeyframeSelectionKey,
  timelineKeyframeTargetFromSelectionKey,
} from "./timelineKeyframeIdentity";

describe("timeline keyframe selection identity", () => {
  it("round-trips an expanded lane with colon-bearing identities", () => {
    const key = timelineKeyframeSelectionKey("comp#a:child", {
      percentage: 75,
      tweenPercentage: 40,
      propertyGroup: "position",
      animationId: "child:position",
    });

    expect(timelineKeyframeTargetFromSelectionKey("comp#a:child", key)).toEqual({
      percentage: 75,
      tweenPercentage: 40,
      propertyGroup: "position",
      animationId: "child:position",
    });
  });

  it("does not confuse an expanded lane whose element id extends the active id", () => {
    const key = timelineKeyframeSelectionKey("comp#a:child", {
      percentage: 75,
      tweenPercentage: 40,
      propertyGroup: "position",
      animationId: "child-position",
    });

    expect(timelineKeyframeTargetFromSelectionKey("comp#a", key)).toBeNull();
  });

  it("retains the collapsed key fallback and rejects malformed percentages", () => {
    expect(timelineKeyframeTargetFromSelectionKey("comp#a", "comp#a:30")).toEqual({
      percentage: 30,
    });
    expect(timelineKeyframeTargetFromSelectionKey("comp#a", "comp#a:NaN")).toBeNull();
    expect(timelineKeyframeTargetFromSelectionKey("comp#a", "comp#b:30")).toBeNull();
  });
});
