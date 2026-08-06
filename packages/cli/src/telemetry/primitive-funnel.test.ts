import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const trackEvent = vi.fn();
const shouldTrack = vi.fn(() => true);
vi.mock("./client.js", () => ({
  trackEvent: (...args: unknown[]) => trackEvent(...args),
  shouldTrack: () => shouldTrack(),
}));

const { PrimitiveFunnel } = await import("./primitive-funnel.js");
const { claimPrimitiveFunnelEvent, readPrimitiveFunnelContext, writePrimitiveFunnelContext } =
  await import("./primitive-funnel-state.js");

// Funnel contract assertions intentionally share one mocked telemetry boundary.
// fallow-ignore-next-line unit-size
describe("primitive discovery funnel", () => {
  beforeEach(() => {
    trackEvent.mockClear();
    shouldTrack.mockReturnValue(true);
  });

  it("uses one stable funnel id, identifies once, and deduplicates terminal ids", () => {
    const funnel = new PrimitiveFunnel({
      funnelId: "funnel-1",
      installId: "install-1",
      artifactId: "artifact-1",
      versionId: "version-1",
      catalogVersion: "catalog-1",
      queryFingerprint: "sha256:query",
    });
    funnel.searched();
    funnel.selected();
    funnel.authRequired();
    funnel.authCompleted("account-1");
    funnel.authCompleted("account-1");
    funnel.installSucceeded("event-install");
    funnel.installSucceeded("event-install");
    funnel.previewSucceeded("event-preview");
    funnel.renderFailed("event-render", "capture_failed");

    const calls = trackEvent.mock.calls;
    expect(calls.filter(([name]) => name === "$identify")).toHaveLength(1);
    expect(calls.filter(([name]) => name === "primitive_auth_completed")).toHaveLength(1);
    expect(calls.find(([name]) => name === "$identify")?.[2]).toBe("account-1");
    expect(calls.filter(([name]) => name === "primitive_install_succeeded")).toHaveLength(1);
    expect(calls.every(([, props]) => props.funnel_id === "funnel-1")).toBe(true);
  });

  it("emits only allowlisted non-content properties and bounded errors", () => {
    const funnel = new PrimitiveFunnel({
      funnelId: "funnel-2",
      installId: "install-2",
      artifactId: "artifact-2",
      versionId: "version-2",
      catalogVersion: "catalog-2",
      queryFingerprint: "sha256:query",
    });
    funnel.installFailed("event-1", "invalid_payload");

    const payload = trackEvent.mock.lastCall?.[1] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(
      [
        "artifact_id",
        "catalog_version",
        "error_code",
        "event_id",
        "funnel_id",
        "install_id",
        "query_fingerprint",
        "version_id",
      ].sort(),
    );
    expect(JSON.stringify(payload)).not.toMatch(
      /messages|html|css|javascript|asset|token|raw_error/,
    );
  });

  it("does not enqueue or identify when telemetry is opted out", () => {
    shouldTrack.mockReturnValue(false);
    const funnel = new PrimitiveFunnel({
      funnelId: "funnel-3",
      installId: "install-3",
      artifactId: "artifact-3",
      versionId: "version-3",
      catalogVersion: "catalog-3",
      queryFingerprint: "sha256:query",
    });
    funnel.searched();
    funnel.authCompleted("account-3");
    funnel.renderSucceeded("event-3");
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it("bridges commands with only allowlisted non-content metadata", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-funnel-"));
    const context = {
      funnelId: "funnel-4",
      installId: "install-4",
      artifactId: "artifact-4",
      versionId: "version-4",
      catalogVersion: "catalog-4",
      queryFingerprint: "sha256:query",
    };
    writePrimitiveFunnelContext(dir, context);
    expect(readPrimitiveFunnelContext(dir)).toEqual(context);
    expect(claimPrimitiveFunnelEvent(dir, "install-4:preview")).toBe(true);
    expect(claimPrimitiveFunnelEvent(dir, "install-4:preview")).toBe(false);
    expect(readFileSync(join(dir, ".hyperframes", "primitive-funnel.json"), "utf8")).not.toMatch(
      /messages|html|css|javascript|asset|token|raw_error/,
    );
    rmSync(dir, { recursive: true, force: true });
  });
});
