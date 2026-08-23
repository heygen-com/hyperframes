import { describe, expect, it } from "vitest";
import { canaryBucket, evaluateCanary, parseCanaryOverride, type CanaryInput } from "./canary.js";
import { CANARIES, canaryEnvVar, findCanary, overdueCanaries } from "./canaryRegistry.js";
import {
  CANARY_FEATURE_PREFIX,
  canaryFeatureKey,
  canaryFeatureProperties,
  canaryReasonKey,
} from "./canary.js";

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

/**
 * A realistic population: v4-shaped UUIDs, but from a SEEDED PRNG.
 *
 * These ids feed statistical assertions (share within 1pp, chi-square
 * uniformity) whose thresholds are tight enough to fail by chance on a
 * genuinely random draw: measured at ~4 failures per 1500 runs for the share
 * bound (the pct=50 case has a binomial SD of 0.354pp, so 1pp is only 2.8
 * sigma) and 1 per 1000 for chi-square by its own construction. That made the
 * whole @hyperframes/core suite flaky for unrelated PRs. Seeded means the
 * population is fixed, so a failure is a real change in the hash — which is
 * the only thing these tests are for.
 */
function uuids(n: number, seed = 0x9e3779b9): string[] {
  let state = seed >>> 0;
  const nextByte = (): number => {
    // xorshift32 — deterministic, and uniform enough to stand in for a real
    // id population. Not used for anything security-relevant.
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state & 0xff;
  };
  const hex = (count: number): string =>
    Array.from({ length: count }, () => nextByte().toString(16).padStart(2, "0")).join("");
  return Array.from(
    { length: n },
    () => `${hex(4)}-${hex(2)}-4${hex(2).slice(1)}-a${hex(2).slice(1)}-${hex(6)}`,
  );
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

  it("fails closed without a unit id — unknown must never mean a PARTIAL cohort", () => {
    for (const id of [undefined, "", "   "]) {
      expect(evaluateCanary(base({ unitId: id, percentage: 50 }))).toEqual({
        enabled: false,
        reason: "no_unit_id",
      });
    }
  });

  it("excludes flagged units (CI) from percentage enrolment but not from an override", () => {
    expect(evaluateCanary(base({ percentage: 50, exclude: true })).reason).toBe("excluded");
    expect(evaluateCanary(base({ percentage: 50, exclude: true, override: true })).enabled).toBe(
      true,
    );
  });

  // 100 is the one percentage where "we don't know who this is" and "this is
  // CI" stop mattering: the registry's step 4 says to delete the entry and the
  // guard at 100-and-holding, so any population still resolving false here
  // would take the new path for the FIRST time at deletion — unstaged, and
  // invisible on the dashboard that said it was safe.
  it.each([
    ["no unit id", { unitId: undefined }],
    ["blank unit id", { unitId: "   " }],
    ["excluded (CI)", { exclude: true }],
  ])("at 100%% enrols %s, so deleting the guard changes nothing", (_label, extra) => {
    expect(evaluateCanary(base({ percentage: 100, ...extra }))).toEqual({
      enabled: true,
      reason: "in_cohort",
    });
  });

  it("an explicit off still wins at 100%", () => {
    expect(evaluateCanary(base({ percentage: 100, override: false })).enabled).toBe(false);
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
  // Also load-bearing for the hash, not just for tidiness: fnv1a32 walks
  // charCodeAt, i.e. UTF-16 code units, while reference FNV-1a is byte
  // oriented. The two agree only for ASCII. Names are hashed as
  // `feature:unit`, so a non-ASCII name (an accented owner tag, an emoji, a
  // full-width dash from autocorrect) would silently disagree with every
  // other FNV-1a implementation — including any external tool that recomputes
  // cohorts. This regex is what makes that unreachable; loosening it means
  // fixing the hash first.
  it("has unique, ASCII kebab-case names — the hash depends on this", () => {
    const names = CANARIES.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) {
      expect(n).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      // eslint-disable-next-line no-control-regex -- explicit ASCII range check
      expect(n).toMatch(/^[\x00-\x7F]*$/);
    }
  });

  // The de-parallel-router wiring assertion that lived here was removed with
  // the canary itself (registry entry + render.ts guard, same commit). The
  // per-install circuit breaker it referenced is unchanged and is covered by
  // the CLI's own render tests.

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
    expect(findCanary("calibration-10")?.name).toBe("calibration-10");
    expect(findCanary("nope")).toBeUndefined();
  });

  // Deliberately NOT `overdueCanaries()` with the ambient date. That assertion
  // reads wall-clock time, so it turns the entire @hyperframes/core suite red
  // on a calendar date for every unrelated PR — a broken build nobody caused
  // and whose fix is unrelated to the change under test.
  //
  // Enforcement against the CURRENT date is real, it just is not here: the
  // scheduled `Canary sunset` workflow runs `scripts/check-canary-sunset.ts`
  // weekly and fails on the rollout's owner rather than on a passing author.
  // These two tests cover the pinned-date and boundary logic it depends on.
  it("every canary carries a parseable sunset date in the future at authoring time", () => {
    const authored = new Date("2026-07-31T00:00:00Z");
    for (const c of CANARIES) {
      const sunset = Date.parse(`${c.sunsetAfter}T00:00:00Z`);
      expect(Number.isFinite(sunset), `${c.name} has an unparseable sunsetAfter`).toBe(true);
      expect(sunset, `${c.name} was authored already-expired`).toBeGreaterThan(authored.getTime());
    }
  });

  it("reports a canary as overdue only AFTER the whole sunset day has passed", () => {
    const [first] = CANARIES;
    if (!first) return;
    const day = first.sunsetAfter;
    expect(overdueCanaries(new Date(`${day}T00:00:00Z`))).not.toContain(first.name);
    expect(overdueCanaries(new Date(`${day}T23:59:59Z`))).not.toContain(first.name);
    const dayAfter = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000);
    expect(overdueCanaries(dayAfter)).toContain(first.name);
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

// The attribution property. Without it, an install reporting both "true" and
// "false" for a canary whose percentage never moved is indistinguishable from
// a developer toggling HF_CANARY_*. The first calibration read hit exactly
// that: 304 installs reported both values and the anomalous ones could not be
// separated from deliberate overrides.
describe("canary reason property", () => {
  it("rides alongside the assignment, outside the $feature namespace", () => {
    const props = canaryFeatureProperties([
      { name: "de-parallel-router", enabled: true, reason: "in_cohort" },
    ]);
    expect(props["$feature/canary-de-parallel-router"]).toBe("true");
    expect(props["canary_reason_de_parallel_router"]).toBe("in_cohort");
  });

  // A non-boolean under `$feature/` would corrupt the flag's own breakdowns,
  // which is the whole reason the reason gets its own key.
  it("never puts a reason inside the flag namespace", () => {
    const props = canaryFeatureProperties([{ name: "x", enabled: false, reason: "forced_off" }]);
    for (const [key, value] of Object.entries(props)) {
      if (key.startsWith(CANARY_FEATURE_PREFIX)) {
        expect(value).toMatch(/^(true|false)$/);
      }
    }
  });

  it("separates a forced override from a genuine cohort roll at the same value", () => {
    const forced = canaryFeatureProperties([{ name: "f", enabled: true, reason: "forced_on" }]);
    const rolled = canaryFeatureProperties([{ name: "f", enabled: true, reason: "in_cohort" }]);
    // Identical assignment — only the reason tells them apart. This is the
    // distinction the calibration read could not make.
    expect(forced["$feature/canary-f"]).toBe(rolled["$feature/canary-f"]);
    expect(forced["canary_reason_f"]).not.toBe(rolled["canary_reason_f"]);
  });

  it("emits `excluded` for CI, which replaces joining on is_ci", () => {
    const props = canaryFeatureProperties([{ name: "c", enabled: false, reason: "excluded" }]);
    // `excluded` and `out_of_cohort` are both enabled:false but mean different
    // things — CI was never bucketed, the other lost the roll. Counting them
    // together is what biased the first accuracy read low.
    expect(props["canary_reason_c"]).toBe("excluded");
  });

  it("omits the reason key when no reason is supplied", () => {
    const props = canaryFeatureProperties([{ name: "n", enabled: true }]);
    expect(props["$feature/canary-n"]).toBe("true");
    expect(props).not.toHaveProperty("canary_reason_n");
  });

  it("sanitizes the name into a property-safe key", () => {
    expect(canaryReasonKey("de-parallel-router")).toBe("canary_reason_de_parallel_router");
  });
});
