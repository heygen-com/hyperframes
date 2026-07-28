import { afterEach, describe, expect, it, vi } from "vitest";

async function loadShouldTrack(env: { HYPERFRAMES_NO_TELEMETRY?: string; DO_NOT_TRACK?: string }) {
  vi.resetModules();
  vi.doMock("../utils/env.js", () => ({ isDevMode: () => false }));
  vi.doMock("./config.js", () => ({
    readConfig: () => ({ telemetryEnabled: true }),
    writeConfig: () => true,
  }));
  vi.stubEnv("HYPERFRAMES_NO_TELEMETRY", env.HYPERFRAMES_NO_TELEMETRY ?? "");
  vi.stubEnv("DO_NOT_TRACK", env.DO_NOT_TRACK ?? "");
  return (await import("./client.js")).shouldTrack;
}

describe("telemetry client policy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("../utils/env.js");
    vi.doUnmock("./config.js");
    vi.resetModules();
  });

  it.each([
    ["HYPERFRAMES_NO_TELEMETRY", "true"],
    ["HYPERFRAMES_NO_TELEMETRY", " yes "],
    ["DO_NOT_TRACK", "TRUE"],
    ["DO_NOT_TRACK", "on"],
  ] as const)("does not track when %s=%j", async (name, value) => {
    const shouldTrack = await loadShouldTrack({ [name]: value });
    expect(shouldTrack()).toBe(false);
  });

  it("tracks when the config is enabled and no runtime override applies", async () => {
    const shouldTrack = await loadShouldTrack({});
    expect(shouldTrack()).toBe(true);
  });
});
