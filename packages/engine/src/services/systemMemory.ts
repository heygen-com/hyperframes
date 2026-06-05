/**
 * System-memory probing for memory-adaptive render behaviour.
 *
 * The render pipeline tunes itself to the host's RAM in several places —
 * frame-cache sizes (`config.ts`), Chrome heap + GPU budget flags
 * (`browserManager.ts`), and worker count (`parallelCoordinator.ts`).
 * They all need the same "how much memory does this box have" reading, so
 * it lives here once instead of being re-derived inline.
 */

import { totalmem } from "os";

/** Total physical RAM in MiB. */
export function getSystemTotalMb(): number {
  return Math.floor(totalmem() / (1024 * 1024));
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
 * Caveat: `os.totalmem()` reports the *host's* physical RAM, not a
 * cgroup/container memory limit. A 4 GB container on a 32 GB host will not
 * auto-flag as low-memory, and an 8 GB container on a 64 GB host won't
 * either. Containerised and serverless callers (Docker `--docker` renders,
 * Lambda) that want a specific profile should set `PRODUCER_LOW_MEMORY_MODE`
 * explicitly rather than relying on auto-detection. Hosts whose *total* RAM
 * is genuinely <= the threshold (laptops, small VMs, small Lambda tiers) are
 * detected correctly regardless of container nesting.
 */
export function isLowMemorySystem(totalMb: number = getSystemTotalMb()): boolean {
  return totalMb <= LOW_MEMORY_TOTAL_MB_THRESHOLD;
}
