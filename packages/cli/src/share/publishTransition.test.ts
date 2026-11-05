import { describe, expect, it } from "vitest";
import { publishPhase, publishTransitionDecision } from "./publishTransition.js";
describe("announced 60-day publish transition", () => {
  const start = "2027-01-01T00:00:00.000Z";
  const day = 86_400_000;
  it("never starts the clock from approval or installation", () => {
    expect(publishPhase(null, Date.parse(start) + 365 * day)).toBe("unscheduled");
    expect(publishPhase(start, Date.parse(start) - 1)).toBe("unscheduled");
  });
  it("preserves exactly sixty days and guides only after the boundary", () => {
    expect(publishPhase(start, Date.parse(start))).toBe("compatibility");
    expect(publishPhase(start, Date.parse(start) + 60 * day - 1)).toBe("compatibility");
    expect(publishPhase(start, Date.parse(start) + 60 * day)).toBe("share");
  });
  it("retains legacy updates after the new-project transition", () => {
    expect(publishTransitionDecision("share", true)).toBe("keep_legacy");
    expect(publishTransitionDecision("share", false)).toBe("guide_to_share");
    expect(publishTransitionDecision("compatibility", false)).toBe("keep_legacy");
  });
  it("fails on an invalid scheduled date rather than silently switching behavior", () => {
    expect(() => publishPhase("invalid")).toThrow("timestamp");
  });
});
