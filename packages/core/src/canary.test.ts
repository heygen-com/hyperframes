import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { canaryBucket, evaluateCanary, parseCanaryOverride, type CanaryInput } from "./canary.js";
import { CANARIES, canaryEnvVar, findCanary, overdueCanaries } from "./canaryRegistry.js";
import { CANARY_FEATURE_PREFIX, canaryFeatureKey, canaryFeatureProperties } from "./canary.js";

const base = (over: Partial<CanaryInput> = {}): CanaryInput => ({
  feature: "test-feature",
  unitId: "db0c1f4a-b95e-4c35-90c6-1a15bd76f717",
  percentage: 10,
  ...over,
});

/**
 * Recover the raw 32-bit hash from the module under test so the canonical
 * vectors can be asserted without exporting internals: canaryBucket(f, u)
 * hashes `${f}:${u}`, so an empty feature and a unitId of `x` hashes ":x".
 * Instead of fighting that, re-derive here and cross-check that this local
 * copy agrees with canaryBucket on real inputs (asserted below).
 */
function rawFnv(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}

/** A realistic population: install ids are v4 UUIDs (`randomUUID()`). */
function uuids(n: number): string[] {
  return Array.from({ length: n }, () => randomUUID());
}

describe("fnv1a32 (via canaryBucket)", () => {
  it("matches canonical FNV-1a 32-bit vectors", () => {
    // canaryBucket hashes `feature:unitId`, so feed the vector as the whole
    // string by using an empty feature and reconstructing the separator.
    // Guards against a well-meaning "optimization" silently changing the hash
    // — which would reshuffle every live cohort mid-rollout.
    const vectors: Array<[string, number]> = [
      ["", 0x811c9dc5],
      ["a", 0xe40c292c],
      ["b", 0xe70c2de5],
      ["foobar", 0xbf9cf968],
      ["hello", 0x4f9f2cab],
    ];
    for (const [input, expected] of vectors) {
      expect(rawFnv(input)).toBe(expected);
    }
  });

  it("the shipped bucket function actually uses that hash", () => {
    // Without this, the vector test above is tautological: it would only
    // prove the TEST's copy of FNV-1a is correct, and canary.ts could drift
    // to a different hash with every assertion still green.
    for (const id of uuids(200)) {
      for (const feature of ["de-parallel-router", "x", ""]) {
        expect(canaryBucket(feature, id)).toBe(rawFnv(`${feature}:${id}`) % 100);
      }
    }
  });
});

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

  it("N concurrent canaries enrol installs binomially, not in lockstep", () => {
    // The sharpest statement of independence. With 8 canaries at 10% each,
    // independent slices give binomial(8, 0.1): ~43% of installs in none,
    // ~38% in exactly one, and effectively nobody in all eight. If the slices
    // were correlated, ~10% of installs would be in ALL of them — one cohort
    // absorbing every experiment at once.
    const ids = uuids(20000);
    const features = ["a", "b", "c", "d", "e", "f", "g", "h"].map((f) => `feat-${f}`);
    let inNone = 0;
    let inAll = 0;
    for (const id of ids) {
      let n = 0;
      for (const feature of features) {
        if (evaluateCanary({ feature, unitId: id, percentage: 10 }).enabled) n++;
      }
      if (n === 0) inNone++;
      if (n === features.length) inAll++;
    }
    // binomial: P(0) = 0.9^8 = 43.0%
    expect(Math.abs((inNone / ids.length) * 100 - 43.0)).toBeLessThan(2);
    // Correlated slices would put ~10% here; independent puts ~1e-8.
    expect(inAll).toBe(0);
  });

  it("selects the requested share of a UUID population within 1 percentage point", () => {
    // Measured against 60k synthetic and 101 real fleet ids: worst error was
    // 0.16pp. A 1pp band is therefore a real guard, not a formality — the
    // earlier 0.6x-1.4x band would have passed a badly skewed hash.
    const ids = uuids(20000);
    for (const pct of [1, 5, 10, 25, 50]) {
      const hits = ids.filter(
        (id) => evaluateCanary(base({ unitId: id, percentage: pct })).enabled,
      ).length;
      const actual = (hits / ids.length) * 100;
      expect(Math.abs(actual - pct)).toBeLessThan(1);
    }
  });

  it("distributes uniformly across all 100 buckets (chi-square)", () => {
    // The strongest available guard on the hash: a lumpy hash still yields
    // roughly the right TOTAL share while over-loading some buckets, so the
    // share test alone can't catch it.
    const ids = uuids(30000);
    const counts = new Array(100).fill(0);
    for (const id of ids) counts[canaryBucket("chi-test", id)]++;
    const expected = ids.length / 100;
    const chi2 = counts.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0);
    // df = 99; chi-square critical value at p=0.001 is 148.2.
    expect(chi2).toBeLessThan(148.2);
    expect(Math.min(...counts)).toBeGreaterThan(0);
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

describe("PostHog flag-shaped properties", () => {
  it("namespaces keys so a canary can never alias a real PostHog flag", () => {
    // A real flag namespace already exists in this project, owned by the web
    // app (e.g. `enable-chat-tab`). Without the `canary-` infix a canary named
    // after a real flag would fight it for the same property.
    expect(canaryFeatureKey("de-parallel-router")).toBe("$feature/canary-de-parallel-router");
    expect(CANARY_FEATURE_PREFIX.startsWith("$feature/")).toBe(true);
  });

  it("emits every canary, not just enrolled ones", () => {
    // Absent vs "false" are different facts: absent = this build predates the
    // canary, "false" = this build has it and this install is control.
    // Collapsing them makes a ramp unreadable.
    const props = canaryFeatureProperties([
      { name: "a", enabled: true },
      { name: "b", enabled: false },
    ]);
    expect(props).toEqual({
      "$feature/canary-a": "true",
      "$feature/canary-b": "false",
    });
  });

  it("uses string values, matching how PostHog records boolean flags", () => {
    const props = canaryFeatureProperties([{ name: "a", enabled: true }]);
    expect(typeof props["$feature/canary-a"]).toBe("string");
  });

  it("is empty when nothing is registered", () => {
    expect(canaryFeatureProperties([])).toEqual({});
  });
});
