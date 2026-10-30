import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyDotEnv, loadProjectDotEnv } from "./dotEnv.js";

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

describe("loadProjectDotEnv", () => {
  const projectWith = (content: string): string => {
    const dir = mkdtempSync(join(tmpdir(), "hf-dotenv-"));
    writeFileSync(join(dir, ".env"), content);
    return dir;
  };

  it("sets the CLI's own settings and ignores every other key, naming them once", () => {
    const dir = projectWith(
      "GEMINI_API_KEY=abc\nNODE_OPTIONS=--require ./x.js\nHTTPS_PROXY=http://example.test\nNODE_OPTIONS=again\n",
    );
    try {
      const env: NodeJS.ProcessEnv = {};
      const warn = vi.fn();
      loadProjectDotEnv(dir, env, warn);
      expect(env).toEqual({ GEMINI_API_KEY: "abc" });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain("NODE_OPTIONS, HTTPS_PROXY");
      expect(warn.mock.calls[0]?.[0]).not.toContain("example.test");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps a telemetry opt-out from the project .env", () => {
    const dir = projectWith("HYPERFRAMES_NO_TELEMETRY=1\nDO_NOT_TRACK=1\n");
    try {
      const env: NodeJS.ProcessEnv = {};
      loadProjectDotEnv(dir, env, vi.fn());
      expect(env).toEqual({ HYPERFRAMES_NO_TELEMETRY: "1", DO_NOT_TRACK: "1" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("says nothing when every key is one the CLI reads, or there is no .env", () => {
    const dir = projectWith("OPENROUTER_API_KEY=k\n");
    try {
      const warn = vi.fn();
      loadProjectDotEnv(dir, {}, warn);
      loadProjectDotEnv(join(dir, "missing"), {}, warn);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
