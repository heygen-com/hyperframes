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

  it("names the last check's exit code and top error codes", () => {
    const keys = buildTelemetryJoinKeys({
      feedbackId: "f",
      anonymousId: "t",
      lastCheck: { at: "", exitCode: 1, codes: { text_overlap: 4, contrast_low: 1 } },
    });
    expect(keys).toBe("fid=f tid=t check=exit1:text_overlap*4,contrast_low*1");
  });

  it("says unfinished when the last check never reported an exit code", () => {
    const keys = buildTelemetryJoinKeys({
      feedbackId: "f",
      anonymousId: "t",
      lastCheck: { at: "", codes: {} },
    });
    expect(keys).toBe("fid=f tid=t check=unfinished");
  });

  it("says how many minutes ago the last check ran, so one from another project is spotted", () => {
    const keys = buildTelemetryJoinKeys({
      feedbackId: "f",
      anonymousId: "t",
      lastCheck: { at: "2026-10-29T10:00:00.000Z", exitCode: 1, codes: { text_overlap: 4 } },
      now: Date.parse("2026-10-29T10:12:30.000Z"),
    });
    expect(keys).toBe("fid=f tid=t check=exit1:text_overlap*4 check_age=13m");
  });

  it("says only the exit code when the last check had no error codes", () => {
    const keys = buildTelemetryJoinKeys({
      feedbackId: "f",
      anonymousId: "t",
      lastCheck: { at: "", exitCode: 0, codes: {} },
    });
    expect(keys).toBe("fid=f tid=t check=exit0");
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

  it("still fits the env cap with a full ring and three long error codes", () => {
    const uuid = "01234567-89ab-cdef-0123-456789abcdef";
    const code = "x".repeat(60);
    const keys = buildTelemetryJoinKeys({
      feedbackId: uuid,
      anonymousId: uuid,
      recentRenders: Array.from({ length: 5 }, () => ({ id: uuid, at: "", ok: true })),
      lastCheck: {
        at: "",
        exitCode: 1,
        codes: { [code + "a"]: 9, [code + "b"]: 8, [code + "c"]: 7 },
      },
    });
    expect(keys.length).toBeLessThan(500 - 100);
  });
});
