import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

// agent_runtime.ts reads node:os via release/platform and node:fs for the
// /proc files. detectAgentRuntime is exercised by mutating process.env;
// detectSandboxRuntime is exercised through a small set of node:os mocks.

const VENDOR_ENV_KEYS = [
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CODEX_HOME",
  "CODEX_SANDBOX",
  "CODEX_SANDBOX_NETWORK_DISABLED",
  "CURSOR_TRACE_ID",
  "CURSOR_AGENT",
  "TERM_PROGRAM",
  "GITHUB_ACTIONS",
  "COPILOT_AGENT_ID",
  "RUNNER_NAME",
  "JULES_TASK_ID",
  "JULES_SESSION",
  "REPL_ID",
  "REPLIT_USER",
  "DEVIN_SESSION_ID",
  "AIDER_RUN_ID",
  "GEMINI_CLI",
  "HERMES_QUIET",
  "_HERMES_GATEWAY",
  "HERMES_INFERENCE_PROVIDER",
  "OPENCLAW_CLI",
  "OPENCLAW_STATE_DIR",
  "OPENCLAW_CONFIG_PATH",
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
    process.env["CODEX_HOME"] = "/home/codex";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("claude_code");
  });

  it("never reads env-var values — even API-key-shaped values stay unread", async () => {
    process.env["CODEX_HOME"] = "/home/codex";
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

  it("detects via CODEX_HOME", async () => {
    process.env["CODEX_HOME"] = "/home/codex";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("codex");
  });

  it("detects via CODEX_SANDBOX_NETWORK_DISABLED", async () => {
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

describe("detectAgentRuntime — Jules / Replit / Devin / Hermes / openclaw", () => {
  const savedEnv = { ...process.env };
  beforeEach(stripVendorEnv);
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("detects Jules via JULES_TASK_ID", async () => {
    process.env["JULES_TASK_ID"] = "task-1";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("jules");
  });

  it("detects Replit via REPL_ID", async () => {
    process.env["REPL_ID"] = "repl-1";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("replit");
  });

  it("detects Devin via DEVIN_SESSION_ID", async () => {
    process.env["DEVIN_SESSION_ID"] = "sess-1";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("devin");
  });

  it("detects Hermes via HERMES_QUIET=1 (set unconditionally by cli.py)", async () => {
    process.env["HERMES_QUIET"] = "1";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("hermes");
  });

  it("detects openclaw via inherited OPENCLAW_STATE_DIR", async () => {
    process.env["OPENCLAW_STATE_DIR"] = "/tmp/openclaw";
    const { detectAgentRuntime } = await import("./agent_runtime.js");
    expect(detectAgentRuntime()).toBe("openclaw");
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
