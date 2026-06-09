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
  | "replit"
  | "hermes"
  | "openclaw"
  | "pi"
  | "gemini_managed_agent"
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
  // Anthropic Claude Code — sets CLAUDECODE=1 on every Bash/PowerShell tool
  // spawn (Shell.ts:321) and CLAUDE_CODE_ENTRYPOINT at startup, inherited by
  // every child (main.tsx:527). Both propagate to spawned subprocesses.
  // Source: confirmed by @magi from Claude Code internal source.
  {
    name: "claude_code",
    check: (env) =>
      typeof env["CLAUDECODE"] === "string" || typeof env["CLAUDE_CODE_ENTRYPOINT"] === "string",
  },
  // OpenAI Codex (https://github.com/openai/codex).
  // - CODEX_THREAD_ID — set unconditionally on every spawned shell command
  //   (codex-rs/protocol/src/shell_environment.rs:6 constant, set by
  //   codex-rs/core/src/unified_exec/process_manager.rs:1010 and
  //   codex-rs/core/src/tools/runtimes/mod.rs:164).
  // - CODEX_CI — hardcoded in the UNIFIED_EXEC_ENV array, always set on
  //   every unified-exec child (process_manager.rs:70).
  // - CODEX_SANDBOX_NETWORK_DISABLED — set when network sandbox is active
  //   (codex-rs/core/src/sandboxing/mod.rs:135-138, default-on).
  // CODEX_HOME is deliberately NOT used — it's a config override read at
  // Codex startup, not propagated to spawned subprocesses.
  {
    name: "codex",
    check: (env) =>
      typeof env["CODEX_THREAD_ID"] === "string" ||
      typeof env["CODEX_CI"] === "string" ||
      typeof env["CODEX_SANDBOX_NETWORK_DISABLED"] === "string",
  },
  // Cursor IDE integrated terminal — exports TERM_PROGRAM=cursor.
  // Cursor Background Agent env vars are not publicly documented; if a
  // canonical marker is identified later, add it here.
  {
    name: "cursor",
    check: (env) => env["TERM_PROGRAM"] === "cursor",
  },
  // GitHub Copilot Coding Agent — runs inside GitHub Actions and the
  // workflow injects an additional marker to distinguish from generic CI.
  // Not yet verified from a public-source citation in this audit; the var
  // names below match GitHub Copilot Coding Agent documentation but
  // should be confirmed before relying on attribution.
  {
    name: "copilot_agent",
    check: (env) =>
      env["GITHUB_ACTIONS"] === "true" &&
      (typeof env["COPILOT_AGENT_ID"] === "string" || env["RUNNER_NAME"] === "Copilot"),
  },
  // Replit — REPL_ID and REPLIT_USER are long-documented environment
  // variables exposed inside every Replit workspace.
  // Source: https://docs.replit.com/replit-workspace/configuring-the-environment
  {
    name: "replit",
    check: (env) => typeof env["REPL_ID"] === "string" || typeof env["REPLIT_USER"] === "string",
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
  // Pi coding agent (https://pi.dev, https://github.com/earendil-works/pi).
  // packages/coding-agent/src/cli.ts:13 unconditionally executes
  //   process.env.PI_CODING_AGENT = "true";
  // at module entry, so every subprocess Pi spawns sees this marker.
  {
    name: "pi",
    check: (env) => typeof env["PI_CODING_AGENT"] === "string",
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
 * Returns null on a regular interactive shell. Most rules only check the
 * EXISTENCE of well-known env vars (never their values), but a few agents
 * are best identified by filesystem markers — those run via dedicated
 * detector functions ahead of the env-var rule loop.
 */
export function detectAgentRuntime(): AgentRuntime {
  // Gemini managed agent — keyed on a filesystem mount (`/.agents/AGENTS.md`)
  // with a gVisor guard against false positives. See `isGeminiManagedAgent`
  // for the load-bearing-vs-guard split. Env vars alone are insufficient
  // (`GEMINI_API_KEY` is user-settable), so this runs ahead of VENDOR_RULES.
  if (isGeminiManagedAgent()) return "gemini_managed_agent";
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

/**
 * Gemini managed-agent sandbox — Google's managed runtime that mounts the
 * agent's repo under `/.agents/` (AGENTS.md + skills/ + workspace/) and runs
 * inside a gVisor kernel.
 *
 * Signal hierarchy (the two checks are NOT co-equal):
 *   - `/.agents/AGENTS.md` is the *uniqueness anchor*: definitionally a
 *     managed-agent artifact (the platform injects it per-run; its mtime
 *     tracks the interaction, not the base image). Nothing in the generic
 *     Google-Cloud-on-gVisor universe (Cloud Run gen2, GKE Sandbox) mounts
 *     `/.agents/`. This single check carries essentially all uniqueness.
 *   - `isGVisor()` is a *guard*, not a co-uniqueness signal. gVisor itself
 *     is shared with GKE Sandbox + Cloud Run gen2 — it does not discriminate
 *     Antigravity from those. Its job here is to rule out the unlikely case
 *     of a human creating `/.agents/AGENTS.md` on a non-sandbox host.
 *
 * Things deliberately NOT keyed on (each fails the uniqueness test —
 * shared across the broader Google-Cloud-on-gVisor universe or trivially
 * user-settable on any host):
 *   - gVisor alone
 *   - `Google Compute Engine` DMI (entire GCP reports this)
 *   - `job` cgroup (Google-internal but broadly present)
 *   - egress-proxy env / CA-cert env cluster (any MITM container sets these)
 *   - `/.google/` base-image overlay
 *   - `GEMINI_API_KEY` (user-settable on any host)
 *
 * Source: empirical introspection of live Gemini managed-agent sandboxes by
 * gemini-agent (2026-06-09) — stability verified across 3 independent fresh
 * sandbox spins (spike + `b9db4e56` + `d59d6361`); uniqueness analysis ruled
 * out the corroborating signals above by FS-root + cgroup + netns + DMI +
 * PID-1 introspection.
 */
function isGeminiManagedAgent(): boolean {
  if (platform() !== "linux") return false;
  // The uniqueness anchor: managed-agent platform mount. Nothing else on
  // gVisor (Cloud Run, GKE Sandbox, Fly.io) creates this path.
  if (!existsSync("/.agents/AGENTS.md")) return false;
  // The guard: rule out a stray user-created `/.agents/AGENTS.md` on a
  // non-sandbox host. Not a second uniqueness signal — gVisor isn't unique.
  return isGVisor();
}
