import { describe, expect, it, vi, beforeEach } from "vitest";

// CLI → Studio telemetry identity seeding (Layer 1). Verifies the server only
// hands the browser a distinct id when CLI telemetry is enabled, and passes
// through the anonymous machine id (no PII) otherwise.

const shouldTrack = vi.fn();
const readConfig = vi.fn();

vi.mock("../telemetry/client.js", () => ({
  shouldTrack: (...args: unknown[]) => shouldTrack(...args),
}));
vi.mock("../telemetry/config.js", () => ({
  readConfig: (...args: unknown[]) => readConfig(...args),
}));

const { resolveCliTelemetryDistinctId, buildCliIdentityScript, buildStudioHeadScripts } =
  await import("./telemetryIdentity.js");

describe("resolveCliTelemetryDistinctId", () => {
  beforeEach(() => {
    shouldTrack.mockReset();
    readConfig.mockReset();
  });

  it("returns the CLI anonymousId when telemetry is enabled", () => {
    shouldTrack.mockReturnValue(true);
    readConfig.mockReturnValue({ anonymousId: "machine-uuid" });
    expect(resolveCliTelemetryDistinctId()).toBe("machine-uuid");
  });

  it("returns null when telemetry is disabled (opt-out / dev / CI)", () => {
    shouldTrack.mockReturnValue(false);
    readConfig.mockReturnValue({ anonymousId: "machine-uuid" });
    expect(resolveCliTelemetryDistinctId()).toBeNull();
    // Must not even read config when suppressed.
    expect(readConfig).not.toHaveBeenCalled();
  });

  it("returns null when there is no anonymousId", () => {
    shouldTrack.mockReturnValue(true);
    readConfig.mockReturnValue({ anonymousId: "" });
    expect(resolveCliTelemetryDistinctId()).toBeNull();
  });

  it("never throws — returns null if config reading fails", () => {
    shouldTrack.mockReturnValue(true);
    readConfig.mockImplementation(() => {
      throw new Error("disk error");
    });
    expect(resolveCliTelemetryDistinctId()).toBeNull();
  });
});

describe("buildCliIdentityScript", () => {
  beforeEach(() => {
    shouldTrack.mockReset();
    readConfig.mockReset();
  });

  it("emits a script that sets window.__HF_CLI_DISTINCT_ID when telemetry is on", () => {
    shouldTrack.mockReturnValue(true);
    readConfig.mockReturnValue({ anonymousId: "machine-uuid" });
    expect(buildCliIdentityScript()).toBe(
      '<script>window.__HF_CLI_DISTINCT_ID="machine-uuid";</script>',
    );
  });

  it("emits an empty string when telemetry is disabled (nothing to seed)", () => {
    shouldTrack.mockReturnValue(false);
    expect(buildCliIdentityScript()).toBe("");
  });

  it("JSON-encodes the id so it can't break out of the script literal", () => {
    shouldTrack.mockReturnValue(true);
    readConfig.mockReturnValue({ anonymousId: "</script><script>alert(1)" });
    const script = buildCliIdentityScript();
    // The raw closing tag must be escaped by JSON.stringify, not emitted literally.
    expect(script).not.toContain("</script><script>alert(1)");
    expect(script).toContain("window.__HF_CLI_DISTINCT_ID=");
  });
});

describe("buildStudioHeadScripts", () => {
  beforeEach(() => {
    shouldTrack.mockReset();
    readConfig.mockReset();
  });

  const ENV_SCRIPT = "<script>window.__HF_STUDIO_ENV__={};</script>";

  it("places the CLI identity script before the env script so the global is set first", () => {
    shouldTrack.mockReturnValue(true);
    readConfig.mockReturnValue({ anonymousId: "machine-uuid" });
    const head = buildStudioHeadScripts(ENV_SCRIPT);
    expect(head.indexOf("__HF_CLI_DISTINCT_ID")).toBeGreaterThanOrEqual(0);
    expect(head.indexOf("__HF_CLI_DISTINCT_ID")).toBeLessThan(head.indexOf("__HF_STUDIO_ENV__"));
  });

  it("returns just the env script when identity is suppressed (telemetry off)", () => {
    shouldTrack.mockReturnValue(false);
    expect(buildStudioHeadScripts(ENV_SCRIPT)).toBe(ENV_SCRIPT);
  });
});
