import { existsSync, readFileSync } from "node:fs";
import { platform, release } from "node:os";
import { detectWSL } from "./platform.js";

// ---------------------------------------------------------------------------
// Sandbox runtime + agent vendor fingerprinting.
//
// Goal: distinguish "real developer laptop" from "ephemeral managed sandbox
// driving the CLI on someone's behalf" (Codex Cloud, Claude Code Web, Cursor
// Background Agents, etc.) without collecting any PII.
//
// We only read:
//   - well-known kernel strings (release(), /proc/version)
//   - sandbox marker files (/.dockerenv etc.)
//   - the *existence* of vendor environment variables — never the value
//     (some are API keys).
//
// Output is two opaque strings: sandbox_runtime ('gvisor' | 'docker' | ...)
// and agent_runtime ('claude_code' | 'codex' | ...). Both null when unknown.
// ---------------------------------------------------------------------------

export type SandboxRuntime = "gvisor" | "firecracker" | "docker" | "kvm" | "wsl" | null;

export type AgentRuntime =
  | "claude_code"
  | "codex"
  | "cursor"
  | "copilot_agent"
  | "jules"
  | "replit"
  | "devin"
  | "aider"
  | "gemini_cli"
  | "hermes"
  | "openclaw"
  | null;

interface VendorRule {
  name: Exclude<AgentRuntime, null>;
  /** Check returns true when the named agent is driving the CLI. */
  check: (env: NodeJS.ProcessEnv) => boolean;
}

// Ordering matters: the FIRST rule that matches wins. Put more specific rules
// before more generic ones (e.g. copilot_agent before a hypothetical generic
// 'github_actions' rule).
const VENDOR_RULES: VendorRule[] = [
  // Anthropic Claude Code — local Claude Code spawns subprocesses with
  // CLAUDECODE=1 and an entrypoint marker. Same env vars appear in the
  // Claude Code Web sandbox.
  {
    name: "claude_code",
    check: (env) => env["CLAUDECODE"] === "1" || typeof env["CLAUDE_CODE_ENTRYPOINT"] === "string",
  },
  // OpenAI Codex — Codex CLI and Codex Cloud both set CODEX_HOME, and the
  // managed sandbox additionally sets CODEX_SANDBOX_NETWORK_DISABLED.
  {
    name: "codex",
    check: (env) =>
      typeof env["CODEX_HOME"] === "string" ||
      typeof env["CODEX_SANDBOX"] === "string" ||
      typeof env["CODEX_SANDBOX_NETWORK_DISABLED"] === "string",
  },
  // Cursor IDE + Cursor Background Agents.
  {
    name: "cursor",
    check: (env) =>
      typeof env["CURSOR_TRACE_ID"] === "string" ||
      typeof env["CURSOR_AGENT"] === "string" ||
      env["TERM_PROGRAM"] === "cursor",
  },
  // GitHub Copilot Coding Agent runs inside GitHub Actions, but Copilot's
  // workflow injects an extra marker that distinguishes it from generic CI.
  {
    name: "copilot_agent",
    check: (env) =>
      env["GITHUB_ACTIONS"] === "true" &&
      (typeof env["COPILOT_AGENT_ID"] === "string" || env["RUNNER_NAME"] === "Copilot"),
  },
  // Google Jules.
  {
    name: "jules",
    check: (env) =>
      typeof env["JULES_TASK_ID"] === "string" || typeof env["JULES_SESSION"] === "string",
  },
  // Replit / Replit Agent.
  {
    name: "replit",
    check: (env) => typeof env["REPL_ID"] === "string" || typeof env["REPLIT_USER"] === "string",
  },
  // Devin (Cognition).
  {
    name: "devin",
    check: (env) => typeof env["DEVIN_SESSION_ID"] === "string",
  },
  // Aider.
  {
    name: "aider",
    check: (env) => typeof env["AIDER_RUN_ID"] === "string",
  },
  // Gemini CLI — sets a known env var when invoking shell tools.
  {
    name: "gemini_cli",
    check: (env) => typeof env["GEMINI_CLI"] === "string",
  },
  // Nous Research Hermes Agent — cli.py:50 unconditionally executes
  //   os.environ["HERMES_QUIET"] = "1"
  // at module load, so the marker propagates via os.environ to every
  // subprocess spawned by Hermes. Keying on existence (not the literal
  // "1") so we still match if Hermes ever changes the value.
  // Source: https://github.com/NousResearch/hermes-agent (cli.py:50)
  {
    name: "hermes",
    check: (env) => typeof env["HERMES_QUIET"] === "string",
  },
  // openclaw — multi-channel AI gateway. When openclaw spawns a CLI
  // subprocess it builds the child env with OPENCLAW_STATE_DIR /
  // OPENCLAW_CONFIG_PATH / OPENCLAW_DISABLE_AUTO_UPDATE set explicitly
  // (extensions/qa-matrix/src/runners/contract/scenario-runtime-cli.ts:344-351).
  // We key on OPENCLAW_STATE_DIR since it's a path scope-bound to openclaw.
  // Source: https://github.com/openclaw/openclaw
  {
    name: "openclaw",
    check: (env) =>
      typeof env["OPENCLAW_STATE_DIR"] === "string" ||
      typeof env["OPENCLAW_CONFIG_PATH"] === "string",
  },
];

/**
 * Identify the managed sandbox runtime hosting this CLI invocation.
 * Returns null on a normal developer machine. Dispatches to runtime-specific
 * detectors that each return a boolean; the priority order encoded here is
 * deliberate (WSL > gVisor > Docker > Firecracker > KVM).
 */
export function detectSandboxRuntime(): SandboxRuntime {
  if (platform() === "win32") return null;
  if (detectWSL()) return "wsl";
  if (isGVisor()) return "gvisor";
  if (isDocker()) return "docker";
  if (isFirecracker()) return "firecracker";
  if (isKVM()) return "kvm";
  return null;
}

/**
 * Identify the coding-agent vendor that spawned this process, if any.
 * Returns null on a regular interactive shell. Only checks for the
 * EXISTENCE of well-known env vars — never reads their values.
 */
export function detectAgentRuntime(): AgentRuntime {
  for (const rule of VENDOR_RULES) {
    if (rule.check(process.env)) return rule.name;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sandbox runtime detectors — one per runtime, kept small and side-effect-free.
// ---------------------------------------------------------------------------

/**
 * gVisor reports kernel string `4.19.0-gvisor` (current) or `4.4.0` (legacy
 * Sentry kernel).
 *
 * `4.19.0-gvisor` is unambiguous — no real Linux box reports that string.
 * `4.4.0` collides with Ubuntu 16.04 LTS / older real kernels, so we only
 * accept it as a gVisor signal when /proc/version ALSO contains "gVisor".
 */
function isGVisor(): boolean {
  const kernel = release();
  if (kernel.includes("gvisor")) return true;
  if (platform() !== "linux") return false;
  try {
    const procVersion = readFileSync("/proc/version", "utf-8");
    return procVersion.includes("gVisor");
  } catch {
    return false;
  }
}

function isDocker(): boolean {
  if (existsSync("/.dockerenv")) return true;
  if (platform() !== "linux") return false;
  try {
    const cgroup = readFileSync("/proc/1/cgroup", "utf-8");
    return cgroup.includes("docker") || cgroup.includes("containerd");
  } catch {
    return false;
  }
}

/**
 * AWS Firecracker microVMs expose /dev/vsock and report sys_vendor='Amazon EC2'
 * with product_name containing 'Firecracker'. Full EC2 reports a real instance
 * type like 't3.large', so the product_name check distinguishes them.
 */
function isFirecracker(): boolean {
  if (platform() !== "linux") return false;
  if (!existsSync("/dev/vsock")) return false;
  try {
    const sysVendor = readFileSync("/sys/class/dmi/id/sys_vendor", "utf-8").trim();
    if (sysVendor !== "Amazon EC2") return false;
    const productName = readFileSync("/sys/class/dmi/id/product_name", "utf-8").trim();
    return productName.toLowerCase().includes("firecracker");
  } catch {
    return false;
  }
}

function isKVM(): boolean {
  if (platform() !== "linux") return false;
  try {
    const sysVendor = readFileSync("/sys/class/dmi/id/sys_vendor", "utf-8").trim();
    return sysVendor === "QEMU" || sysVendor.includes("KVM");
  } catch {
    return false;
  }
}
