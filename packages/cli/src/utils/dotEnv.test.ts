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

  it("copies only exact allowed names when a caller limits the imported settings", () => {
    const env: NodeJS.ProcessEnv = { GEMINI_API_KEY: "inherited" };
    applyDotEnv(
      "GEMINI_API_KEY=project\nGOOGLE_API_KEY=allowed\ngoogle_api_key=other\nPATH=/untrusted\nLD_PRELOAD=payload",
      env,
      ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    );
    expect(env).toEqual({ GEMINI_API_KEY: "inherited", GOOGLE_API_KEY: "allowed" });
  });

  it("an allowlist cannot opt the feedback email back in", () => {
    const env: NodeJS.ProcessEnv = {};
    applyDotEnv("HyperFrames_Feedback_Email=private", env, ["HyperFrames_Feedback_Email"]);
    expect(env).toEqual({});
  });

  it("an empty allowlist imports nothing", () => {
    const env: NodeJS.ProcessEnv = {};
    applyDotEnv("GEMINI_API_KEY=project", env, []);
    expect(env).toEqual({});
  });
});

describe("applyDotEnv quoted multiline values", () => {
  it("keeps a quoted multiline value whole instead of truncating it to its first line", () => {
    const env: NodeJS.ProcessEnv = {};
    applyDotEnv(
      "HYPERFRAMES_VERTEX_PROJECT_ID=synthetic-project\n" +
        "HYPERFRAMES_VERTEX_SERVICE_ACCOUNT='{\n" +
        '  "type": "service_account",\n' +
        '  "project_id": "synthetic-project"\n' +
        "}'\n" +
        "AFTER=still-parsed",
      env,
    );
    expect(env.HYPERFRAMES_VERTEX_SERVICE_ACCOUNT).toBe(
      '{\n  "type": "service_account",\n  "project_id": "synthetic-project"\n}',
    );
    expect(() => JSON.parse(env.HYPERFRAMES_VERTEX_SERVICE_ACCOUNT!)).not.toThrow();
    expect(env.AFTER).toBe("still-parsed");
  });

  it("a commented-out example with an unclosed quote does not swallow the real keys below it", () => {
    const env: NodeJS.ProcessEnv = {};
    applyDotEnv('# OPENROUTER_API_KEY="sk-old\nGEMINI_API_KEY=real1\nGOOGLE_API_KEY=real2', env);
    expect(env).toEqual({ GEMINI_API_KEY: "real1", GOOGLE_API_KEY: "real2" });
  });

  it("a stray unclosed quote with no later closing line does not swallow the rest of the file", () => {
    const env: NodeJS.ProcessEnv = {};
    applyDotEnv("A='x\nB=2", env);
    expect(env).toEqual({ A: "x", B: "2" });
  });

  it("strips the trailing \\r from a CRLF multiline value", () => {
    const env: NodeJS.ProcessEnv = {};
    applyDotEnv("KEY='line1\r\nline2'\r\nAFTER=2", env);
    expect(env.KEY).toBe("line1\nline2");
    expect(env.AFTER).toBe("2");
  });
});
