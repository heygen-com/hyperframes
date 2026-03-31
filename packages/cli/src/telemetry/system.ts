import { cpus, totalmem, platform, release } from "node:os";
import { existsSync, readFileSync, statfsSync } from "node:fs";

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

function detectCI(): boolean {
  return (
    process.env["CI"] === "true" ||
    process.env["CI"] === "1" ||
    process.env["CONTINUOUS_INTEGRATION"] === "true" ||
    process.env["GITHUB_ACTIONS"] === "true" ||
    process.env["GITLAB_CI"] === "true" ||
    process.env["CIRCLECI"] === "true" ||
    process.env["JENKINS_URL"] != null ||
    process.env["BUILDKITE"] === "true" ||
    process.env["TRAVIS"] === "true" ||
    false
  );
}

function getCIName(): string | null {
  if (process.env["GITHUB_ACTIONS"] === "true") return "github_actions";
  if (process.env["GITLAB_CI"] === "true") return "gitlab_ci";
  if (process.env["CIRCLECI"] === "true") return "circleci";
  if (process.env["JENKINS_URL"] != null) return "jenkins";
  if (process.env["BUILDKITE"] === "true") return "buildkite";
  if (process.env["TRAVIS"] === "true") return "travis";
  if (detectCI()) return "unknown";
  return null;
}

function detectWSL(): boolean {
  if (platform() !== "linux") return false;
  try {
    const osRelease = release().toLowerCase();
    if (osRelease.includes("microsoft") || osRelease.includes("wsl")) return true;
    const procVersion = readFileSync("/proc/version", "utf-8").toLowerCase();
    return procVersion.includes("microsoft") || procVersion.includes("wsl");
  } catch {
    return false;
  }
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
