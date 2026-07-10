import { afterEach, describe, expect, it, vi } from "vitest";
import type { SoftReloadResult } from "../utils/gsapSoftReload";

// Mock the soft-reload primitive so we can assert syncTimingEditPreview's
// decision (soft-reload vs. escalate to full reload) without a live GSAP iframe.
const applySoftReloadMock =
  vi.fn<
    (
      iframe: HTMLIFrameElement | null,
      scriptText: string,
      onAsyncFailure?: () => void,
      currentTimeOverride?: number,
    ) => SoftReloadResult
  >();
vi.mock("../utils/gsapSoftReload", () => ({
  applySoftReload: (...args: Parameters<typeof applySoftReloadMock>) =>
    applySoftReloadMock(...args),
}));

// Imported after the mock is registered.
const { syncTimingEditPreview } = await import("./timelineEditingHelpers");

// A stand-in iframe — syncTimingEditPreview only forwards it to applySoftReload.
const fakeIframe = {} as HTMLIFrameElement;

afterEach(() => {
  applySoftReloadMock.mockReset();
});

describe("syncTimingEditPreview (timing-only edit classifier)", () => {
  it("full-reloads and never soft-reloads when the server returned no scriptText", () => {
    const reloadPreview = vi.fn();
    syncTimingEditPreview(fakeIframe, { scriptText: null }, 1.5, reloadPreview);
    expect(applySoftReloadMock).not.toHaveBeenCalled();
    expect(reloadPreview).toHaveBeenCalledTimes(1);
  });

  it("full-reloads when there is no iframe", () => {
    const reloadPreview = vi.fn();
    syncTimingEditPreview(null, { scriptText: "gsap.timeline()" }, 0, reloadPreview);
    expect(applySoftReloadMock).not.toHaveBeenCalled();
    expect(reloadPreview).toHaveBeenCalledTimes(1);
  });

  it("soft-reloads (no full reload) on the applied result, forwarding the current time", () => {
    applySoftReloadMock.mockReturnValue("applied");
    const reloadPreview = vi.fn();
    syncTimingEditPreview(fakeIframe, { scriptText: "gsap.timeline()" }, 2.25, reloadPreview);
    expect(applySoftReloadMock).toHaveBeenCalledWith(
      fakeIframe,
      "gsap.timeline()",
      reloadPreview,
      2.25,
    );
    expect(reloadPreview).not.toHaveBeenCalled();
  });

  it("does NOT escalate on the transient verify-failed result (live state is already correct)", () => {
    applySoftReloadMock.mockReturnValue("verify-failed");
    const reloadPreview = vi.fn();
    syncTimingEditPreview(fakeIframe, { scriptText: "gsap.timeline()" }, 0, reloadPreview);
    expect(reloadPreview).not.toHaveBeenCalled();
  });

  it("escalates to a full reload on the permanent cannot-soft-reload result", () => {
    applySoftReloadMock.mockReturnValue("cannot-soft-reload");
    const reloadPreview = vi.fn();
    syncTimingEditPreview(fakeIframe, { scriptText: "gsap.timeline()" }, 0, reloadPreview);
    // reloadPreview is passed as the async-failure callback AND invoked directly on
    // the permanent result. The direct escalation is the one that matters here.
    expect(reloadPreview).toHaveBeenCalledTimes(1);
  });
});
