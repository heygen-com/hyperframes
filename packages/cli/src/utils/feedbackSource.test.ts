import { describe, expect, it } from "vitest";
import { feedbackEmail, parseFeedbackSource } from "./feedbackSource.js";

describe("parseFeedbackSource", () => {
  it.each([
    [undefined, undefined],
    ["person", "person"],
    [" agent ", "agent"],
    ["Person", null],
    ["", null],
  ])("%j reads as %j", (raw, expected) => {
    expect(parseFeedbackSource(raw)).toBe(expected);
  });
});

describe("feedbackEmail", () => {
  it("reads only HYPERFRAMES_FEEDBACK_EMAIL, trimmed, and nothing when blank", () => {
    expect(feedbackEmail({ HYPERFRAMES_FEEDBACK_EMAIL: " a@b.co " })).toBe("a@b.co");
    expect(feedbackEmail({ HYPERFRAMES_FEEDBACK_EMAIL: "  " })).toBeUndefined();
    expect(feedbackEmail({ EMAIL: "a@b.co" })).toBeUndefined();
  });
});
