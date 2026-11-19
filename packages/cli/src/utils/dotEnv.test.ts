import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyDotEnv,
  loadProjectDotEnv,
  noteProjectProviderKey,
  yieldReceivedProviderKeys,
} from "./dotEnv.js";

const records = vi.hoisted(() => ({ unchecked: false }));
vi.mock("./privateProjectFile.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./privateProjectFile.js")>();
  return {
    ...actual,
    receivedRecordStatus: (dir: string) =>
      records.unchecked ? ("unchecked" as const) : actual.receivedRecordStatus(dir),
  };
});

describe("applyDotEnv", () => {
  it("copies a project's keys without overwriting what is already set", () => {
    const env: NodeJS.ProcessEnv = { KEPT: "outer" };
    applyDotEnv('export GEMINI_KEY="abc" # note\nKEPT=inner\n# comment\nPLAIN=x #c', env);
    expect(env).toEqual({ KEPT: "outer", GEMINI_KEY: "abc", PLAIN: "x" });
  });

  it("reads a comment after an empty value as no value", () => {
    const env: NodeJS.ProcessEnv = {};
    applyDotEnv(
      "GEMINI_API_KEY= # paste your key here\nOPENROUTER_API_KEY=\t# later\nHASH=#abc",
      env,
    );
    expect(env).toEqual({ GEMINI_API_KEY: "", OPENROUTER_API_KEY: "", HASH: "#abc" });
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

describe("yieldReceivedProviderKeys", () => {
  const PROVIDER_KEYS = [
    "OPENROUTER_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "HYPERFRAMES_VERTEX_PROJECT_ID",
    "HYPERFRAMES_VERTEX_SERVICE_ACCOUNT",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GCS_CREDS",
  ];
  const dirs: string[] = [];

  afterEach(() => {
    records.unchecked = false;
    vi.unstubAllEnvs();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /** Loads `env` from a project `.env` into process.env over `shell`; `received` lists the `.env` as received. */
  async function load(shell: Record<string, string>, env: string, received: boolean) {
    for (const key of PROVIDER_KEYS) vi.stubEnv(key, shell[key]);
    const dir = mkdtempSync(join(tmpdir(), "hf-dotenv-provider-"));
    dirs.push(dir);
    writeFileSync(join(dir, ".env"), env);
    if (received) {
      mkdirSync(join(dir, ".hyperframes"));
      writeFileSync(
        join(dir, ".hyperframes", "received-files.json"),
        JSON.stringify({ files: [".env"] }),
      );
    }
    const warn = vi.fn();
    loadProjectDotEnv(dir, process.env, vi.fn());
    await yieldReceivedProviderKeys(warn);
    return { dir, warn };
  }

  it("drops a received .env's OpenRouter key when the shell has a Gemini key", async () => {
    const { dir, warn } = await load(
      { GEMINI_API_KEY: "own" },
      "OPENROUTER_API_KEY=received\n",
      true,
    );
    expect(process.env.OPENROUTER_API_KEY).toBeUndefined();
    expect(process.env.GEMINI_API_KEY).toBe("own");
    expect(warn).toHaveBeenCalledWith(
      `[hyperframes] .env: ignoring OPENROUTER_API_KEY from a received project (${join(dir, ".env")}); using your own GEMINI_API_KEY`,
    );
  });

  it("drops received Gemini and Vertex keys when the shell has a Vertex or Google credential", async () => {
    await load(
      {
        HYPERFRAMES_VERTEX_SERVICE_ACCOUNT: "/own/sa.json",
        GOOGLE_APPLICATION_CREDENTIALS: "/own/sa.json",
      },
      "GEMINI_API_KEY=received\nHYPERFRAMES_VERTEX_PROJECT_ID=received\n",
      true,
    );
    expect(process.env.GEMINI_API_KEY).toBeUndefined();
    expect(process.env.HYPERFRAMES_VERTEX_PROJECT_ID).toBeUndefined();
  });

  it("keeps a person's own .env OpenRouter key ahead of their shell Gemini key", async () => {
    const { warn } = await load({ GEMINI_API_KEY: "own" }, "OPENROUTER_API_KEY=mine\n", false);
    expect(process.env.OPENROUTER_API_KEY).toBe("mine");
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps a received .env key when the person has no credential it competes with", async () => {
    const { warn } = await load({}, "OPENROUTER_API_KEY=received\n", true);
    expect(process.env.OPENROUTER_API_KEY).toBe("received");
    expect(warn).not.toHaveBeenCalled();
  });

  it("says the project's origin could not be checked when its folders are too many to scan", async () => {
    records.unchecked = true;
    const { dir, warn } = await load({ GEMINI_API_KEY: "own" }, "OPENROUTER_API_KEY=mine\n", false);
    expect(process.env.OPENROUTER_API_KEY).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      `[hyperframes] .env: ignoring OPENROUTER_API_KEY from a project whose origin could not be checked (too many folders to scan) (${join(dir, ".env")}); using your own GEMINI_API_KEY`,
    );
  });
});

describe("project .env key notes", () => {
  const dirs: string[] = [];
  // Windows refuses control characters in folder names, so there the path is plain.
  const esc = process.platform === "win32" ? "" : String.fromCharCode(27);
  const shown = (dir: string) => join(dir, ".env").replace(esc || "\0", "\\x1b");

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function load(env: Record<string, string>, received: boolean): string {
    for (const name of Object.keys(env)) vi.stubEnv(name, undefined);
    const dir = mkdtempSync(join(tmpdir(), `hf-dotenv-${esc}[31m-`));
    dirs.push(dir);
    writeFileSync(
      join(dir, ".env"),
      Object.entries(env)
        .map(([name, value]) => `${name}=${value}\n`)
        .join(""),
    );
    if (received) {
      mkdirSync(join(dir, ".hyperframes"));
      writeFileSync(
        join(dir, ".hyperframes", "received-files.json"),
        JSON.stringify({ files: [".env"] }),
      );
    }
    loadProjectDotEnv(dir, process.env, vi.fn());
    return dir;
  }

  // fails without the fix: a project key with no competing credential was used silently.
  it("notes a received .env's key once, with the file path escaped", async () => {
    const dir = load({ OPENROUTER_API_KEY: "received" }, true);
    const warn = vi.fn();
    await noteProjectProviderKey("OPENROUTER_API_KEY", "images go there", warn);
    await noteProjectProviderKey("OPENROUTER_API_KEY", "images go there", warn);
    expect(warn.mock.calls).toEqual([
      [
        `[hyperframes] Using OPENROUTER_API_KEY from ${shown(dir)}, a received project: images go there.`,
      ],
    ]);
  });

  it("notes a key from the person's own project .env too", async () => {
    const dir = load({ GEMINI_API_KEY: "mine" }, false);
    const warn = vi.fn();
    await noteProjectProviderKey("GEMINI_API_KEY", "images go there", warn);
    expect(warn).toHaveBeenCalledWith(
      `[hyperframes] Using GEMINI_API_KEY from ${shown(dir)}, a project .env: images go there.`,
    );
  });

  it("says nothing for a key set in the shell", async () => {
    vi.stubEnv("GOOGLE_API_KEY", "shell");
    const warn = vi.fn();
    await noteProjectProviderKey("GOOGLE_API_KEY", "images go there", warn);
    expect(warn).not.toHaveBeenCalled();
  });

  // fails without the fix: the ignoring note printed the folder name's control characters raw.
  it("escapes the path in the note that a received project's key is ignored", async () => {
    vi.stubEnv("GEMINI_API_KEY", "own");
    const dir = load({ OPENROUTER_API_KEY: "received" }, true);
    const warn = vi.fn();
    await yieldReceivedProviderKeys(warn);
    expect(warn).toHaveBeenCalledWith(
      `[hyperframes] .env: ignoring OPENROUTER_API_KEY from a received project (${shown(dir)}); using your own GEMINI_API_KEY`,
    );
  });
});
