import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

// agent_runtime.ts reads node:os via release/platform and node:fs for the
// /proc files. detectAgentRuntime is exercised by mutating process.env;
// detectSandboxRuntime is exercised through a small set of node:os mocks.

const VENDOR_ENV_KEYS = [
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CODEX_THREAD_ID",
  "CODEX_CI",
  "CODEX_SANDBOX_NETWORK_DISABLED",
  "TERM_PROGRAM",
  "GITHUB_ACTIONS",
  "COPILOT_AGENT_ID",
  "RUNNER_NAME",
  "REPL_ID",
  "REPLIT_USER",
  "HERMES_QUIET",
  "OPENCLAW_STATE_DIR",
  "OPENCLAW_CONFIG_PATH",
  "PI_CODING_AGENT",
  "CLINE_ACTIVE",
  "GEMINI_CLI",
  "CRUSH",
] as const;

function stripVendorEnv(): void {
  for (const key of VENDOR_ENV_KEYS) delete process.env[key];
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
    process.env["CLAUDECODE"] = "1";
    process.env["CODEX_THREAD_ID"] = "thread-1";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("claude_code");
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

describe("detectAgentRuntime — Claude Code", () => {
  const savedEnv = { ...process.env };
  beforeEach(stripVendorEnv);
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("detects via CLAUDECODE=1", async () => {
    process.env["CLAUDECODE"] = "1";
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

  it("detects Copilot Coding Agent via GITHUB_ACTIONS + COPILOT_AGENT_ID", async () => {
    process.env["GITHUB_ACTIONS"] = "true";
    process.env["COPILOT_AGENT_ID"] = "abc123";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("copilot_agent");
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

  it("detects openclaw via inherited OPENCLAW_STATE_DIR", async () => {
    process.env["OPENCLAW_STATE_DIR"] = "/tmp/openclaw";
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
    // If a user happens to set CLAUDECODE=1 inside a Gemini sandbox (or any
    // odd config), the filesystem+kernel signal wins — Gemini is more
    // specific than a generic env-var marker.
    process.env["CLAUDECODE"] = "1";
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
