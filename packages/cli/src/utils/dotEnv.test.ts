import { describe, expect, it } from "vitest";
import { applyDotEnv } from "./dotEnv.js";

describe("applyDotEnv", () => {
  it("copies a project's keys without overwriting what is already set", () => {
    const env: NodeJS.ProcessEnv = { KEPT: "outer" };
    applyDotEnv('export GEMINI_KEY="abc" # note\nKEPT=inner\n# comment\nPLAIN=x #c', env);
    expect(env).toEqual({ KEPT: "outer", GEMINI_KEY: "abc", PLAIN: "x" });
  });

  it("never takes the feedback email from a project file", () => {
    const env: NodeJS.ProcessEnv = {};
    applyDotEnv("HYPERFRAMES_FEEDBACK_EMAIL=someone@example.com\nOTHER=1", env);
    expect(env).toEqual({ OTHER: "1" });
  });

  it("never takes the feedback email under another letter case", () => {
    const env: NodeJS.ProcessEnv = {};
    applyDotEnv(
      "hyperframes_feedback_email=a@example.com\nHyperFrames_Feedback_Email=b@example.com\nOTHER=1",
      env,
    );
    expect(env).toEqual({ OTHER: "1" });
  });
});
