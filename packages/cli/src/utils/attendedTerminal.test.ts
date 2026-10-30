import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `driven: undefined` runs the real detection against process.env.
const agent = vi.hoisted(() => ({ driven: false as boolean | undefined }));
vi.mock("../telemetry/agent_runtime.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../telemetry/agent_runtime.js")>();
  return { ...actual, isAgentDriven: () => agent.driven ?? actual.isAgentDriven() };
});

const ttys = { stdin: process.stdin.isTTY, stdout: process.stdout.isTTY };

function setTty(stdin: boolean, stdout: boolean): void {
  Object.defineProperty(process.stdin, "isTTY", { value: stdin, configurable: true });
  Object.defineProperty(process.stdout, "isTTY", { value: stdout, configurable: true });
}

async function load() {
  vi.resetModules();
  return import("./attendedTerminal.js");
}

describe("isCI", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ["true", true],
    ["1", true],
    ["github-actions", true],
    ["false", false],
    ["0", false],
    ["", false],
  ])("CI=%j is CI: %s", async (value, expected) => {
    vi.stubEnv("CI", value);
    expect((await load()).isCI()).toBe(expected);
  });
});

describe("isUnattended", () => {
  beforeEach(() => {
    vi.stubEnv("CI", "");
    vi.stubEnv("HYPERFRAMES_AGENT", "");
    agent.driven = false;
    setTty(true, true);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    setTty(ttys.stdin === true, ttys.stdout === true);
  });

  it("is attended at a terminal with no CI and no agent", async () => {
    expect((await load()).isUnattended()).toBe(false);
  });

  it.each([
    [false, true],
    [true, false],
  ])("is unattended when stdin is a TTY: %s, stdout is a TTY: %s", async (stdin, stdout) => {
    setTty(stdin, stdout);
    expect((await load()).isUnattended()).toBe(true);
  });

  it("is unattended in CI", async () => {
    vi.stubEnv("CI", "buildkite");
    expect((await load()).isUnattended()).toBe(true);
  });

  it("is unattended when a coding agent is detected", async () => {
    agent.driven = true;
    expect((await load()).isUnattended()).toBe(true);
  });

  it.each([
    ["TERM_PROGRAM", "cursor"],
    ["TERM_PROGRAM", "windsurf"],
    ["REPL_ID", "abc"],
  ])(
    "a person in an editor or hosted terminal (%s=%s) at a TTY is attended",
    async (name, value) => {
      for (const key of Object.keys(process.env)) {
        if (
          /^(CLAUDE|CODEX_|CURSOR_|BOBSHELL|GEMINI_CLI|CLINE_|HERMES_|PI_CODING|CRUSH|OPENCLAW)/.test(
            key,
          )
        ) {
          vi.stubEnv(key, undefined);
        }
      }
      vi.stubEnv(name, value);
      agent.driven = undefined;
      expect((await load()).isUnattended()).toBe(false);
    },
  );

  it("Cursor's agent shell is unattended", async () => {
    vi.stubEnv("CURSOR_AGENT", "1");
    agent.driven = undefined;
    expect((await load()).isUnattended()).toBe(true);
  });

  it("is unattended with HYPERFRAMES_AGENT=1", async () => {
    vi.stubEnv("HYPERFRAMES_AGENT", "1");
    expect((await load()).isUnattended()).toBe(true);
  });
});
