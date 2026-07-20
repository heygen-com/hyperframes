import { describe, expect, it } from "vitest";
import { parseFeedbackRating } from "../telemetry/rating.js";

describe("parseRating", () => {
  it("accepts the full 1–10 satisfaction scale", () => {
    expect(parseFeedbackRating("1")).toBe(1);
    expect(parseFeedbackRating("10")).toBe(10);
  });

  it("rejects values outside the satisfaction scale", () => {
    expect(parseFeedbackRating("0")).toBeNull();
    expect(parseFeedbackRating("11")).toBeNull();
  });
});
