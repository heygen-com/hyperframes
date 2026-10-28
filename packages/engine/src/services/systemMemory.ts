/**
 * System memory and CPU probing for resource-adaptive render behaviour.
 *
 * The render pipeline tunes itself to the host's RAM in several places —
 * frame-cache sizes (`config.ts`), Chrome heap + GPU budget flags
 * (`browserManager.ts`), and worker count (`parallelCoordinator.ts`).
 * They all need the same "how much memory does this box have" reading, so
 * it lives here once instead of being re-derived inline. The CPU count gets
 * the same treatment: a container's CPU quota, not the host's cores.
 */

import { execSync } from "child_process";
import { readFileSync } from "fs";
import { availableParallelism, freemem, platform, totalmem } from "os";

const BYTES_PER_MIB = 1024 * 1024;
const BYTES_PER_MIB_BIGINT = BigInt(BYTES_PER_MIB);
// These are the paths as seen from INSIDE a container, where the runtime
// mounts the container's own cgroup at the namespace root — the case this
// probe exists for. They are deliberately not resolved via /proc/self/cgroup:
// on a bare host under systemd the process's real limit may live in a nested
// slice (e.g. /sys/fs/cgroup/user.slice/.../memory.max) that these root paths
// don't see, and that's acceptable — bare hosts are covered by total-RAM
// detection, and chasing nested slices adds fragility for no container gain.
const CGROUP_V2_MEMORY_MAX_PATH = "/sys/fs/cgroup/memory.max";
const CGROUP_V1_MEMORY_LIMIT_PATH = "/sys/fs/cgroup/memory/memory.limit_in_bytes";
const CGROUP_V2_CPU_MAX_PATH = "/sys/fs/cgroup/cpu.max";
const CGROUP_V1_CPU_QUOTA_PATH = "/sys/fs/cgroup/cpu/cpu.cfs_quota_us";
const CGROUP_V1_CPU_PERIOD_PATH = "/sys/fs/cgroup/cpu/cpu.cfs_period_us";
// Kernel no-limit sentinel is page-rounded 2^63-1 (~9223372036854771712); >= 2^60 is implausible as a real limit.
const CGROUP_V1_NO_LIMIT_CUTOFF_BYTES = 2n ** 60n;

let _cachedCgroupLimitMb: number | null | undefined;
let _cachedCgroupCpuLimit: number | null | undefined;
let _warnedCgroupReadFailure = false;

/** Parse cgroup v2/v1 memory limits from sysfs file contents into MiB. */
export function parseCgroupLimitMb(
  v2Content: string | null,
  v1Content: string | null,
): number | null {
  if (v2Content !== null) {
    return parseCgroupV2LimitMb(v2Content);
  }

  return parseCgroupV1LimitMb(v1Content);
}

function parseCgroupV2LimitMb(content: string): number | null {
  const trimmed = content.trim();
  if (trimmed === "max") {
    return null;
  }

  return parsePositiveByteLimitMb(trimmed);
}

function parseCgroupV1LimitMb(content: string | null): number | null {
  if (content === null) {
    return null;
  }

  return parsePositiveByteLimitMb(content.trim(), CGROUP_V1_NO_LIMIT_CUTOFF_BYTES);
}

function parsePositiveByteLimitMb(content: string, noLimitCutoffBytes?: bigint): number | null {
  if (!/^\d+$/.test(content)) {
    return null;
  }

  const bytes = BigInt(content);
  if (bytes <= 0n) {
    return null;
  }

  if (noLimitCutoffBytes !== undefined && bytes >= noLimitCutoffBytes) {
    return null;
  }

  return Number(bytes / BYTES_PER_MIB_BIGINT);
}

/**
 * Whole CPUs a cgroup v2 `cpu.max` or v1 `cfs_quota_us`/`cfs_period_us` quota grants, at least 1,
 * or null when there is no quota.
 */
export function parseCgroupCpuLimit(
  v2Content: string | null,
  v1Quota: string | null,
  v1Period: string | null,
): number | null {
  const [quota, period] =
    v2Content !== null ? v2Content.trim().split(/\s+/) : [v1Quota?.trim(), v1Period?.trim()];
  if (!quota || !period || !/^\d+$/.test(quota) || !/^\d+$/.test(period)) return null;
  const cpusGranted = Number(quota) / Number(period);
  return cpusGranted > 0 ? Math.max(1, Math.floor(cpusGranted)) : null;
}

/** CPUs this process can run on: the host's cores, capped by a container's CPU quota. */
export function getAvailableCpuCount(): number {
  if (_cachedCgroupCpuLimit === undefined) {
    const v2Content = process.platform === "linux" ? readCgroupFile(CGROUP_V2_CPU_MAX_PATH) : null;
    _cachedCgroupCpuLimit =
      process.platform !== "linux"
        ? null
        : v2Content !== null
          ? parseCgroupCpuLimit(v2Content, null, null)
          : parseCgroupCpuLimit(
              null,
              readCgroupFile(CGROUP_V1_CPU_QUOTA_PATH),
              readCgroupFile(CGROUP_V1_CPU_PERIOD_PATH),
            );
  }
  const hostCpus = Math.max(1, availableParallelism());
  return _cachedCgroupCpuLimit === null ? hostCpus : Math.min(hostCpus, _cachedCgroupCpuLimit);
}

/** Test-only: reset the cached cgroup memory and CPU probes. */
export function _resetCgroupLimitCacheForTests(): void {
  _cachedCgroupLimitMb = undefined;
  _cachedCgroupCpuLimit = undefined;
  _warnedCgroupReadFailure = false;
}

/**
 * Actual Linux cgroup memory ceiling in MiB, or null when the process is not
 * cgroup-limited. Unlike getSystemTotalMb this never falls back to host RAM.
 */
export function getCgroupMemoryLimitMb(): number | null {
  if (_cachedCgroupLimitMb !== undefined) return _cachedCgroupLimitMb;

  if (process.platform !== "linux") {
    _cachedCgroupLimitMb = null;
    return null;
  }

  const v2Content = readCgroupFile(CGROUP_V2_MEMORY_MAX_PATH);
  const v1Content = v2Content === null ? readCgroupFile(CGROUP_V1_MEMORY_LIMIT_PATH) : null;

  _cachedCgroupLimitMb = parseCgroupLimitMb(v2Content, v1Content);
  if (_cachedCgroupLimitMb !== null) {
    // stderr, not stdout: this is a diagnostic notice, and commands like `check --json`
    // write their machine-readable payload to stdout. A banner on stdout corrupts that
    // payload for any JSON consumer (it broke the Video Agent's hyperframes check parse).
    console.warn(
      `[SystemMemory] cgroup memory limit detected: ${_cachedCgroupLimitMb} MiB. ` +
        `It governs memory-adaptive render behaviour instead of host RAM.`,
    );
  }
  return _cachedCgroupLimitMb;
}

function readCgroupFile(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    const code = getErrorCode(error);
    if (code !== "ENOENT" && code !== "ENOTDIR") {
      warnCgroupReadFailure(path, error);
    }
    return null;
  }
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  return typeof error.code === "string" ? error.code : undefined;
}

function formatCgroupReadError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const code = getErrorCode(error);
  return code ? `${code}: ${message}` : message;
}

function warnCgroupReadFailure(path: string, error: unknown): void {
  if (_warnedCgroupReadFailure) return;
  _warnedCgroupReadFailure = true;
  console.warn(
    `[SystemMemory] Unable to read cgroup limit at ${path} ` +
      `(${formatCgroupReadError(error)}); falling back to the host's RAM and CPUs.`,
  );
}

/** Total physical RAM in MiB. */
export function getSystemTotalMb(): number {
  const hostTotalMb = Math.floor(totalmem() / BYTES_PER_MIB);
  const cgroupLimitMb = getCgroupMemoryLimitMb();

  return cgroupLimitMb === null ? hostTotalMb : Math.min(hostTotalMb, cgroupLimitMb);
}

/**
 * Total-RAM ceiling (MiB) at or below which the host is treated as
 * memory-constrained. Tuned to the 8 GB laptops in
 * heygen-com/hyperframes#1218 / #1219: on those boxes the default render
 * shape (probe Chrome + a throwaway calibration Chrome + N capture
 * workers) thrashes, so the pipeline collapses to its cheapest form.
 *
 * `<=` deliberately includes machines that report exactly 8192 MiB —
 * real "8 GB" hardware reports anywhere from ~7600 to 8192 MiB once
 * firmware/integrated-GPU reservations are subtracted, and a strict `<`
 * would skip the optimisation on the very hardware that needs it.
 */
export const LOW_MEMORY_TOTAL_MB_THRESHOLD = 8192;

/**
 * True when the host should run the low-memory render profile.
 *
 * Keyed on total physical RAM, not free memory: free memory swings
 * moment to moment and is underreported on macOS, whereas total RAM is a
 * stable proxy for "how many concurrent Chrome instances can this box
 * survive". Accepts an explicit `totalMb` so callers (and tests) can pass
 * a known value instead of re-probing.
 *
 * Caveat: Linux cgroup v1/v2 memory limits are consulted when readable, so
 * Docker and serverless runtimes, including Lambda tiers with readable cgroup
 * ceilings, inherit the tighter container limit instead of the host's physical
 * RAM. Environments that hide cgroup files should set
 * `PRODUCER_LOW_MEMORY_MODE` explicitly rather than relying on auto-detection.
 * Hosts whose *effective* total RAM is genuinely <= the threshold (laptops,
 * small VMs, small Lambda tiers, small containers) are detected correctly.
 */
export function isLowMemorySystem(totalMb: number = getSystemTotalMb()): boolean {
  return totalMb <= LOW_MEMORY_TOTAL_MB_THRESHOLD;
}

/** Memory available in MiB: on macOS and Linux, counting pages the OS reclaims on demand. */
export function getAvailableMemoryMb(): number {
  const fallback = Math.trunc(freemem() / BYTES_PER_MIB);

  if (platform() === "darwin") {
    try {
      const raw = execSync("vm_stat", { encoding: "utf-8", timeout: 5000 });
      const pageSize = parseInt(raw.match(/page size of (\d+)/)?.[1] ?? "0", 10);
      if (!pageSize) return fallback;

      const pages = (key: string) =>
        parseInt(raw.match(new RegExp(`${key}:\\s+(\\d+)`))?.[1] ?? "0", 10);

      const available =
        (pages("Pages free") +
          pages("Pages inactive") +
          pages("Pages purgeable") +
          pages("Pages speculative")) *
        pageSize;

      return available > 0 ? Math.trunc(available / BYTES_PER_MIB) : fallback;
    } catch {
      return fallback;
    }
  }

  if (platform() === "linux") {
    try {
      const meminfo = readFileSync("/proc/meminfo", "utf-8");
      const match = meminfo.match(/MemAvailable:\s+(\d+)\s+kB/);
      if (match) {
        return Math.trunc(parseInt(match[1]!, 10) / 1024);
      }
      return fallback;
    } catch {
      return fallback;
    }
  }

  return fallback;
}
