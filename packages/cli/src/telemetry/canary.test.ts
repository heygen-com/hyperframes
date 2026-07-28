import { describe, expect, it, vi, beforeEach } from "vitest";

const configState = { anonymousId: "db0c1f4a-b95e-4c35-90c6-1a15bd76f717" };
const systemState = { is_ci: false };

vi.mock("./config.js", () => ({
  readConfig: () => ({ anonymousId: configState.anonymousId }),
}));
vi.mock("./system.js", () => ({
  getSystemMeta: () => ({ is_ci: systemState.is_ci }),
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
          name: "test-beta",
          percentage: 0,
          description: "",
          owner: "t",
          sunsetAfter: "2099-01-01",
        },
      ].find((c) => c.name === n),
  };
});

const { isCanaryEnabled, resolveCanary, activeCanaryNames, __resetCanaryCacheForTests } =
  await import("./canary.js");

beforeEach(() => {
  __resetCanaryCacheForTests();
  configState.anonymousId = "db0c1f4a-b95e-4c35-90c6-1a15bd76f717";
  systemState.is_ci = false;
  delete process.env.HF_CANARY_TEST_ALPHA;
  delete process.env.HF_CANARY_TEST_BETA;
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
    expect(resolveCanary("test-alpha")).toMatchObject({ enabled: false, reason: "excluded" });

    __resetCanaryCacheForTests();
    process.env.HF_CANARY_TEST_ALPHA = "on";
    expect(resolveCanary("test-alpha")).toMatchObject({ enabled: true, reason: "forced_on" });
  });

  it("fails closed when the install has no anonymousId", () => {
    configState.anonymousId = "";
    expect(resolveCanary("test-alpha")).toMatchObject({ enabled: false, reason: "no_unit_id" });
  });

  it("memoizes so a decision cannot change mid-process", () => {
    expect(isCanaryEnabled("test-beta")).toBe(false);
    // A late env change must NOT flip a render that already started.
    process.env.HF_CANARY_TEST_BETA = "on";
    expect(isCanaryEnabled("test-beta")).toBe(false);
    __resetCanaryCacheForTests();
    expect(isCanaryEnabled("test-beta")).toBe(true);
  });

  it("reports enrolled canaries for telemetry, undefined when none", () => {
    expect(activeCanaryNames()).toBe("test-alpha");
    __resetCanaryCacheForTests();
    process.env.HF_CANARY_TEST_ALPHA = "off";
    expect(activeCanaryNames()).toBeUndefined();
  });
});
