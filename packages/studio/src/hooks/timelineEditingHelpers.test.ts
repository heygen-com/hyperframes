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
const { syncTimingEditPreview, buildTimelineMoveTimingPatch } =
  await import("./timelineEditingHelpers");

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
    expect(applySoftReloadMock).toHaveBeenCalledWith(fakeIframe, "gsap.timeline()", {
      onAsyncFailure: reloadPreview,
      currentTimeOverride: 2.25,
    });
    expect(reloadPreview).not.toHaveBeenCalled();
  });

  it("BUG 2: a single-file active-comp timing move with a successful script swap does NOT full-reload (no blink)", () => {
    // The live blink came from the move being (mis)routed through a reloading path.
    // Once a plain horizontal move is a single-clip timing edit, the fallback shifts
    // the GSAP script and swaps it in place — a successful swap ("applied") must NOT
    // trigger reloadPreview(), so the iframe never remounts and the preview never
    // blinks / re-fetches files/index.html.
    applySoftReloadMock.mockReturnValue("applied");
    const reloadPreview = vi.fn();
    syncTimingEditPreview(
      fakeIframe,
      { scriptText: 'window.__timelines["main"] = tl;' },
      3.2,
      reloadPreview,
    );
    expect(applySoftReloadMock).toHaveBeenCalledTimes(1);
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

// ── ITEM 3 — #2212 NaN insurance ────────────────────────────────────────────
describe("buildTimelineMoveTimingPatch (non-finite guard)", () => {
  it("emits both timing patches for a finite move (start + track-index, both dialects)", () => {
    expect(buildTimelineMoveTimingPatch({ start: 1.5, track: 2 })).toEqual([
      { property: "start", attr: "data-start", value: "1.5" },
      { property: "track-index", attr: "data-track-index", value: "2" },
    ]);
  });

  it("SKIPS a non-finite start (undefined→NaN) and warns once naming the field, keeping the track patch", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // The mid-stack deploy shape: `start` arrives undefined. Number.isFinite(NaN)
    // is false, so the start patch is dropped — never serialized as "NaN".
    const patches = buildTimelineMoveTimingPatch({
      start: undefined as unknown as number,
      track: 3,
    });
    expect(patches).toEqual([{ property: "track-index", attr: "data-track-index", value: "3" }]);
    expect(patches.some((p) => p.attr === "data-start")).toBe(false);
    expect(warn.mock.calls.some((call) => String(call[0]).includes("start"))).toBe(true);
    warn.mockRestore();
  });

  it("SKIPS a non-finite track and keeps the start patch", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const patches = buildTimelineMoveTimingPatch({ start: 4, track: Number.NaN });
    expect(patches).toEqual([{ property: "start", attr: "data-start", value: "4" }]);
    expect(patches.some((p) => p.attr === "data-track-index")).toBe(false);
    warn.mockRestore();
  });

  it("never serializes a NaN string — the surviving field's value is byte-identical to the finite-only patch (#2212)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Baseline: the track patch for a fully finite move.
    const finiteTrackPatch = buildTimelineMoveTimingPatch({ start: 1, track: 3 }).find(
      (p) => p.attr === "data-track-index",
    );
    // Guard fires on the non-finite start: the surviving track patch's serialized
    // string must be UNCHANGED (dropping start must not perturb it)...
    const guarded = buildTimelineMoveTimingPatch({ start: Number.NaN, track: 3 });
    expect(guarded.find((p) => p.attr === "data-track-index")).toEqual(finiteTrackPatch);
    // ...and no returned patch may ever carry the poison "NaN" string (the whole
    // point of the guard — String(NaN)/formatTimelineAttributeNumber(NaN)="NaN").
    expect(guarded.every((p) => !p.value.includes("NaN"))).toBe(true);
    warn.mockRestore();
  });
});
