import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { HINT_KEY_PATTERN } from "./agent_runtime.js";

// agent_runtime.ts reads node:os via release/platform and node:fs for the
// /proc files. detectAgentRuntime is exercised by mutating process.env;
// detectSandboxRuntime is exercised through a small set of node:os mocks.

const VENDOR_ENV_KEYS = [
  "BOBSHELL_CLI",
  "BOBSHELL_API_KEY",
  "BOBSHELL_NO_RELAUNCH",
  "CLAUDECODE",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_ENTRYPOINT",
  "CODEX_THREAD_ID",
  "CODEX_CI",
  "CODEX_SANDBOX_NETWORK_DISABLED",
  "TERM_PROGRAM",
  "CURSOR_AGENT",
  "GITHUB_ACTIONS",
  "COPILOT_AGENT_ID",
  "RUNNER_NAME",
  "REPL_ID",
  "REPLIT_USER",
  "HERMES_QUIET",
  "OPENCLAW_CONFIG_PATH",
  "PI_CODING_AGENT",
  "CLINE_ACTIVE",
  "GEMINI_CLI",
  "CRUSH",
  "COPILOT_AGENT",
  "COPILOT_CLI",
  "COPILOT_AGENT_SESSION_ID",
  "KILO",
  "KILOCODE_VERSION",
  "OPENCODE",
  "OPENCODE_SESSION_ID",
  "QWEN_CODE",
  "JUNIE_SHIM_PATH",
  "ANTIGRAVITY_AGENT",
  "QODER_AGENT",
  "AGENT_DISPLAY_OUT",
  "AGENT_CONTEXT_OUT",
  "CURSOR_CONVERSATION_ID",
  "CURSOR_SANDBOX",
  "CLINE_WRAPPER_PATH",
  "MUSE_RELEASE_INFO",
  "OZ_RUN_ID",
  "DSH_SHELL",
  "AGENT",
  "AI_AGENT",
] as const;

function stripVendorEnv(): void {
  for (const key of VENDOR_ENV_KEYS) delete process.env[key];
  // Ambient session keys would otherwise fill the 16-key hint cap.
  for (const key of Object.keys(process.env)) {
    if (HINT_KEY_PATTERN.test(key.toUpperCase())) delete process.env[key];
  }
}

describe("detectAgentRuntime — base behavior", () => {
  const savedEnv = { ...process.env };
  beforeEach(stripVendorEnv);
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("returns null on a plain shell with no agent markers", async () => {
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBeNull();
  });

  it("first matching vendor wins (rule order)", async () => {
    // Claude Code marker set alongside a Codex marker — Claude Code is the
    // first rule, so it wins.
    process.env["CLAUDE_CODE_CHILD_SESSION"] = "1";
    process.env["CODEX_THREAD_ID"] = "thread-1";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("claude_code");
  });

  it("detects Cursor Agent without an IDE terminal marker", async () => {
    process.env["CURSOR_AGENT"] = "1";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("cursor");
    process.env["CURSOR_AGENT"] = "";
    expect(detectAgentRuntime()).toBeNull();
  });

  it.each([
    ["CLAUDE_CODE_CHILD_SESSION", "claude_code"],
    ["CODEX_THREAD_ID", "codex"],
  ])("keeps child-agent attribution for %s inside Cursor", async (key, runtime) => {
    process.env["CURSOR_AGENT"] = "1";
    process.env[key] = "1";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe(runtime);
  });

  it("keeps the Harbor marker separate from agent attribution and never emits its value", async () => {
    const { detectExecutionHarnessHint, detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectExecutionHarnessHint()).toBeNull();
    process.env["HARBOR_AGENT"] = "private-harness-value";
    expect(detectExecutionHarnessHint()).toBe("harbor");
    expect(detectAgentRuntime()).toBeNull();
    process.env["CLAUDE_CODE_CHILD_SESSION"] = "1";
    expect(detectAgentRuntime()).toBe("claude_code");
    expect(detectExecutionHarnessHint()).toBe("harbor");
  });

  it("never reads env-var values — even API-key-shaped values stay unread", async () => {
    process.env["CODEX_THREAD_ID"] = "thread-1";
    process.env["CODEX_API_KEY"] = "sk-supersecret-DO-NOT-LEAK";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    const result = detectAgentRuntime();
    expect(result).toBe("codex");
    expect(typeof result).toBe("string");
    expect((result ?? "").includes("supersecret")).toBe(false);
  });
});

describe("detectAgentRuntime — IBM Bob Shell", () => {
  const savedEnv = { ...process.env };
  beforeEach(stripVendorEnv);
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("detects via BOBSHELL_CLI (set on both shell execution paths)", async () => {
    process.env["BOBSHELL_CLI"] = "1";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("bob");
  });

  it("wins over inherited outer-agent markers as the immediate executor", async () => {
    process.env["BOBSHELL_CLI"] = "1";
    process.env["CLAUDE_CODE_CHILD_SESSION"] = "1";
    process.env["CODEX_THREAD_ID"] = "thread-1";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("bob");
  });

  it("does not treat Bob authentication or relaunch state as execution proof", async () => {
    process.env["BOBSHELL_API_KEY"] = "secret-not-read";
    process.env["BOBSHELL_NO_RELAUNCH"] = "true";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBeNull();
  });
});

describe("detectAgentRuntime — Claude Code", () => {
  const savedEnv = { ...process.env };
  beforeEach(stripVendorEnv);
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("detects via CLAUDE_CODE_CHILD_SESSION=1", async () => {
    process.env["CLAUDE_CODE_CHILD_SESSION"] = "1";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("claude_code");
  });

  it("detects via CLAUDE_CODE_ENTRYPOINT", async () => {
    process.env["CLAUDE_CODE_ENTRYPOINT"] = "cli";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("claude_code");
  });
});

describe("detectAgentRuntime — OpenAI Codex", () => {
  const savedEnv = { ...process.env };
  beforeEach(stripVendorEnv);
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("detects via CODEX_THREAD_ID (set on every spawned shell command)", async () => {
    process.env["CODEX_THREAD_ID"] = "01234567-89ab-cdef-0123-456789abcdef";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("codex");
  });

  it("detects via CODEX_CI (hardcoded in UNIFIED_EXEC_ENV)", async () => {
    process.env["CODEX_CI"] = "1";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("codex");
  });

  it("detects via CODEX_SANDBOX_NETWORK_DISABLED (default-on)", async () => {
    process.env["CODEX_SANDBOX_NETWORK_DISABLED"] = "1";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("codex");
  });
});

describe("detectAgentRuntime — Cursor / Copilot / cohort", () => {
  const savedEnv = { ...process.env };
  beforeEach(stripVendorEnv);
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("detects Cursor via TERM_PROGRAM=cursor", async () => {
    process.env["TERM_PROGRAM"] = "cursor";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("cursor");
  });

  it("detects Copilot agent mode via COPILOT_AGENT=1 (VS Code agent terminals)", async () => {
    process.env["COPILOT_AGENT"] = "1";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("copilot_agent");
  });

  it("detects Copilot agent mode via AI_AGENT=github_copilot_<surface>", async () => {
    process.env["AI_AGENT"] = "github_copilot_vscode_agent";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("copilot_agent");
  });

  it("no longer reads the unverified Actions markers as copilot_agent", async () => {
    process.env["GITHUB_ACTIONS"] = "true";
    process.env["COPILOT_AGENT_ID"] = "abc123";
    process.env["RUNNER_NAME"] = "Copilot";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBeNull();
  });

  it.each(["COPILOT_CLI", "COPILOT_AGENT_SESSION_ID"])(
    "detects Copilot CLI via %s",
    async (key) => {
      process.env[key] = "1";
      const { detectAgentRuntime } = await import("./agent_runtime.js");
      expect(detectAgentRuntime()).toBe("copilot_cli");
    },
  );

  it("attributes Copilot CLI run from a VS Code agent terminal to the CLI", async () => {
    process.env["COPILOT_AGENT"] = "1";
    process.env["AI_AGENT"] = "github_copilot_vscode_agent";
    process.env["COPILOT_CLI"] = "1";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("copilot_cli");
  });

  it("does NOT flag generic GitHub Actions as copilot_agent", async () => {
    process.env["GITHUB_ACTIONS"] = "true";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBeNull();
  });
});

describe("detectAgentRuntime — Replit / Hermes / openclaw / Pi", () => {
  const savedEnv = { ...process.env };
  beforeEach(stripVendorEnv);
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("detects Replit via REPL_ID", async () => {
    process.env["REPL_ID"] = "repl-1";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("replit");
  });

  it("detects Hermes via HERMES_QUIET (set unconditionally by cli.py:50)", async () => {
    process.env["HERMES_QUIET"] = "1";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("hermes");
  });

  it("detects openclaw via inherited OPENCLAW_CONFIG_PATH", async () => {
    process.env["OPENCLAW_CONFIG_PATH"] = "/tmp/openclaw/openclaw.json";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("openclaw");
  });

  it("detects Pi via PI_CODING_AGENT (set unconditionally by cli.ts:13)", async () => {
    process.env["PI_CODING_AGENT"] = "true";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("pi");
  });
});

describe("detectAgentRuntime — Gemini managed agent", () => {
  // Gemini managed agent is detected via the `/.agents/` platform mount (a
  // DIRECTORY) and the gVisor kernel string, NOT env vars — so these tests
  // mock node:fs statSync and node:os rather than mutating process.env. We key
  // on the `/.agents/` directory (not the optional AGENTS.md file) so
  // skills-only and inline-instruction agents are still detected.
  beforeEach(() => {
    vi.resetModules();
    stripVendorEnv();
  });

  afterEach(() => {
    // Clear the node:os / node:fs doMock registrations so they don't leak into
    // the env-var-only suites that follow (restoreAllMocks does not undo
    // doMock, and those suites don't resetModules in beforeEach).
    vi.doUnmock("node:os");
    vi.doUnmock("node:fs");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  // Mock node:fs so statSync("/.agents") reports a directory; everything else
  // delegates to the real fs.
  const mockAgentsDir = () =>
    vi.doMock("node:fs", async () => {
      const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
      return {
        ...actual,
        statSync: (path: string) =>
          path === "/.agents"
            ? ({ isDirectory: () => true } as unknown as import("node:fs").Stats)
            : actual.statSync(path),
      };
    });

  it("reports gemini_managed_agent when /.agents/ is a directory AND the kernel is gVisor", async () => {
    vi.doMock("node:os", async () => {
      const actual = await vi.importActual<typeof import("node:os")>("node:os");
      return { ...actual, release: () => "4.19.0-gvisor", platform: () => "linux" };
    });
    mockAgentsDir();
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("gemini_managed_agent");
  });

  it("detects a skills-only managed agent (no AGENTS.md) — the generalizability case", async () => {
    // AGENTS.md is OPTIONAL: an agent may use inline `system_instruction` or a
    // skills-only definition and ship no AGENTS.md. Keying on the `/.agents/`
    // directory mount (not the file) must still detect it — the mock makes
    // `/.agents` a directory with no AGENTS.md present.
    vi.doMock("node:os", async () => {
      const actual = await vi.importActual<typeof import("node:os")>("node:os");
      return { ...actual, release: () => "4.19.0-gvisor", platform: () => "linux" };
    });
    mockAgentsDir();
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("gemini_managed_agent");
  });

  it("does NOT report gemini_managed_agent when /.agents/ is absent (even on gVisor)", async () => {
    // A generic gVisor surface (GKE Sandbox / Cloud Run gen2) that doesn't
    // mount the managed-agent layout must fall through to env-var rules.
    vi.doMock("node:os", async () => {
      const actual = await vi.importActual<typeof import("node:os")>("node:os");
      return { ...actual, release: () => "4.19.0-gvisor", platform: () => "linux" };
    });
    vi.doMock("node:fs", async () => {
      const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
      return {
        ...actual,
        statSync: (path: string) => {
          if (path === "/.agents") throw new Error("ENOENT: no such file or directory");
          return actual.statSync(path);
        },
      };
    });
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBeNull();
  });

  it("does NOT report gemini_managed_agent when /.agents/ is a directory but the kernel is not gVisor", async () => {
    // A dev box that happens to have a stray /.agents/ must not false-positive
    // — the gVisor conjunction is what makes the signal safe.
    vi.doMock("node:os", async () => {
      const actual = await vi.importActual<typeof import("node:os")>("node:os");
      return { ...actual, release: () => "6.8.0-100-generic", platform: () => "linux" };
    });
    vi.doMock("node:fs", async () => {
      const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
      return {
        ...actual,
        statSync: (path: string) =>
          path === "/.agents"
            ? ({ isDirectory: () => true } as unknown as import("node:fs").Stats)
            : actual.statSync(path),
        readFileSync: (path: string) =>
          path === "/proc/version"
            ? "Linux version 6.8.0-100-generic (buildd@lcy01)"
            : actual.readFileSync(path),
      };
    });
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBeNull();
  });

  it("returns gemini_managed_agent over an env-var rule when both signals match", async () => {
    // If a user happens to set a Claude Code marker inside a Gemini sandbox (or any
    // odd config), the filesystem+kernel signal wins — Gemini is more
    // specific than a generic env-var marker.
    process.env["CLAUDE_CODE_CHILD_SESSION"] = "1";
    vi.doMock("node:os", async () => {
      const actual = await vi.importActual<typeof import("node:os")>("node:os");
      return { ...actual, release: () => "4.19.0-gvisor", platform: () => "linux" };
    });
    mockAgentsDir();
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("gemini_managed_agent");
  });
});

describe("detectAgentRuntime — Windsurf / Cline / Gemini CLI / Crush", () => {
  const savedEnv = { ...process.env };
  beforeEach(stripVendorEnv);
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("detects Windsurf via TERM_PROGRAM=windsurf", async () => {
    process.env["TERM_PROGRAM"] = "windsurf";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("windsurf");
  });

  it("detects Windsurf case-insensitively (TERM_PROGRAM=Windsurf)", async () => {
    process.env["TERM_PROGRAM"] = "Windsurf";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("windsurf");
  });

  it("detects Cline via CLINE_ACTIVE (default vscode-terminal path)", async () => {
    process.env["CLINE_ACTIVE"] = "true";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("cline");
  });

  it("detects Gemini CLI via GEMINI_CLI", async () => {
    process.env["GEMINI_CLI"] = "1";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("gemini_cli");
  });

  it("detects Crush via CRUSH (set unconditionally on every spawned shell)", async () => {
    process.env["CRUSH"] = "1";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("crush");
  });

  it("does NOT misread the user-set value (existence only) — GEMINI_CLI key shape ignored", async () => {
    process.env["GEMINI_CLI"] = "anything";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("gemini_cli");
  });
});

describe("detectAgentRuntime: Kilo / opencode / Qwen / Junie / Antigravity / Qoder / Kiro / OpenHands", () => {
  const savedEnv = { ...process.env };
  beforeEach(stripVendorEnv);
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it.each([
    ["KILO", "1", "kilo"],
    ["KILOCODE_VERSION", "1.0.0", "kilo"],
    ["OPENCODE", "1", "opencode"],
    ["OPENCODE_SESSION_ID", "ses_1", "opencode"],
    ["QWEN_CODE", "1", "qwen_code"],
    ["JUNIE_SHIM_PATH", "/usr/local/bin/junie", "junie"],
    ["ANTIGRAVITY_AGENT", "1", "antigravity"],
    ["QODER_AGENT", "1", "qoder"],
    ["AGENT_DISPLAY_OUT", "/tmp/display", "kiro"],
    ["AGENT_CONTEXT_OUT", "/tmp/context", "kiro"],
    ["AI_AGENT", "openhands", "openhands"],
  ])("detects %s=%s as %s", async (key, value, runtime) => {
    process.env[key] = value;
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe(runtime);
  });

  it("attributes a Kilo shell to kilo, not the opencode markers it also sets", async () => {
    process.env["KILO"] = "1";
    process.env["OPENCODE"] = "1";
    process.env["AGENT"] = "1";
    process.env["AI_AGENT"] = "opencode";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("kilo");
  });

  it.each(["AGENT_DISPLAY_OUT", "AGENT_CONTEXT_OUT"])(
    "does not treat an empty %s as Kiro",
    async (key) => {
      process.env[key] = "";
      const { detectAgentRuntime } = await import("./agent_runtime.js");
      expect(detectAgentRuntime()).toBeNull();
    },
  );

  it("does not treat an empty QODER_AGENT as an agent", async () => {
    process.env["QODER_AGENT"] = "";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBeNull();
  });

  it("does not treat Kiro's editor terminal (TERM_PROGRAM=kiro) as an agent", async () => {
    process.env["TERM_PROGRAM"] = "kiro";
    const { detectAgentRuntime, isAgentDriven } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBeNull();
    expect(isAgentDriven()).toBe(false);
  });
});

describe("detectAgentRuntime: agents seen in discovery hints", () => {
  const savedEnv = { ...process.env };
  beforeEach(stripVendorEnv);
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it.each([
    ["WORKBUDDY_CLIENT_USER_AGENT", "wb", "workbuddy"],
    ["CODEBUDDY_SESSION_ID", "s", "codebuddy"],
    ["CODEBUDDY_AGENTOS_SESSION_ID", "s", "codebuddy"],
    ["ICUBE_AI_AGENT_SHUTDOWN_TOKEN", "t", "trae"],
    ["TRAE_REMOTE_AGENT_TOKEN", "t", "trae"],
    ["AUTO_PIPPIT_THREAD_ID", "t", "pippit"],
    ["PIPPIT_OBS_AGENT_NAME", "n", "pippit"],
    ["DOUBAO_OFFICE_AGENT_NAME", "n", "doubao"],
    ["AILY_CLI_AGENT_DELIVER_BLOCKED", "1", "aily"],
    ["GROK_SESSION_ID", "s", "grok"],
    ["KIMI_AGENT_CLIENT_ID", "c", "kimi"],
    ["ZCODE_SESSION_ID", "s", "zcode"],
    ["SWE_AGENT_ENV_FILE", "/tmp/env", "swe_agent"],
    ["DSH_SHELL", "1", "dsh"],
    ["CLAUDE_AGENT_SDK_VERSION", "0.2.0", "claude_agent_sdk"],
  ])("detects %s=%s as %s", async (key, value, runtime) => {
    process.env[key] = value;
    const { detectAgentRuntime, isAgentDriven } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe(runtime);
    expect(isAgentDriven()).toBe(true);
  });

  it("attributes WorkBuddy to workbuddy, not the CodeBuddy keys it also carries", async () => {
    process.env["WORKBUDDY_CLIENT_USER_AGENT"] = "wb";
    process.env["CODEBUDDY_SESSION_ID"] = "s";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("workbuddy");
  });

  it("does not treat a person's dsh terminal (DSH_SESSION_ID only) as an agent", async () => {
    process.env["DSH_SESSION_ID"] = "s";
    const { detectAgentRuntime, isAgentDriven } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBeNull();
    expect(isAgentDriven()).toBe(false);
  });

  it.each([
    [{ COPILOT_AGENT: "1", OPENCODE: "1" }, "opencode"],
    [{ AI_AGENT: "github_copilot_vscode_agent", QWEN_CODE: "1" }, "qwen_code"],
    [{ COPILOT_CLI: "1", GEMINI_CLI: "1" }, "gemini_cli"],
    [{ TERM_PROGRAM: "cursor", KILO: "1" }, "kilo"],
    [{ TERM_PROGRAM: "windsurf", CRUSH: "1" }, "crush"],
    [{ REPL_ID: "r", OPENCODE: "1" }, "opencode"],
  ])("lets the agent Copilot or an editor started win: %j -> %s", async (env, runtime) => {
    Object.assign(process.env, env);
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe(runtime);
  });

  it.each([
    [{ TERM_PROGRAM: "cursor", AI_AGENT: "amp" }, "amp"],
    [{ REPL_ID: "r", AGENT: "devin_20261101_agent" }, "devin"],
    [{ TERM_PROGRAM: "windsurf", AI_AGENT: "some-new-agent" }, "other_ai_agent"],
  ])("lets an agent's own name beat the editor or host: %j -> %s", async (env, runtime) => {
    Object.assign(process.env, env);
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe(runtime);
  });

  it("does not treat a Claude IDE extension terminal (CLAUDECODE only) as an agent", async () => {
    process.env["CLAUDECODE"] = "1";
    const { detectAgentRuntime, isAgentDriven } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBeNull();
    expect(isAgentDriven()).toBe(false);
  });

  it.each([
    ["AUGMENT_AGENT", "1", "auggie"],
    ["AMP_CURRENT_THREAD_ID", "T-1", "amp"],
    ["CURSOR_CONVERSATION_ID", "c", "cursor"],
    ["CURSOR_SANDBOX", "native", "cursor"],
    ["CLINE_WRAPPER_PATH", "/usr/lib/cline", "cline"],
    ["MUSE_RELEASE_INFO", "r", "muse"],
    ["OZ_RUN_ID", "run", "warp_oz"],
  ])("detects %s=%s as %s", async (key, value, runtime) => {
    process.env[key] = value;
    const { detectAgentRuntime, isAgentDriven } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe(runtime);
    expect(isAgentDriven()).toBe(true);
  });

  it("lets the harness a Warp Oz run uses win over OZ_RUN_ID", async () => {
    process.env["OZ_RUN_ID"] = "run";
    process.env["CODEX_THREAD_ID"] = "t";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("codex");
  });

  it("lets Claude Code's own shell marker beat the Agent SDK version key", async () => {
    process.env["CLAUDE_CODE_CHILD_SESSION"] = "1";
    process.env["CLAUDE_AGENT_SDK_VERSION"] = "0.2.0";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("claude_code");
  });

  it("lets a vendor marker beat the Agent SDK version key", async () => {
    process.env["CODEBUDDY_SESSION_ID"] = "s";
    process.env["CLAUDE_AGENT_SDK_VERSION"] = "0.2.0";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("codebuddy");
  });
});

describe("detectAgentRuntime: AI_AGENT fallback", () => {
  const savedEnv = { ...process.env };
  beforeEach(stripVendorEnv);
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it.each([
    ["claude-code", "claude_code"],
    ["claude-code_2-1-307_agent", "claude_code"],
    ["opencode", "opencode"],
    ["crush", "crush"],
    ["pi", "pi"],
    ["hermes", "hermes"],
    ["hermes-agent", "hermes"],
    ["github_copilot_app_agent", "copilot_agent"],
    ["antigravity", "antigravity"],
    ["trae", "trae"],
    ["devin_20261101_agent", "devin"],
    ["amp", "amp"],
    ["v0", "v0"],
    ["rovodev_cli", "rovodev"],
    ["base44-superagent", "base44"],
  ])("maps the known AI_AGENT name %s to %s", async (value, runtime) => {
    process.env["AI_AGENT"] = value;
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe(runtime);
  });

  it("classifies an unknown AI_AGENT name as other_ai_agent and as agent-driven", async () => {
    process.env["AI_AGENT"] = "some-new-agent";
    const { detectAgentRuntime, isAgentDriven } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("other_ai_agent");
    expect(isAgentDriven()).toBe(true);
  });

  it("lets a vendor marker beat an inherited AI_AGENT value", async () => {
    process.env["CLAUDE_CODE_CHILD_SESSION"] = "1";
    process.env["AI_AGENT"] = "opencode";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("claude_code");
  });

  it.each(["pilot", "crushed", "constructor"])(
    "does not map %s to a known runtime by a bare prefix",
    async (value) => {
      process.env["AI_AGENT"] = value;
      const { detectAgentRuntime } = await import("./agent_runtime.js");
      expect(detectAgentRuntime()).toBe("other_ai_agent");
    },
  );

  it.each(["", "   ", "sk-ant-api03", "has space in it"])(
    "ignores an empty or unsafe AI_AGENT value %j",
    async (value) => {
      process.env["AI_AGENT"] = value;
      const { detectAgentRuntime, isAgentDriven } = await import("./agent_runtime.js");
      expect(detectAgentRuntime()).toBeNull();
      expect(isAgentDriven()).toBe(false);
    },
  );

  it.each(["1", "true", "some-new-agent"])(
    "does not classify an unknown bare AGENT value %j",
    async (value) => {
      process.env["AGENT"] = value;
      const { detectAgentRuntime, isAgentDriven } = await import("./agent_runtime.js");
      expect(detectAgentRuntime()).toBeNull();
      expect(isAgentDriven()).toBe(false);
    },
  );

  it("maps a known name in the bare AGENT variable", async () => {
    process.env["AGENT"] = "devin_20261101_agent";
    const { detectAgentRuntime, isAgentDriven } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("devin");
    expect(isAgentDriven()).toBe(true);
  });

  it("prefers a known AGENT name over an unknown AI_AGENT name", async () => {
    process.env["AI_AGENT"] = "some-new-agent";
    process.env["AGENT"] = "amp";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("amp");
  });
});

describe("detectAgentHints — new-agent discovery signals", () => {
  const savedEnv = { ...process.env };
  beforeEach(() => {
    stripVendorEnv();
    // stripVendorEnv clears TERM_PROGRAM; also clear the value-captured generics
    // and any hint-shaped keys a test sets so assertions stay deterministic.
    delete process.env["AGENT"];
    delete process.env["AI_AGENT"];
  });
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("reads AGENT as the agent_hint (self-identification convention), lowercased", async () => {
    process.env["AGENT"] = "Crush";
    const { detectAgentHints } = await import("./agent_runtime.js");
    expect(detectAgentHints().agent_hint).toBe("crush");
  });

  it("falls back to AI_AGENT when AGENT is unset", async () => {
    process.env["AI_AGENT"] = "goose";
    const { detectAgentHints } = await import("./agent_runtime.js");
    expect(detectAgentHints().agent_hint).toBe("goose");
  });

  it("prefers the AI_AGENT name over a bare AGENT=1 flag", async () => {
    process.env["AGENT"] = "1";
    process.env["AI_AGENT"] = "some-new-agent";
    const { detectAgentHints } = await import("./agent_runtime.js");
    expect(detectAgentHints().agent_hint).toBe("some-new-agent");
  });

  it("drops an overlong secret-looking AGENT value rather than leaking it", async () => {
    process.env["AGENT"] = "sk-ant-api03-THIS-IS-A-LONG-SECRET-LOOKING-VALUE-xyz";
    const { detectAgentHints } = await import("./agent_runtime.js");
    expect(detectAgentHints().agent_hint).toBeNull();
  });

  // The short-slug allowlist alone accepts these; the credential-shape guard
  // (prefixes + long alnum runs) is what actually enforces the privacy claim.
  it.each([
    ["sk-ant-api03", "token prefix"],
    ["AKIAIOSFODNN7EXAMPLE", "AWS access key id (prefix + long run)"],
    ["github_pat_abc", "GitHub PAT prefix"],
    ["ghp_0123456789abcdef", "GitHub token prefix"],
    ["ya29.a0veryrealtoken", "Google OAuth prefix"],
    ["deadbeefdeadbeef01", "18-char unbroken token body"],
  ])("drops short credential-shaped AGENT value %s (%s)", async (value) => {
    process.env["AGENT"] = value;
    const { detectAgentHints } = await import("./agent_runtime.js");
    expect(detectAgentHints().agent_hint).toBeNull();
  });

  it("still captures a real multi-segment agent name (no over-rejection)", async () => {
    process.env["AGENT"] = "gemini_managed_agent";
    const { detectAgentHints } = await import("./agent_runtime.js");
    expect(detectAgentHints().agent_hint).toBe("gemini_managed_agent");
  });

  it("captures TERM_PROGRAM as the editor/terminal hint", async () => {
    process.env["TERM_PROGRAM"] = "zed";
    const { detectAgentHints } = await import("./agent_runtime.js");
    expect(detectAgentHints().term_program).toBe("zed");
  });

  it("surfaces an unknown agent-ish env KEY in agent_env_hints", async () => {
    process.env["FOO_AGENT_SESSION_ID"] = "whatever-value";
    const { detectAgentHints } = await import("./agent_runtime.js");
    expect(detectAgentHints().agent_env_hints).toContain("FOO_AGENT_SESSION_ID");
  });

  it("keeps specific markers when infrastructure keys exceed the discovery cap", async () => {
    for (let i = 0; i < 20; i++) process.env[`AAA_AGENT_${i}_SERVICE_HOST`] = "private-host";
    process.env["ANTIGRAVITY_AGENT"] = "private-value";
    process.env["CODEBUDDY_SESSION_ID"] = "private-session";
    process.env["HARBOR_AGENT"] = "private-harness";
    const { detectAgentHints } = await import("./agent_runtime.js");
    const hints = detectAgentHints().agent_env_hints ?? "";
    expect(hints.split(",")).toHaveLength(16);
    expect(hints).toContain("ANTIGRAVITY_AGENT");
    expect(hints).toContain("CODEBUDDY_SESSION_ID");
    expect(hints).toContain("HARBOR_AGENT");
    expect(hints).not.toContain("private");
    expect(hints.split(",")).toEqual(hints.split(",").sort());
  });

  it("excludes generic npm and login-session keys", async () => {
    process.env["NPM_CONFIG_USER_AGENT"] = "npm/10";
    process.env["TERM_SESSION_ID"] = "terminal";
    process.env["XDG_SESSION_ID"] = "login";
    const { detectAgentHints } = await import("./agent_runtime.js");
    expect(detectAgentHints().agent_env_hints).toBeNull();
  });

  it("clears a full 16-key ambient cap so a fixture key still fits", async () => {
    for (let i = 0; i < 16; i++) process.env[`AAA_AGENT_${String(i).padStart(2, "0")}`] = "1";
    process.env["FOO_AGENT_SESSION_ID"] = "x";
    stripVendorEnv();
    process.env["FOO_AGENT_SESSION_ID"] = "x";
    const { detectAgentHints } = await import("./agent_runtime.js");
    expect(detectAgentHints().agent_env_hints).toContain("FOO_AGENT_SESSION_ID");
  });

  it("excludes ambient runner, browser and desktop-session keys", async () => {
    process.env["AGENT_TOOLSDIRECTORY"] = "/opt/hostedtoolcache";
    process.env["GSM_SKIP_SSH_AGENT_WORKAROUND"] = "true";
    process.env["EDGE_METRICS_SESSION_ID"] = "session";
    const { detectAgentHints } = await import("./agent_runtime.js");
    expect(detectAgentHints().agent_env_hints).toBeNull();
  });

  it("excludes SSH/GPG agent false-friends from agent_env_hints", async () => {
    process.env["SSH_AGENT_PID"] = "12345";
    const { detectAgentHints } = await import("./agent_runtime.js");
    expect(detectAgentHints().agent_env_hints ?? "").not.toContain("SSH_AGENT");
  });

  it("does NOT match ENCODING keys (PYTHONIOENCODING) — no bare CODING token", async () => {
    process.env["PYTHONIOENCODING"] = "utf-8";
    const { detectAgentHints } = await import("./agent_runtime.js");
    expect(detectAgentHints().agent_env_hints ?? "").not.toContain("ENCODING");
  });
});

describe("detectSandboxRuntime — file-system path", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("reports docker when /.dockerenv exists", async () => {
    vi.doMock("node:os", async () => {
      const actual = await vi.importActual<typeof import("node:os")>("node:os");
      return { ...actual, release: () => "6.8.0-100-generic", platform: () => "linux" };
    });
    vi.doMock("node:fs", async () => {
      const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
      return {
        ...actual,
        existsSync: (path: string) => path === "/.dockerenv" || actual.existsSync(path),
        readFileSync: (path: string) =>
          path === "/proc/version" ? "Linux version 6.8.0-100-generic" : actual.readFileSync(path),
      };
    });
    const { detectSandboxRuntime } = await import("./agent_runtime.js");
    expect(detectSandboxRuntime()).toBe("docker");
  });

  it("returns null on a plain non-sandboxed Linux laptop", async () => {
    vi.doMock("node:os", async () => {
      const actual = await vi.importActual<typeof import("node:os")>("node:os");
      return { ...actual, release: () => "6.8.0-100-generic", platform: () => "linux" };
    });
    vi.doMock("node:fs", async () => {
      const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
      return {
        ...actual,
        existsSync: () => false,
        readFileSync: (path: string) =>
          path === "/proc/version"
            ? "Linux version 6.8.0-100-generic (buildd@lcy01)"
            : path === "/proc/1/cgroup"
              ? "0::/user.slice/user-1000.slice"
              : actual.readFileSync(path),
      };
    });
    const { detectSandboxRuntime } = await import("./agent_runtime.js");
    expect(detectSandboxRuntime()).toBeNull();
  });
});

describe("detectSandboxRuntime — kernel-string path", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("reports gvisor for a 4.19.0-gvisor kernel string", async () => {
    vi.doMock("node:os", async () => {
      const actual = await vi.importActual<typeof import("node:os")>("node:os");
      return { ...actual, release: () => "4.19.0-gvisor", platform: () => "linux" };
    });
    const { detectSandboxRuntime } = await import("./agent_runtime.js");
    expect(detectSandboxRuntime()).toBe("gvisor");
  });

  it("reports gvisor for kernel 4.4.0 only when /proc/version confirms gVisor", async () => {
    vi.doMock("node:os", async () => {
      const actual = await vi.importActual<typeof import("node:os")>("node:os");
      return { ...actual, release: () => "4.4.0", platform: () => "linux" };
    });
    vi.doMock("node:fs", async () => {
      const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
      return {
        ...actual,
        readFileSync: (path: string) =>
          path === "/proc/version" ? "Linux version 4.4.0 (gVisor)" : actual.readFileSync(path),
      };
    });
    const { detectSandboxRuntime } = await import("./agent_runtime.js");
    expect(detectSandboxRuntime()).toBe("gvisor");
  });

  it("does NOT report gvisor for kernel 4.4.0 on a real Ubuntu 16.04 box (no gVisor in /proc/version)", async () => {
    // Ubuntu 16.04 LTS ships kernel 4.4.0 too — make sure we don't false-positive.
    vi.doMock("node:os", async () => {
      const actual = await vi.importActual<typeof import("node:os")>("node:os");
      return { ...actual, release: () => "4.4.0", platform: () => "linux" };
    });
    vi.doMock("node:fs", async () => {
      const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
      return {
        ...actual,
        readFileSync: (path: string) =>
          path === "/proc/version"
            ? "Linux version 4.4.0-1128-aws (buildd@lcy01)"
            : actual.readFileSync(path),
      };
    });
    const { detectSandboxRuntime } = await import("./agent_runtime.js");
    expect(detectSandboxRuntime()).not.toBe("gvisor");
  });
});

describe("isAgentDriven", () => {
  it.each([
    [{ CLAUDE_CODE_CHILD_SESSION: "1" }, true],
    [{ CODEX_THREAD_ID: "t" }, true],
    [{ CURSOR_AGENT: "1", TERM_PROGRAM: "cursor" }, true],
    [{ TERM_PROGRAM: "cursor" }, false],
    [{ TERM_PROGRAM: "windsurf" }, false],
    [{ REPL_ID: "r" }, false],
    [{ REPLIT_USER: "u" }, false],
    [{ COPILOT_AGENT: "1" }, true],
    [{ COPILOT_CLI: "1" }, true],
    [{ KILO: "1" }, true],
    [{ AGENT_DISPLAY_OUT: "/tmp/d" }, true],
    [{ AI_AGENT: "some-new-agent" }, true],
    [{ TERM_PROGRAM: "kiro" }, false],
    [{ AGENT: "1" }, false],
    [{}, false],
  ])("%j -> %s", async (env, expected) => {
    const { isAgentDriven } = await import("./agent_runtime.js");
    expect(isAgentDriven(env)).toBe(expected);
  });
});
