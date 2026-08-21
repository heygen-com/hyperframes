// @vitest-environment happy-dom

import { describe, expect, it, vi, beforeEach } from "vitest";

// `shouldTrack()` reads module-level constants evaluated at module load time,
// so changing env after import has no effect. Each test resets module cache.

const OPT_OUT_KEY = "hyperframes-studio:telemetryDisabled";

function setNoTelemetry(value: string | undefined): void {
  if (value === undefined) {
    delete (import.meta.env as Record<string, unknown>).VITE_HYPERFRAMES_NO_TELEMETRY;
  } else {
    (import.meta.env as Record<string, unknown>).VITE_HYPERFRAMES_NO_TELEMETRY = value;
  }
}

function setDev(value: boolean): void {
  (import.meta.env as { DEV: boolean }).DEV = value;
}

async function loadShouldTrack(): Promise<() => boolean> {
  vi.resetModules();
  const mod = await import("./client");
  return mod.shouldTrack;
}

describe("studio client shouldTrack", () => {
  beforeEach(() => {
    setDev(false);
    setNoTelemetry(undefined);
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("returns true when not in dev mode and no opt-outs", async () => {
    const shouldTrack = await loadShouldTrack();
    expect(shouldTrack()).toBe(true);
  });

  it("returns false when user has opted out via localStorage", async () => {
    localStorage.setItem(OPT_OUT_KEY, "1");
    const shouldTrack = await loadShouldTrack();
    expect(shouldTrack()).toBe(false);
  });

  it("returns false when navigator.doNotTrack is '1'", async () => {
    vi.stubGlobal("navigator", { ...navigator, doNotTrack: "1" });
    const shouldTrack = await loadShouldTrack();
    expect(shouldTrack()).toBe(false);
  });

  it("returns false when VITE_HYPERFRAMES_NO_TELEMETRY=1 at build time", async () => {
    setNoTelemetry("1");
    const shouldTrack = await loadShouldTrack();
    expect(shouldTrack()).toBe(false);
  });

  it.each(["true", "TRUE", " yes ", "on"])(
    "returns false when VITE_HYPERFRAMES_NO_TELEMETRY=%j",
    async (value) => {
      setNoTelemetry(value);
      const shouldTrack = await loadShouldTrack();
      expect(shouldTrack()).toBe(false);
    },
  );

  it("does not opt out for an explicit false value", async () => {
    setNoTelemetry("false");
    const shouldTrack = await loadShouldTrack();
    expect(shouldTrack()).toBe(true);
  });

  it("returns false in vite dev mode", async () => {
    setDev(true);
    const shouldTrack = await loadShouldTrack();
    expect(shouldTrack()).toBe(false);
  });

  // Previously asserted the opposite. That memoization WAS the bug: policy.ts
  // is explicit that transports re-ask, and policy.test.ts asserts a
  // mid-session opt-out takes effect at once — but this transport cached on
  // first call, so a user who opted out in DevTools after one event kept
  // sending `studio_*` and render events while `studio:*` correctly stopped.
  it("re-reads the policy, so a mid-session opt-out takes effect immediately", async () => {
    const shouldTrack = await loadShouldTrack();
    expect(shouldTrack()).toBe(true);
    localStorage.setItem(OPT_OUT_KEY, "1");
    expect(shouldTrack()).toBe(false);
  });
});
