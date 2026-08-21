import { describe, expect, it } from "vitest";
import { buildTelemetryJoinKeys } from "./feedback.js";

describe("buildTelemetryJoinKeys", () => {
  it("emits fid + tid and omits renders when the ring is empty", () => {
    const keys = buildTelemetryJoinKeys({
      feedbackId: "feedback-uuid",
      anonymousId: "install-uuid",
    });
    expect(keys).toBe("fid=feedback-uuid tid=install-uuid");
  });

  it("appends recent render ids newest-last with a ! marking failed renders", () => {
    const keys = buildTelemetryJoinKeys({
      feedbackId: "f",
      anonymousId: "t",
      recentRenders: [
        { id: "render-a", at: "2026-07-21T00:00:00Z", ok: true },
        { id: "render-b", at: "2026-07-21T01:00:00Z", ok: false },
      ],
    });
    expect(keys).toBe("fid=f tid=t renders=render-a,render-b!");
  });

  it("stays within the backend env cap for a full ring of uuid render ids", () => {
    const uuid = "01234567-89ab-cdef-0123-456789abcdef";
    const keys = buildTelemetryJoinKeys({
      feedbackId: uuid,
      anonymousId: uuid,
      recentRenders: Array.from({ length: 5 }, (_, i) => ({
        id: uuid,
        at: "2026-07-21T00:00:00Z",
        ok: i % 2 === 0,
      })),
    });
    // submitFeedback caps env at 500 chars; the doctor summary consumes ~100.
    expect(keys.length).toBeLessThan(400);
  });
});
