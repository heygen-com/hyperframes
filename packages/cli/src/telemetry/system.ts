import { cpus, totalmem, platform, release } from "node:os";
import { existsSync, readFileSync, statfsSync } from "node:fs";
import {
  detectAgentRuntime,
  detectSandboxRuntime,
  type AgentRuntime,
  type SandboxRuntime,
} from "./agent_runtime.js";
import { detectWSL } from "./platform.js";

// ---------------------------------------------------------------------------
// System metadata collected once per CLI session and attached to all events.
// Follows the same patterns as Next.js, Turborepo, and Gatsby telemetry.
// No PII — only hardware/environment characteristics useful for debugging.
// ---------------------------------------------------------------------------

/** Convert bytes to whole megabytes. */
export function bytesToMb(bytes: number): number {
  return Math.trunc(bytes / (1024 * 1024));
}

export interface SystemMeta {
  os_release: string;
  cpu_count: number;
  cpu_model: string | null;
  cpu_speed: number | null;
  memory_total_mb: number;
  is_docker: boolean;
  is_ci: boolean;
  ci_name: string | null;
  is_wsl: boolean;
  is_tty: boolean;
  /**
   * Managed sandbox runtime hosting this invocation, when one is detectable
   * (gvisor / firecracker / docker / kvm / wsl). null on a normal dev
   * machine. Lets us distinguish "real laptop" from "ephemeral cloud
   * sandbox driving the CLI" without geo guesswork.
   */
  sandbox_runtime: SandboxRuntime;
  /**
   * Coding-agent vendor that spawned this process, if any (claude_code,
   * codex, cursor, copilot_agent, replit, hermes, openclaw, pi).
   * Detected by env-var existence only — values are never read. Every rule
   * keys on a marker that has a public-source citation in agent_runtime.ts;
   * unverified guesses are deliberately omitted (false-negative > guess).
   * null when no agent is detected.
   */
  agent_runtime: AgentRuntime;
}

let cached: SystemMeta | null = null;

/**
 * Collect system metadata. Cached after first call.
 * Only includes static values — use `freemem()` directly for volatile readings.
 */
export function getSystemMeta(): SystemMeta {
  if (cached) return cached;

  const cpuInfo = cpus();
  const firstCpu = cpuInfo[0] ?? null;

  cached = {
    os_release: release(),
    cpu_count: cpuInfo.length,
    cpu_model: firstCpu?.model?.trim() ?? null,
    cpu_speed: firstCpu?.speed ?? null,
    memory_total_mb: bytesToMb(totalmem()),
    is_docker: detectDocker(),
    is_ci: detectCI(),
    ci_name: getCIName(),
    is_wsl: detectWSL(),
    is_tty: Boolean(process.stdout?.isTTY),
    sandbox_runtime: detectSandboxRuntime(),
    agent_runtime: detectAgentRuntime(),
  };
  return cached;
}

// ---------------------------------------------------------------------------
// Environment detectors
// ---------------------------------------------------------------------------

function detectDocker(): boolean {
  // Standard detection: /.dockerenv file or "docker" in /proc/1/cgroup
  try {
    if (existsSync("/.dockerenv")) return true;
    if (platform() === "linux") {
      const cgroup = readFileSync("/proc/1/cgroup", "utf-8");
      if (cgroup.includes("docker") || cgroup.includes("containerd")) return true;
    }
  } catch {
    // Ignore — not in Docker
  }
  return false;
}

// Named providers come first so getCIName() picks the most specific match.
// `truthy` accepts 'true' or '1'; `presence` matches any non-null value.
type CIProvider =
  | { name: string | null; envVar: string; mode: "truthy" }
  | { name: string | null; envVar: string; mode: "presence" };

const CI_PROVIDERS: CIProvider[] = [
  { name: "github_actions", envVar: "GITHUB_ACTIONS", mode: "truthy" },
  { name: "gitlab_ci", envVar: "GITLAB_CI", mode: "truthy" },
  { name: "circleci", envVar: "CIRCLECI", mode: "truthy" },
  { name: "jenkins", envVar: "JENKINS_URL", mode: "presence" },
  { name: "buildkite", envVar: "BUILDKITE", mode: "truthy" },
  { name: "travis", envVar: "TRAVIS", mode: "truthy" },
  { name: null, envVar: "CONTINUOUS_INTEGRATION", mode: "truthy" },
  { name: null, envVar: "CI", mode: "truthy" },
];

function matchesProvider(p: CIProvider): boolean {
  const v = process.env[p.envVar];
  if (p.mode === "presence") return v != null;
  return v === "true" || v === "1";
}

function detectCI(): boolean {
  return CI_PROVIDERS.some(matchesProvider);
}

function getCIName(): string | null {
  for (const provider of CI_PROVIDERS) {
    if (provider.name && matchesProvider(provider)) return provider.name;
  }
  return detectCI() ? "unknown" : null;
}

// ---------------------------------------------------------------------------
// Extended hardware checks (for doctor command and detailed render events)
// ---------------------------------------------------------------------------

/**
 * Get /dev/shm size in MB (Linux only). Chrome uses shared memory heavily;
 * Docker's default 64MB limit causes crashes.
 */
export function getShmSizeMb(): number | null {
  if (platform() !== "linux") return null;
  try {
    const stats = statfsSync("/dev/shm");
    return bytesToMb(stats.bsize * stats.blocks);
  } catch {
    return null;
  }
}

/**
 * Get available disk space in MB at a given path.
 */
export function getFreeDiskMb(path: string = "."): number | null {
  try {
    const stats = statfsSync(path);
    return bytesToMb(stats.bsize * stats.bavail);
  } catch {
    return null;
  }
}
