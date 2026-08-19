import { describe, expect, it, vi, beforeEach } from "vitest";

const configState: {
  anonymousId: string;
  bucketSeed: string | undefined;
  telemetryEnabled: boolean;
} = {
  anonymousId: "db0c1f4a-b95e-4c35-90c6-1a15bd76f717",
  bucketSeed: undefined,
  telemetryEnabled: true,
};
const systemState = { is_ci: false };
// null = no runtime opt-out in force; a string names the source (env var,
// dev build, ...) exactly as policy.ts reports it.
const policyState: { runtimeOverride: string | null } = { runtimeOverride: null };

vi.mock("./config.js", () => ({
  readConfig: () => ({
    anonymousId: configState.anonymousId,
    bucketSeed: configState.bucketSeed,
    telemetryEnabled: configState.telemetryEnabled,
  }),
}));
vi.mock("./system.js", () => ({
  getSystemMeta: () => ({ is_ci: systemState.is_ci }),
}));
vi.mock("./policy.js", () => ({
  telemetryRuntimeOverride: () => policyState.runtimeOverride,
}));

// The registry is data; pin a known shape so these tests don't move when a
// real canary is added or ramped.
vi.mock("@hyperframes/core/canary-registry", async () => {
  const actual = await vi.importActual<typeof import("@hyperframes/core/canary-registry")>(
    "@hyperframes/core/canary-registry",
  );
  return {
    ...actual,
    CANARIES: [
      {
        name: "test-alpha",
        percentage: 100,
        description: "always on",
        owner: "t",
        sunsetAfter: "2099-01-01",
      },
      {
        // A PARTIAL percentage. `exclude` and the unit-id check only apply
        // below 100 — at 100 the guard is about to be deleted, so everyone
        // must already be on it — so exclusion behaviour cannot be expressed
        // against test-alpha.
        name: "test-gamma",
        percentage: 50,
        description: "partial rollout",
        owner: "t",
        sunsetAfter: "2099-01-01",
      },
      {
        name: "test-beta",
        percentage: 0,
        description: "always off",
        owner: "t",
        sunsetAfter: "2099-01-01",
      },
    ],
    findCanary: (n: string) =>
      [
        {
          name: "test-alpha",
          percentage: 100,
          description: "",
          owner: "t",
          sunsetAfter: "2099-01-01",
        },
        {
          name: "test-gamma",
          percentage: 50,
          description: "",
          owner: "t",
          sunsetAfter: "2099-01-01",
        },
        {
          name: "test-beta",
          percentage: 0,
          description: "",
          owner: "t",
          sunsetAfter: "2099-01-01",
        },
      ].find((c) => c.name === n),
  };
});

const { isCanaryEnabled, resolveCanary, canaryEventProperties, __resetCanaryCacheForTests } =
  await import("./canary.js");

beforeEach(() => {
  __resetCanaryCacheForTests();
  configState.anonymousId = "db0c1f4a-b95e-4c35-90c6-1a15bd76f717";
  configState.bucketSeed = undefined;
  configState.telemetryEnabled = true;
  systemState.is_ci = false;
  policyState.runtimeOverride = null;
  delete process.env.HF_CANARY_TEST_ALPHA;
  delete process.env.HF_CANARY_TEST_BETA;
  delete process.env.HF_CANARY_TEST_GAMMA;
});

describe("telemetry opt-out is canary opt-out", () => {
  it("does not enrol when the persisted preference is off", () => {
    configState.telemetryEnabled = false;
    // test-alpha is at 100% — it would be on for everyone otherwise.
    expect(resolveCanary("test-alpha")).toEqual({
      enabled: false,
      reason: "telemetry_opt_out",
    });
  });

  it.each(["HYPERFRAMES_NO_TELEMETRY", "DO_NOT_TRACK", "dev_mode"])(
    "does not enrol under the %s runtime override, even with the preference on",
    (source) => {
      configState.telemetryEnabled = true;
      policyState.runtimeOverride = source;
      expect(resolveCanary("test-alpha").reason).toBe("telemetry_opt_out");
    },
  );

  it("never buckets an opted-out install — no cohort is assigned at all", () => {
    configState.telemetryEnabled = false;
    // A bucket number would mean we hashed them into a slice anyway.
    expect(resolveCanary("test-alpha").bucket).toBeUndefined();
  });

  it("still honours an explicit override — the documented way to test with telemetry off", () => {
    configState.telemetryEnabled = false;
    process.env.HF_CANARY_TEST_BETA = "on";
    expect(resolveCanary("test-beta")).toEqual({ enabled: true, reason: "forced_on" });
  });

  it("reports every canary as false to PostHog shape when opted out", () => {
    configState.telemetryEnabled = false;
    expect(canaryEventProperties()).toEqual({
      "$feature/canary-test-alpha": "false",
      "$feature/canary-test-gamma": "false",
      "$feature/canary-test-beta": "false",
      canary_reason_test_alpha: "telemetry_opt_out",
      canary_reason_test_gamma: "telemetry_opt_out",
      canary_reason_test_beta: "telemetry_opt_out",
    });
  });
});

describe("bucketing unit", () => {
  it("buckets on the bucketSeed when present — the unit that survives config wipes", async () => {
    const { evaluateCanary } = await import("@hyperframes/core/canary");
    configState.bucketSeed = "5f1c9d2e-0000-4000-8000-aaaaaaaaaaaa";
    const viaBinding = resolveCanary("test-gamma").bucket;
    // 50, not 100: at 100 evaluateCanary short-circuits before bucketing and
    // reports no bucket at all, which would make this comparison vacuous.
    const bySeed = evaluateCanary({
      feature: "test-gamma",
      unitId: configState.bucketSeed,
      percentage: 50,
    }).bucket;
    const byId = evaluateCanary({
      feature: "test-gamma",
      unitId: configState.anonymousId,
      percentage: 50,
    }).bucket;
    expect(viaBinding).toBe(bySeed);
    // Only meaningful if the two units actually bucket differently.
    expect(bySeed).not.toBe(byId);
  });

  it("falls back to the anonymousId when no seed exists (failed legacy backfill)", async () => {
    const { evaluateCanary } = await import("@hyperframes/core/canary");
    const viaBinding = resolveCanary("test-gamma").bucket;
    const byId = evaluateCanary({
      feature: "test-gamma",
      unitId: configState.anonymousId,
      percentage: 50,
    }).bucket;
    expect(viaBinding).toBe(byId);
    // Both undefined would satisfy toBe — assert a bucket was actually computed.
    expect(viaBinding).toEqual(expect.any(Number));
  });
});

describe("CLI canary binding", () => {
  it("reads the percentage from the registry", () => {
    expect(isCanaryEnabled("test-alpha")).toBe(true);
    expect(isCanaryEnabled("test-beta")).toBe(false);
  });

  it("an unregistered name is off, not a throw — a typo must not break a render", () => {
    expect(isCanaryEnabled("does-not-exist")).toBe(false);
    expect(resolveCanary("does-not-exist").reason).toBe("out_of_cohort");
  });

  it("HF_CANARY_<FEATURE> overrides the registry in both directions", () => {
    process.env.HF_CANARY_TEST_ALPHA = "off";
    process.env.HF_CANARY_TEST_BETA = "on";
    expect(resolveCanary("test-alpha")).toMatchObject({ enabled: false, reason: "forced_off" });
    expect(resolveCanary("test-beta")).toMatchObject({ enabled: true, reason: "forced_on" });
  });

  it("excludes CI from percentage enrolment, but an override still reaches it", () => {
    systemState.is_ci = true;
    expect(resolveCanary("test-gamma")).toMatchObject({ enabled: false, reason: "excluded" });

    __resetCanaryCacheForTests();
    process.env.HF_CANARY_TEST_GAMMA = "on";
    expect(resolveCanary("test-gamma")).toMatchObject({ enabled: true, reason: "forced_on" });
  });

  it("fails closed when the install has no anonymousId", () => {
    configState.anonymousId = "";
    expect(resolveCanary("test-gamma")).toMatchObject({ enabled: false, reason: "no_unit_id" });
  });

  it("memoizes so a decision cannot change mid-process", () => {
    expect(isCanaryEnabled("test-beta")).toBe(false);
    // A late env change must NOT flip a render that already started.
    process.env.HF_CANARY_TEST_BETA = "on";
    expect(isCanaryEnabled("test-beta")).toBe(false);
    __resetCanaryCacheForTests();
    expect(isCanaryEnabled("test-beta")).toBe(true);
  });

  it("emits PostHog flag-shaped properties for every registered canary", () => {
    expect(canaryEventProperties()).toEqual({
      "$feature/canary-test-alpha": "true",
      "$feature/canary-test-gamma": expect.stringMatching(/^(true|false)$/),
      "$feature/canary-test-beta": "false",
      canary_reason_test_alpha: "in_cohort",
      canary_reason_test_gamma: expect.stringMatching(/^(in_cohort|out_of_cohort)$/),
      canary_reason_test_beta: "out_of_cohort",
    });

    __resetCanaryCacheForTests();
    process.env.HF_CANARY_TEST_ALPHA = "off";
    expect(canaryEventProperties()["$feature/canary-test-alpha"]).toBe("false");
  });
});

// End of the wire: the CLI binding computes the reason and used to drop it.
describe("reason reaches the event properties", () => {
  it("pairs every canary's assignment with its reason", () => {
    const props = canaryEventProperties();
    expect(props["$feature/canary-test-alpha"]).toBe("true");
    expect(props["canary_reason_test_alpha"]).toBe("in_cohort");
    expect(props["canary_reason_test_beta"]).toBe("out_of_cohort");
  });

  it("reports an explicit override as forced, not as a cohort roll", () => {
    process.env.HF_CANARY_TEST_BETA = "on";
    const props = canaryEventProperties();
    expect(props["$feature/canary-test-beta"]).toBe("true");
    // Same assignment a real enrolment would produce — the reason is the only
    // thing that distinguishes them, which is the point.
    expect(props["canary_reason_test_beta"]).toBe("forced_on");
  });

  it("reports CI as excluded rather than out_of_cohort", () => {
    systemState.is_ci = true;
    // Both are enabled:false, but `excluded` was never bucketed. Conflating
    // them is what biased the first fleet accuracy read low.
    expect(canaryEventProperties()["canary_reason_test_gamma"]).toBe("excluded");
  });

  // The PR body advertises no_unit_id as one of two values that pay for
  // themselves; the resolver exercises it but the emission layer did not.
  it("reports no_unit_id at the emission layer when the install has no id", () => {
    configState.anonymousId = "";
    configState.bucketSeed = undefined;
    expect(canaryEventProperties()["canary_reason_test_gamma"]).toBe("no_unit_id");
  });

  it("reports telemetry_opt_out when the preference is off", () => {
    configState.telemetryEnabled = false;
    // Emitted for completeness; by construction such an install sends nothing,
    // so this value should never actually be observed in the warehouse.
    expect(canaryEventProperties()["canary_reason_test_alpha"]).toBe("telemetry_opt_out");
  });
});
