import { describe, expect, it } from "vitest";

import { FEEDBACK_RATING_SCALE, parseFeedbackRating } from "./feedbackRating.js";

describe("parseFeedbackRating", () => {
  it.each(["0", "10"])("accepts the NPS boundary %s", (raw) => {
    expect(parseFeedbackRating(raw)).toBe(Number(raw));
  });

  it.each(["-1", "11", "4.5", "10x", ""])("rejects invalid rating %j", (raw) => {
    expect(parseFeedbackRating(raw)).toBeNull();
  });

  it("declares the serialized rating scale", () => {
    expect(FEEDBACK_RATING_SCALE).toBe(10);
  });
});
