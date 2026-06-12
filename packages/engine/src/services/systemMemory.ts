/**
 * System-memory probing for memory-adaptive render behaviour.
 *
 * The render pipeline tunes itself to the host's RAM in several places —
 * frame-cache sizes (`config.ts`), Chrome heap + GPU budget flags
 * (`browserManager.ts`), and worker count (`parallelCoordinator.ts`).
 * They all need the same "how much memory does this box have" reading, so
 * it lives here once instead of being re-derived inline.
 */

import { readFileSync } from "fs";
import { totalmem } from "os";

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
// Kernel no-limit sentinel is page-rounded 2^63-1 (~9223372036854771712); >= 2^60 is implausible as a real limit.
const CGROUP_V1_NO_LIMIT_CUTOFF_BYTES = 2n ** 60n;

let _cachedCgroupLimitMb: number | null | undefined;
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

/** Test-only: reset the cached cgroup memory probe. */
export function _resetCgroupLimitCacheForTests(): void {
  _cachedCgroupLimitMb = undefined;
  _warnedCgroupReadFailure = false;
}

function getCgroupLimitMb(): number | null {
  if (_cachedCgroupLimitMb !== undefined) return _cachedCgroupLimitMb;

  if (process.platform !== "linux") {
    _cachedCgroupLimitMb = null;
    return null;
  }

  const v2Content = readCgroupFile(CGROUP_V2_MEMORY_MAX_PATH);
  const v1Content = v2Content === null ? readCgroupFile(CGROUP_V1_MEMORY_LIMIT_PATH) : null;

  _cachedCgroupLimitMb = parseCgroupLimitMb(v2Content, v1Content);
  if (_cachedCgroupLimitMb !== null) {
    console.info(
      `[SystemMemory] cgroup memory limit detected: ${_cachedCgroupLimitMb} MiB — ` +
        `it governs memory-adaptive render behaviour instead of host RAM.`,
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
    `[SystemMemory] Unable to read cgroup memory limit at ${path} ` +
      `(${formatCgroupReadError(error)}); falling back to host RAM.`,
  );
}

/** Total physical RAM in MiB. */
export function getSystemTotalMb(): number {
  const hostTotalMb = Math.floor(totalmem() / BYTES_PER_MIB);
  const cgroupLimitMb = getCgroupLimitMb();

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
