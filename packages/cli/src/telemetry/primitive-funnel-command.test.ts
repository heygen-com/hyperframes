import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const trackEvent = vi.fn();
let delivered = true;
let tracking = true;
vi.mock("./client.js", () => ({
  trackEvent: (...args: unknown[]) => trackEvent(...args),
  shouldTrack: () => tracking,
  flush: () => Promise.resolve(delivered),
}));

const { writePrimitiveFunnelContext } = await import("./primitive-funnel-state.js");
const {
  trackPrimitivePreviewSucceeded,
  trackPrimitiveRenderFailed,
  trackPrimitiveRenderSucceeded,
} = await import("./primitive-funnel-command.js");

function claimMarkerPath(projectDir: string, eventId: string): string {
  const digest = createHash("sha256").update(eventId).digest("hex");
  return join(projectDir, ".hyperframes", "primitive-funnel-claims", `${digest}.claim`);
}

function emittedEventIds(projectDir: string): string[] {
  const state: unknown = JSON.parse(
    readFileSync(join(projectDir, ".hyperframes", "primitive-funnel.json"), "utf8"),
  );
  return (state as { emittedEventIds: string[] }).emittedEventIds;
}

describe("persisted primitive funnel command continuity", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "hf-funnel-command-"));
    trackEvent.mockReset();
    delivered = true;
    tracking = true;
    writePrimitiveFunnelContext(projectDir, {
      funnelId: "funnel-command",
      installId: "install-command",
      primitiveId: "thread-message-stack",
      artifactId: "artifact-command",
      versionId: "version-command",
      catalogVersion: "catalog-command",
      queryFingerprint: "sha256:query",
    });
  });

  afterEach(() => rmSync(projectDir, { recursive: true, force: true }));

  it("propagates bounded command duration and deduplicates preview/render terminals", async () => {
    await trackPrimitivePreviewSucceeded(projectDir, 12.4);
    await trackPrimitivePreviewSucceeded(projectDir, 98);
    await trackPrimitiveRenderFailed(projectDir, "render_failed", 23.6);
    await trackPrimitiveRenderSucceeded(projectDir, 99);

    expect(trackEvent.mock.calls.map(([name]) => name)).toEqual([
      "primitive_preview_succeeded",
      "primitive_render_failed",
    ]);
    expect(trackEvent.mock.calls[0]?.[1]).toMatchObject({
      funnel_id: "funnel-command",
      primitive_id: "thread-message-stack",
      duration_ms: 12,
      event_id: "install-command:preview",
      funnel_step: 7,
    });
    expect(trackEvent.mock.calls[1]?.[1]).toMatchObject({
      funnel_id: "funnel-command",
      duration_ms: 24,
      error_code: "render_failed",
      event_id: "install-command:render",
      funnel_step: 8,
    });
  });

  it("releases the claim when the batch is never acknowledged, so a later command retries", async () => {
    delivered = false;
    await trackPrimitivePreviewSucceeded(projectDir, 10);

    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(existsSync(claimMarkerPath(projectDir, "install-command:preview"))).toBe(false);
    expect(emittedEventIds(projectDir)).not.toContain("install-command:preview");

    // Same install, later command: the step is emitted rather than lost forever.
    delivered = true;
    await trackPrimitivePreviewSucceeded(projectDir, 11);
    expect(trackEvent.mock.calls.map(([name]) => name)).toEqual([
      "primitive_preview_succeeded",
      "primitive_preview_succeeded",
    ]);
    expect(existsSync(claimMarkerPath(projectDir, "install-command:preview"))).toBe(true);
  });

  it("keeps the claim when the batch is acknowledged", async () => {
    await trackPrimitivePreviewSucceeded(projectDir, 10);

    expect(existsSync(claimMarkerPath(projectDir, "install-command:preview"))).toBe(true);
    expect(emittedEventIds(projectDir)).toContain("install-command:preview");
  });

  it("does not spend a claim while telemetry is opted out", async () => {
    tracking = false;
    await trackPrimitivePreviewSucceeded(projectDir, 10);

    expect(trackEvent).not.toHaveBeenCalled();
    expect(existsSync(claimMarkerPath(projectDir, "install-command:preview"))).toBe(false);

    // Re-enabling tracking must still be able to emit the step.
    tracking = true;
    await trackPrimitivePreviewSucceeded(projectDir, 10);
    expect(trackEvent).toHaveBeenCalledTimes(1);
  });
});
