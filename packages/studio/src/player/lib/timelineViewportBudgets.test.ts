import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DIAGNOSTIC_BUDGET_FIELDS,
  ENFORCED_BUDGET_FIELDS,
  TIMELINE_VIEWPORT_BUDGETS,
  resolveTimelineViewportBudgets,
} from "./timelineViewportBudgets";

const PACKAGE_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** Every module allowed to satisfy "enforced": it caps, evicts or switches. */
const ENFORCING_MODULES = [
  "src/player/components/timelineViewportGeometry.ts",
  "src/player/components/useTimelineVirtualRows.ts",
  "src/player/lib/timelinePerformanceDiagnostics.ts",
  "src/player/lib/mediaResolver.ts",
];

/** Every module allowed to satisfy "diagnostic": it only measures and reports. */
const REPORTING_MODULES = [
  "src/player/lib/timelinePerformanceDiagnostics.ts",
  "tests/e2e/timeline-virtualization.mjs",
];

/**
 * Fields removed by U7 because nothing anywhere read them. Listed so the sweep
 * below fails if one is reintroduced without a consumer.
 */
const DELETED_FIELDS = [
  "posterMaxPhysicalWidth",
  "posterMaxPhysicalHeight",
  "posterDprCap",
  "richPreviewFrameCount",
  "concurrentCompositionFetches",
  "concurrentServerPages",
  "thumbnailCacheEntriesPerProject",
  "compositionDiskCacheBytes",
  "compositionDiskCacheMaxAgeMs",
  "posterColdP95Ms",
  "posterCachedP95Ms",
  "constrainedPosterColdP95Ms",
  "constrainedPosterCachedP95Ms",
  "posterCoverageRatio",
  "posterCoverageSettleMs",
  "constrainedPosterCoverageSettleMs",
  "richPreviewP95Ms",
  "constrainedRichPreviewP95Ms",
  "supportedFixtureFallbackRatio",
];

const SELF = fileURLToPath(import.meta.url);
const SOURCE_EXTENSIONS = /\.(ts|tsx|mjs|cjs|js|jsx)$/;

function collectSourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) collectSourceFiles(path, found);
    else if (SOURCE_EXTENSIONS.test(entry) && path !== SELF) found.push(path);
  }
  return found;
}

function read(relativePath: string): string {
  return readFileSync(join(PACKAGE_ROOT, relativePath), "utf8");
}

const mentions = (source: string, field: string) => new RegExp(`\\b${field}\\b`).test(source);

describe("timeline viewport budgets", () => {
  it("owns the agreed direct-scroll, DOM, media, and measurement ceilings", () => {
    expect(TIMELINE_VIEWPORT_BUDGETS).toMatchObject({
      directScrollSafetyPx: 8_000_000,
      rowOverscanPerSide: 2,
      timeOverscanViewportRatio: 0.25,
      maxMountedRows: 64,
      maxMountedClipRoots: 512,
      maxMountedClipRootsPerRow: 128,
      maxMountedTimelineDescendants: 5_000,
      thumbnailCacheBytes: 64 * 1024 * 1024,
      waveformCacheBytes: 16 * 1024 * 1024,
      metadataFailureTtlMs: 30_000,
      interactionP95Ms: 50,
      constrainedInteractionP95Ms: 75,
      constrainedFrameIntervalP95Ms: 75,
      longTaskLimitMs: 50,
      constrainedLongTaskLimitMs: 300,
      scrollSamplesPerRun: 21,
      warmupRuns: 3,
      measuredRuns: 5,
      requiredPassingRuns: 4,
    });
    expect(Object.isFrozen(TIMELINE_VIEWPORT_BUDGETS)).toBe(true);
  });

  it("creates an immutable test override without changing production defaults", () => {
    const resolved = resolveTimelineViewportBudgets({
      directScrollSafetyPx: 256,
      measuredRuns: 1,
      requiredPassingRuns: 1,
    });

    expect(resolved.directScrollSafetyPx).toBe(256);
    expect(resolved.maxMountedClipRoots).toBe(512);
    expect(TIMELINE_VIEWPORT_BUDGETS.directScrollSafetyPx).toBe(8_000_000);
    expect(Object.isFrozen(resolved)).toBe(true);
  });

  it.each([
    [{ maxMountedClipRoots: -1 }, "maxMountedClipRoots"],
    [{ frameIntervalP95Ms: Number.NaN }, "frameIntervalP95Ms"],
    [{ warmupRuns: 0.5 }, "warmupRuns"],
    [{ measuredRuns: 0 }, "measuredRuns"],
    [{ requiredPassingRuns: 0 }, "requiredPassingRuns"],
    [{ measuredRuns: 1.5, requiredPassingRuns: 1 }, "measuredRuns"],
    [{ measuredRuns: 4, requiredPassingRuns: 5 }, "requiredPassingRuns"],
    [{ scrollSamplesPerRun: 19 }, "scrollSamplesPerRun"],
    [{ memoryReturnToleranceRatio: 1.1 }, "memoryReturnToleranceRatio"],
  ] as const)("rejects an invalid override %#", (overrides, message) => {
    expect(() => resolveTimelineViewportBudgets(overrides)).toThrow(message);
  });

  describe("every field is enforced or explicitly diagnostic", () => {
    it("classifies each declared field exactly once", () => {
      const declared = Object.keys(TIMELINE_VIEWPORT_BUDGETS).sort();
      const classified = [...ENFORCED_BUDGET_FIELDS, ...DIAGNOSTIC_BUDGET_FIELDS];

      expect(new Set(classified).size).toBe(classified.length);
      expect([...classified].sort()).toEqual(declared);
    });

    it.each(ENFORCED_BUDGET_FIELDS)("%s is read by code that enforces it", (field) => {
      const enforcers = ENFORCING_MODULES.filter((module) => mentions(read(module), field));
      expect(enforcers, `${field} claims to be enforced but no module reads it`).not.toEqual([]);
    });

    it.each(DIAGNOSTIC_BUDGET_FIELDS)("%s is reported against by a diagnostic", (field) => {
      const reporters = REPORTING_MODULES.filter((module) => mentions(read(module), field));
      expect(reporters, `${field} is annotated diagnostic but nothing reports it`).not.toEqual([]);
    });
  });

  it("leaves no reference to a deleted field anywhere in the package", () => {
    const sources = [
      ...collectSourceFiles(join(PACKAGE_ROOT, "src")),
      ...collectSourceFiles(join(PACKAGE_ROOT, "tests")),
    ].map((path) => ({ path, text: readFileSync(path, "utf8") }));

    const survivors = DELETED_FIELDS.flatMap((field) =>
      sources.filter(({ text }) => mentions(text, field)).map(({ path }) => `${field} in ${path}`),
    );

    expect(survivors).toEqual([]);
  });
});
