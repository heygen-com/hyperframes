/**
 * Timeline viewport and media budgets.
 *
 * Every field is in exactly one of two terminal states, and the split is
 * machine-checked by the colocated test:
 *
 * - **Enforced** (`ENFORCED_BUDGET_FIELDS`) — production code reads it and
 *   changes behaviour: it caps, evicts, expires or switches strategy.
 * - **Diagnostic** (`DIAGNOSTIC_BUDGET_FIELDS`) — nothing prevents exceeding
 *   it. The perf gate (`tests/e2e/timeline-virtualization.mjs`) and
 *   `timelinePerformanceDiagnostics.ts` only *report* against it.
 *
 * There is no third state. A field with no consumer is deleted rather than
 * left declared — a limit nothing enforces reads as a guarantee during review
 * and provides none at runtime.
 */
export interface TimelineViewportBudgets {
  // --- Enforced: virtualization geometry -----------------------------------
  /** Above this content width the timeline switches to segmented scrolling. */
  directScrollSafetyPx: number;
  /** Rows rendered beyond each edge of the viewport. */
  rowOverscanPerSide: number;
  /** Time overscan as a fraction of the visible time span. */
  timeOverscanViewportRatio: number;

  // --- Enforced: media resolver (mediaResolver.ts) --------------------------
  /** Concurrent hidden-`<video>` decodes for thumbnails and waveforms. */
  concurrentVideoDecodes: number;
  /** Concurrent header-only metadata probes. */
  concurrentMetadataJobs: number;
  /** LRU entry bound on the thumbnail cache. */
  thumbnailCacheEntries: number;
  /**
   * LRU byte bound on the thumbnail cache. Entry count alone does not bound
   * memory: one entry is a JPEG data-URL strip of arbitrary size.
   */
  thumbnailCacheBytes: number;
  /** LRU entry bound on the decoded-waveform cache. */
  waveformCacheEntries: number;
  /** LRU byte bound on the decoded-waveform cache. */
  waveformCacheBytes: number;
  /** LRU entry bound on the shared raw-media-bytes cache. */
  mediaBytesCacheEntries: number;
  /**
   * LRU byte bound on the shared raw-media-bytes cache. Entry count alone does
   * not bound memory: one entry is a whole media file.
   */
  mediaBytesCacheBytes: number;
  /** LRU entry bound on the media-metadata cache. */
  metadataRegistryEntries: number;
  /** How long a failed probe stays failed before it is retried. */
  metadataFailureTtlMs: number;

  // --- Diagnostic: mounted-DOM ceilings ------------------------------------
  // Asserted by timelinePerformanceDiagnostics.ts and the perf gate. Nothing
  // prevents exceeding them; windowing is what keeps them true.
  maxMountedRows: number;
  maxMountedClipRoots: number;
  maxMountedClipRootsPerRow: number;
  maxMountedTimelineDescendants: number;

  // --- Diagnostic: perf-gate thresholds ------------------------------------
  // Consumed only by tests/e2e/timeline-virtualization.mjs. The `constrained*`
  // variants apply on the low-resource tier.
  interactionP95Ms: number;
  frameIntervalP95Ms: number;
  constrainedInteractionP95Ms: number;
  constrainedFrameIntervalP95Ms: number;
  longTaskLimitMs: number;
  constrainedLongTaskLimitMs: number;
  memoryReturnToleranceRatio: number;

  // --- Diagnostic: perf-gate run shape -------------------------------------
  scrollSamplesPerRun: number;
  warmupRuns: number;
  measuredRuns: number;
  requiredPassingRuns: number;
}

/** Fields production code reads to cap, evict, expire or switch strategy. */
export const ENFORCED_BUDGET_FIELDS = [
  "directScrollSafetyPx",
  "rowOverscanPerSide",
  "timeOverscanViewportRatio",
  "concurrentVideoDecodes",
  "concurrentMetadataJobs",
  "thumbnailCacheEntries",
  "thumbnailCacheBytes",
  "waveformCacheEntries",
  "waveformCacheBytes",
  "mediaBytesCacheEntries",
  "mediaBytesCacheBytes",
  "metadataRegistryEntries",
  "metadataFailureTtlMs",
] as const satisfies readonly (keyof TimelineViewportBudgets)[];

/** Fields only reported against. Exceeding one fails a gate, never a user. */
export const DIAGNOSTIC_BUDGET_FIELDS = [
  "maxMountedRows",
  "maxMountedClipRoots",
  "maxMountedClipRootsPerRow",
  "maxMountedTimelineDescendants",
  "interactionP95Ms",
  "frameIntervalP95Ms",
  "constrainedInteractionP95Ms",
  "constrainedFrameIntervalP95Ms",
  "longTaskLimitMs",
  "constrainedLongTaskLimitMs",
  "memoryReturnToleranceRatio",
  "scrollSamplesPerRun",
  "warmupRuns",
  "measuredRuns",
  "requiredPassingRuns",
] as const satisfies readonly (keyof TimelineViewportBudgets)[];

const MEBIBYTE = 1024 * 1024;

/**
 * The sole default budget owner for timeline viewport and media virtualization.
 * Consumers may resolve an immutable per-test override; production defaults are
 * never mutated globally.
 */
export const TIMELINE_VIEWPORT_BUDGETS: Readonly<TimelineViewportBudgets> = Object.freeze({
  directScrollSafetyPx: 8_000_000,
  rowOverscanPerSide: 2,
  timeOverscanViewportRatio: 0.25,
  concurrentVideoDecodes: 2,
  concurrentMetadataJobs: 4,
  thumbnailCacheEntries: 256,
  thumbnailCacheBytes: 64 * MEBIBYTE,
  waveformCacheEntries: 256,
  waveformCacheBytes: 16 * MEBIBYTE,
  mediaBytesCacheEntries: 8,
  mediaBytesCacheBytes: 64 * MEBIBYTE,
  metadataRegistryEntries: 512,
  metadataFailureTtlMs: 30_000,
  maxMountedRows: 64,
  maxMountedClipRoots: 512,
  maxMountedClipRootsPerRow: 128,
  maxMountedTimelineDescendants: 5_000,
  interactionP95Ms: 50,
  frameIntervalP95Ms: 33.3,
  constrainedInteractionP95Ms: 75,
  constrainedFrameIntervalP95Ms: 75,
  longTaskLimitMs: 50,
  constrainedLongTaskLimitMs: 300,
  memoryReturnToleranceRatio: 0.15,
  scrollSamplesPerRun: 21,
  warmupRuns: 3,
  measuredRuns: 5,
  requiredPassingRuns: 4,
});

function assertValidBudget(name: keyof TimelineViewportBudgets, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`Timeline viewport budget ${name} must be a finite non-negative number`);
  }
}

export function resolveTimelineViewportBudgets(
  overrides: Partial<TimelineViewportBudgets> = {},
): Readonly<TimelineViewportBudgets> {
  for (const [name, value] of Object.entries(overrides)) {
    assertValidBudget(name as keyof TimelineViewportBudgets, value);
  }
  const resolved = { ...TIMELINE_VIEWPORT_BUDGETS, ...overrides };
  for (const name of [
    "scrollSamplesPerRun",
    "warmupRuns",
    "measuredRuns",
    "requiredPassingRuns",
  ] as const) {
    if (!Number.isInteger(resolved[name])) {
      throw new RangeError(`Timeline viewport budget ${name} must be an integer`);
    }
  }
  if (resolved.scrollSamplesPerRun < 20) {
    throw new RangeError(
      "Timeline viewport budget scrollSamplesPerRun must be at least 20 for p95",
    );
  }
  if (resolved.measuredRuns === 0 || resolved.requiredPassingRuns === 0) {
    throw new RangeError(
      "Timeline viewport budget measuredRuns and requiredPassingRuns must be greater than zero",
    );
  }
  if (resolved.requiredPassingRuns > resolved.measuredRuns) {
    throw new RangeError("Timeline viewport budget requiredPassingRuns cannot exceed measuredRuns");
  }
  if (resolved.memoryReturnToleranceRatio > 1) {
    throw new RangeError("Timeline viewport budget memoryReturnToleranceRatio cannot exceed 1");
  }
  return Object.freeze(resolved);
}
