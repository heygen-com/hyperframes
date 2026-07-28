// @vitest-environment happy-dom

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { evaluateCanary } from "@hyperframes/core/canary";

// Pin the registry: real entries move as rollouts ramp, and these tests are
// about the BINDING (does the browser supply the right three inputs?), not
// about whichever canaries happen to be live today.
vi.mock("@hyperframes/core/canary-registry", async () => {
  const actual = await vi.importActual<typeof import("@hyperframes/core/canary-registry")>(
    "@hyperframes/core/canary-registry",
  );
  const defs = [
    {
      name: "on-everywhere",
      percentage: 100,
      description: "",
      owner: "t",
      sunsetAfter: "2099-01-01",
    },
    {
      name: "off-everywhere",
      percentage: 0,
      description: "",
      owner: "t",
      sunsetAfter: "2099-01-01",
    },
  ];
  return { ...actual, CANARIES: defs, findCanary: (n: string) => defs.find((d) => d.name === n) };
});

const {
  isCanaryEnabled,
  resolveCanary,
  canaryEventProperties,
  canaryParamName,
  __resetStudioCanaryCacheForTests,
} = await import("./canary");
const { resolveStudioDistinctId, __resetStudioDistinctIdForTests } = await import("./distinctId");

function setSearch(search: string): void {
  window.history.replaceState({}, "", `/${search}`);
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setSearch("");
  delete window.__HF_CLI_DISTINCT_ID;
  Object.defineProperty(navigator, "webdriver", { value: false, configurable: true });
  __resetStudioCanaryCacheForTests();
  __resetStudioDistinctIdForTests();
});

afterEach(() => {
  setSearch("");
  __resetStudioCanaryCacheForTests();
  __resetStudioDistinctIdForTests();
});

describe("studio canary binding", () => {
  it("reads the percentage from the shared registry", () => {
    expect(isCanaryEnabled("on-everywhere")).toBe(true);
    expect(isCanaryEnabled("off-everywhere")).toBe(false);
  });

  it("an unregistered name is off, not a throw — a typo must not break the editor", () => {
    expect(isCanaryEnabled("nope")).toBe(false);
    expect(resolveCanary("nope").reason).toBe("out_of_cohort");
  });

  it("derives the query param from the canary name", () => {
    expect(canaryParamName("de-parallel-router")).toBe("hf_canary_de_parallel_router");
  });
});

describe("URL override", () => {
  it("turns a canary on and off from the query string", () => {
    setSearch("?hf_canary_off_everywhere=on");
    expect(resolveCanary("off-everywhere")).toMatchObject({ enabled: true, reason: "forced_on" });

    __resetStudioCanaryCacheForTests();
    setSearch("?hf_canary_on_everywhere=off");
    expect(resolveCanary("on-everywhere")).toMatchObject({ enabled: false, reason: "forced_off" });
  });

  it("survives losing the query string, so in-app navigation keeps the override", () => {
    setSearch("?hf_canary_off_everywhere=on");
    expect(isCanaryEnabled("off-everywhere")).toBe(true);

    // Navigate away from the param — a real SPA drops it constantly.
    __resetStudioCanaryCacheForTests();
    setSearch("");
    expect(isCanaryEnabled("off-everywhere")).toBe(true);
  });

  it("is session-scoped, not persisted to localStorage", () => {
    // A URL-borne override must not silently pin a browser into a cohort
    // forever; closing the tab is the reset.
    setSearch("?hf_canary_off_everywhere=on");
    expect(isCanaryEnabled("off-everywhere")).toBe(true);
    expect(JSON.stringify(localStorage).includes("canary")).toBe(false);
    expect(sessionStorage.length).toBeGreaterThan(0);
  });

  it("=reset clears a stored override", () => {
    setSearch("?hf_canary_off_everywhere=on");
    expect(isCanaryEnabled("off-everywhere")).toBe(true);

    __resetStudioCanaryCacheForTests();
    setSearch("?hf_canary_off_everywhere=reset");
    expect(isCanaryEnabled("off-everywhere")).toBe(false);

    __resetStudioCanaryCacheForTests();
    setSearch("");
    expect(isCanaryEnabled("off-everywhere")).toBe(false);
  });
});

describe("automated browsers", () => {
  it("are excluded from percentage enrolment", () => {
    Object.defineProperty(navigator, "webdriver", { value: true, configurable: true });
    expect(resolveCanary("on-everywhere")).toMatchObject({ enabled: false, reason: "excluded" });
  });

  it("still honour an explicit override, so a canary can be tested under automation", () => {
    Object.defineProperty(navigator, "webdriver", { value: true, configurable: true });
    setSearch("?hf_canary_on_everywhere=on");
    expect(resolveCanary("on-everywhere")).toMatchObject({ enabled: true, reason: "forced_on" });
  });
});

describe("cohort identity", () => {
  it("buckets on the Studio distinct id unmodified — so a CLI-launched Studio shares the CLI's cohort", () => {
    // distinctId.ts adopts window.__HF_CLI_DISTINCT_ID when the CLI launched
    // Studio. This asserts the binding passes that id through untouched: if it
    // prefixed or re-hashed it, the editor would land in a different cohort
    // than the terminal for the same user, and a rollout spanning both would
    // be incoherent.
    const cliId = "db0c1f4a-b95e-4c35-90c6-1a15bd76f717";
    window.__HF_CLI_DISTINCT_ID = cliId;
    __resetStudioDistinctIdForTests();
    __resetStudioCanaryCacheForTests();

    expect(resolveStudioDistinctId()).toBe(cliId);
    // 50% so the answer is id-dependent rather than trivially true.
    const viaBinding = resolveCanary("on-everywhere").bucket;
    const direct = evaluateCanary({
      feature: "on-everywhere",
      unitId: cliId,
      percentage: 100,
    }).bucket;
    expect(viaBinding).toBe(direct);
  });

  it("memoizes so a decision cannot change mid-session", () => {
    expect(isCanaryEnabled("off-everywhere")).toBe(false);
    // A late override must NOT flip a component that already rendered.
    setSearch("?hf_canary_off_everywhere=on");
    expect(isCanaryEnabled("off-everywhere")).toBe(false);
    __resetStudioCanaryCacheForTests();
    expect(isCanaryEnabled("off-everywhere")).toBe(true);
  });
});

describe("telemetry", () => {
  it("emits the same PostHog flag-shaped properties as the CLI", () => {
    expect(canaryEventProperties()).toEqual({
      "$feature/canary-on-everywhere": "true",
      "$feature/canary-off-everywhere": "false",
    });

    __resetStudioCanaryCacheForTests();
    setSearch("?hf_canary_on_everywhere=off");
    expect(canaryEventProperties()["$feature/canary-on-everywhere"]).toBe("false");
  });
});
