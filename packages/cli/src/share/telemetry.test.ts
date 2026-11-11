import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ track: vi.fn(), fresh: vi.fn(), reset: vi.fn() }));
vi.mock("../telemetry/client.js", () => ({
  trackEvent: mocks.track,
  resetTelemetryPostureCache: mocks.reset,
}));
vi.mock("../telemetry/config.js", () => ({ readConfigFresh: mocks.fresh }));
import { observeShareMutation, trackShareInteraction } from "./telemetry.js";
beforeEach(() => vi.resetAllMocks());
describe("share telemetry privacy boundary", () => {
  it("only forwards the declared interaction fields, never links or project data", () => {
    const input = {
      event: "share_link_copied" as const,
      via: "copy" as const,
      url: "https://private/token",
      project: "/example/project",
    };
    trackShareInteraction(input, "local_studio");
    expect(mocks.track).toHaveBeenCalledExactlyOnceWith("share_link_copied", {
      client_surface: "local_studio",
      via: "copy",
    });
  });
  it("refreshes persisted opt-out posture at each event in a long-lived preview", () => {
    trackShareInteraction({ event: "share_opened", link: "none" }, "local_studio");
    trackShareInteraction({ event: "share_link_copied", via: "publish" }, "local_studio");
    expect(mocks.fresh).toHaveBeenCalledTimes(2);
    expect(mocks.reset).toHaveBeenCalledTimes(2);
  });
  it("drops unknown failure reasons and never sends raw messages", async () => {
    const error = Object.assign(new Error("secret email@example.com"), {
      reason: "/secret/project",
    });
    await expect(
      observeShareMutation("update", "cli", async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(mocks.track.mock.lastCall?.[1]).toMatchObject({ reason: "other" });
    expect(JSON.stringify(mocks.track.mock.calls)).not.toContain("secret");
  });
  it("telemetry configuration errors cannot block sharing or change its failure", async () => {
    mocks.fresh.mockImplementation(() => {
      throw new Error("EACCES");
    });
    expect(await observeShareMutation("share", "cli", async () => "done")).toBe("done");
    expect(mocks.track).not.toHaveBeenCalled();
  });
});

it("forwards only bounded CTA fields with the local Studio surface", () => {
  trackShareInteraction(
    { event: "share_upgrade_clicked", reason: "project_limit" },
    "local_studio",
  );
  trackShareInteraction({ event: "share_source_toggled", enabled: false }, "local_studio");
  expect(mocks.track.mock.calls).toEqual([
    [
      "share_upgrade_clicked",
      { client_surface: "local_studio", reason: "project_limit", cta: "share_modal_upgrade" },
    ],
    ["share_source_toggled", { client_surface: "local_studio", enabled: false }],
  ]);
});
