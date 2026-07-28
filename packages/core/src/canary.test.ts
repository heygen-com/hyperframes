import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { canaryBucket, evaluateCanary, parseCanaryOverride, type CanaryInput } from "./canary.js";
import { CANARIES, canaryEnvVar, findCanary, overdueCanaries } from "./canaryRegistry.js";

const base = (over: Partial<CanaryInput> = {}): CanaryInput => ({
  feature: "test-feature",
  unitId: "db0c1f4a-b95e-4c35-90c6-1a15bd76f717",
  percentage: 10,
  ...over,
});

/** A realistic population: install ids are v4 UUIDs (`randomUUID()`). */
function uuids(n: number): string[] {
  return Array.from({ length: n }, () => randomUUID());
}

describe("evaluateCanary", () => {
  it("is deterministic for the same feature + unit", () => {
    const a = evaluateCanary(base());
    const b = evaluateCanary(base());
    expect(a).toEqual(b);
  });

  it("honours an explicit override in both directions, over any percentage", () => {
    expect(evaluateCanary(base({ percentage: 0, override: true }))).toEqual({
      enabled: true,
      reason: "forced_on",
    });
    expect(evaluateCanary(base({ percentage: 100, override: false }))).toEqual({
      enabled: false,
      reason: "forced_off",
    });
  });

  it("0% is off for everyone and 100% is on for everyone", () => {
    for (const id of uuids(50)) {
      expect(evaluateCanary(base({ unitId: id, percentage: 0 })).enabled).toBe(false);
      expect(evaluateCanary(base({ unitId: id, percentage: 100 })).enabled).toBe(true);
    }
  });

  it("fails closed without a unit id — unknown must never mean everyone", () => {
    for (const id of [undefined, "", "   "]) {
      expect(evaluateCanary(base({ unitId: id, percentage: 100 }))).toEqual({
        enabled: false,
        reason: "no_unit_id",
      });
    }
  });

  it("excludes flagged units (CI) from percentage enrolment but not from an override", () => {
    expect(evaluateCanary(base({ percentage: 100, exclude: true })).reason).toBe("excluded");
    expect(evaluateCanary(base({ percentage: 100, exclude: true, override: true })).enabled).toBe(
      true,
    );
  });

  it("clamps out-of-range and fractional percentages", () => {
    expect(evaluateCanary(base({ percentage: -5 })).enabled).toBe(false);
    expect(evaluateCanary(base({ percentage: 999 })).enabled).toBe(true);
    // 10.9 truncates to 10 — same cohort as an even 10, no surprise widening.
    const ids = uuids(300);
    const at10 = ids.filter((id) => evaluateCanary(base({ unitId: id, percentage: 10 })).enabled);
    const at109 = ids.filter(
      (id) => evaluateCanary(base({ unitId: id, percentage: 10.9 })).enabled,
    );
    expect(at109).toEqual(at10);
  });
});

describe("cohort properties", () => {
  it("ramping is INCLUSIVE — widening never drops an already-enrolled install", () => {
    // If a ramp reshuffled the cohort, before/after comparisons across the
    // ramp would be meaningless and some users would flap in and out.
    const ids = uuids(500);
    const enrolledAt = (pct: number) =>
      new Set(ids.filter((id) => evaluateCanary(base({ unitId: id, percentage: pct })).enabled));
    const p5 = enrolledAt(5);
    const p25 = enrolledAt(25);
    const p100 = enrolledAt(100);
    for (const id of p5) expect(p25.has(id)).toBe(true);
    for (const id of p25) expect(p100.has(id)).toBe(true);
    expect(p25.size).toBeGreaterThan(p5.size);
  });

  it("different features select INDEPENDENT slices of the same population", () => {
    // The whole reason the hash includes the feature name: bucketing on the
    // unit id alone would hand every simultaneous experiment to one unlucky
    // cohort, and make two rollouts impossible to read apart.
    const ids = uuids(2000);
    const a = new Set(
      ids.filter((id) => evaluateCanary({ feature: "feat-a", unitId: id, percentage: 10 }).enabled),
    );
    const b = new Set(
      ids.filter((id) => evaluateCanary({ feature: "feat-b", unitId: id, percentage: 10 }).enabled),
    );
    const overlap = [...a].filter((id) => b.has(id)).length;
    // Independent 10% slices overlap ~1% of the population (~20 of 2000).
    // Identical slices would overlap ~200. Assert well below that.
    expect(overlap).toBeLessThan(70);
    expect(a.size).toBeGreaterThan(0);
    expect(b.size).toBeGreaterThan(0);
  });

  it("selects approximately the requested share of a UUID population", () => {
    const ids = uuids(4000);
    for (const pct of [5, 10, 25]) {
      const hits = ids.filter(
        (id) => evaluateCanary(base({ unitId: id, percentage: pct })).enabled,
      ).length;
      const actual = (hits / ids.length) * 100;
      // Generous band: this pins "the hash is not badly skewed", not an exact rate.
      expect(actual).toBeGreaterThan(pct * 0.6);
      expect(actual).toBeLessThan(pct * 1.4);
    }
  });

  it("spreads buckets across the full 0-99 range", () => {
    const seen = new Set(uuids(2000).map((id) => canaryBucket("spread", id)));
    expect(seen.size).toBeGreaterThan(80);
  });
});

describe("parseCanaryOverride", () => {
  it("accepts the spellings people actually type", () => {
    for (const v of ["1", "true", "TRUE", "on", "yes", " On "]) {
      expect(parseCanaryOverride(v)).toBe(true);
    }
    for (const v of ["0", "false", "FALSE", "off", "no", " Off "]) {
      expect(parseCanaryOverride(v)).toBe(false);
    }
  });

  it("treats unset, empty and unrecognised values as 'no override'", () => {
    // An exported-but-empty var must not force a feature on.
    for (const v of [undefined, "", "   ", "maybe"]) {
      expect(parseCanaryOverride(v)).toBeUndefined();
    }
  });
});

describe("registry", () => {
  it("has unique, kebab-case names", () => {
    const names = CANARIES.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("has in-range percentages and a parseable sunset date", () => {
    for (const c of CANARIES) {
      expect(c.percentage).toBeGreaterThanOrEqual(0);
      expect(c.percentage).toBeLessThanOrEqual(100);
      expect(Number.isNaN(Date.parse(`${c.sunsetAfter}T00:00:00Z`))).toBe(false);
      expect(c.owner.length).toBeGreaterThan(0);
      expect(c.description.length).toBeGreaterThan(0);
    }
  });

  it("derives the override env var from the name", () => {
    expect(canaryEnvVar("de-parallel-router")).toBe("HF_CANARY_DE_PARALLEL_ROUTER");
    expect(findCanary("de-parallel-router")?.name).toBe("de-parallel-router");
    expect(findCanary("nope")).toBeUndefined();
  });

  it("no canary is past its sunset date", () => {
    // Fails the suite when a rollout has been left half-finished. Either take
    // it to 100 and delete the entry, or move the date deliberately.
    expect(overdueCanaries()).toEqual([]);
  });
});
