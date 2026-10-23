// Cores this process may use. `os.cpus()` and `availableParallelism()` ignore a cgroup CPU quota,
// so a container limited to 6 cores on a 32-vCPU host would size its work for 32.

import { readFileSync } from "fs";
import { availableParallelism } from "os";

// Container-root paths, as in systemMemory.ts (bare hosts are covered by the host count).
const CGROUP_V2_CPU_MAX_PATH = "/sys/fs/cgroup/cpu.max";
const CGROUP_V1_CPU_QUOTA_PATH = "/sys/fs/cgroup/cpu/cpu.cfs_quota_us";
const CGROUP_V1_CPU_PERIOD_PATH = "/sys/fs/cgroup/cpu/cpu.cfs_period_us";
const CGROUP_V2_DEFAULT_PERIOD_US = "100000";

let _cachedCgroupCpuLimit: number | null | undefined;
let _warnedCgroupReadFailure = false;

/**
 * Parse cgroup v2 `cpu.max` ("<quota> <period>") or v1 quota/period contents
 * into cores, possibly fractional. Null when unlimited ("max", v1's -1) or unreadable.
 */
export function parseCgroupCpuLimit(
  v2Content: string | null,
  v1Quota: string | null,
  v1Period: string | null,
): number | null {
  if (v2Content !== null) {
    const [quota, period = CGROUP_V2_DEFAULT_PERIOD_US] = v2Content.trim().split(/\s+/);
    return quotaToCores(quota, period);
  }
  if (v1Quota === null || v1Period === null) return null;
  return quotaToCores(v1Quota.trim(), v1Period.trim());
}

function quotaToCores(quota: string | undefined, period: string): number | null {
  if (quota === undefined || !/^\d+$/.test(quota) || !/^\d+$/.test(period)) return null;
  const quotaUs = Number(quota);
  const periodUs = Number(period);
  return quotaUs > 0 && periodUs > 0 ? quotaUs / periodUs : null;
}

/** Test-only: reset the cached cgroup CPU probe. */
export function _resetCgroupCpuLimitCacheForTests(): void {
  _cachedCgroupCpuLimit = undefined;
  _warnedCgroupReadFailure = false;
}

/** Linux cgroup CPU quota in cores, or null when the process has none. */
export function getCgroupCpuLimit(): number | null {
  if (_cachedCgroupCpuLimit !== undefined) return _cachedCgroupCpuLimit;

  if (process.platform !== "linux") {
    _cachedCgroupCpuLimit = null;
    return null;
  }

  const v2Content = readCgroupFile(CGROUP_V2_CPU_MAX_PATH);
  const v1Quota = v2Content === null ? readCgroupFile(CGROUP_V1_CPU_QUOTA_PATH) : null;
  const v1Period = v1Quota === null ? null : readCgroupFile(CGROUP_V1_CPU_PERIOD_PATH);

  _cachedCgroupCpuLimit = parseCgroupCpuLimit(v2Content, v1Quota, v1Period);
  if (_cachedCgroupCpuLimit !== null) {
    // stderr, not stdout: `check --json` writes its payload to stdout (see systemMemory.ts).
    console.warn(
      `[SystemCpu] cgroup CPU limit detected: ${_cachedCgroupCpuLimit} cores. ` +
        `It governs CPU-adaptive render behaviour instead of the host core count.`,
    );
  }
  return _cachedCgroupCpuLimit;
}

function readCgroupFile(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code !== "ENOENT" && code !== "ENOTDIR" && !_warnedCgroupReadFailure) {
      _warnedCgroupReadFailure = true;
      console.warn(
        `[SystemCpu] Unable to read cgroup CPU limit at ${path} ` +
          `(${code ?? String(error)}); falling back to the host core count.`,
      );
    }
    return null;
  }
}

/**
 * Cores this process may use: the host's available parallelism, capped by the
 * cgroup quota (floored, at least 1). Equals the host count outside containers.
 */
export function getUsableCpuCount(): number {
  const hostCpus = availableParallelism();
  const limit = getCgroupCpuLimit();
  return limit === null ? hostCpus : Math.max(1, Math.min(hostCpus, Math.floor(limit)));
}
