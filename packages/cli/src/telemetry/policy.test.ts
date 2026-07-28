import { afterEach, describe, expect, it, vi } from "vitest";

async function loadPolicy(options?: { devMode?: boolean; apiKey?: string }) {
  vi.resetModules();
  vi.doMock("../utils/env.js", () => ({
    isDevMode: () => options?.devMode ?? false,
  }));
  vi.doMock("./transport.js", () => ({
    POSTHOG_API_KEY: options?.apiKey ?? "phc_test",
  }));
  return import("./policy.js");
}

describe("telemetry policy", () => {
  afterEach(() => {
    vi.doUnmock("../utils/env.js");
    vi.doUnmock("./transport.js");
    vi.resetModules();
    delete process.env["HYPERFRAMES_NO_TELEMETRY"];
    delete process.env["DO_NOT_TRACK"];
  });

  it.each(["1", "true", "TRUE", " yes ", "on"])(
    "treats %j as an explicit environment opt-out",
    async (value) => {
      process.env["HYPERFRAMES_NO_TELEMETRY"] = value;
      const { effectiveTelemetryStatus } = await loadPolicy();
      expect(effectiveTelemetryStatus(true).source).toBe("HYPERFRAMES_NO_TELEMETRY");
    },
  );

  it.each(["", "0", "false", "no", "off", "anything"])(
    "does not treat %j as an affirmative opt-out value",
    async (value) => {
      process.env["HYPERFRAMES_NO_TELEMETRY"] = value;
      const { effectiveTelemetryStatus } = await loadPolicy();
      expect(effectiveTelemetryStatus(true)).toEqual({ enabled: true, source: "config" });
    },
  );

  it("reports HYPERFRAMES_NO_TELEMETRY as the effective source", async () => {
    process.env["HYPERFRAMES_NO_TELEMETRY"] = "true";
    const { effectiveTelemetryStatus } = await loadPolicy();
    expect(effectiveTelemetryStatus(true)).toEqual({
      enabled: false,
      source: "HYPERFRAMES_NO_TELEMETRY",
    });
  });

  it("reports DO_NOT_TRACK as the effective source", async () => {
    process.env["DO_NOT_TRACK"] = "yes";
    const { effectiveTelemetryStatus } = await loadPolicy();
    expect(effectiveTelemetryStatus(true)).toEqual({
      enabled: false,
      source: "DO_NOT_TRACK",
    });
  });

  it("reports dev mode instead of claiming telemetry is active", async () => {
    const { effectiveTelemetryStatus } = await loadPolicy({ devMode: true });
    expect(effectiveTelemetryStatus(true)).toEqual({
      enabled: false,
      source: "dev_mode",
    });
  });

  it("reports a telemetry-disabled build instead of claiming telemetry is active", async () => {
    const { effectiveTelemetryStatus } = await loadPolicy({ apiKey: "disabled" });
    expect(effectiveTelemetryStatus(true)).toEqual({
      enabled: false,
      source: "telemetry_disabled_build",
    });
  });

  it("falls back to the persisted preference when no runtime override applies", async () => {
    const { effectiveTelemetryStatus } = await loadPolicy();
    expect(effectiveTelemetryStatus(false)).toEqual({ enabled: false, source: "config" });
    expect(effectiveTelemetryStatus(true)).toEqual({ enabled: true, source: "config" });
  });
});
