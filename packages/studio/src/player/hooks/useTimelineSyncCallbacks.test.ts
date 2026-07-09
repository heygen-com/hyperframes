import { describe, expect, it } from "vitest";
import { resolveReloadSeekTime } from "./useTimelineSyncCallbacks";

describe("resolveReloadSeekTime", () => {
  it("restores the pending seek saved by refreshPlayer (the primary reload path)", () => {
    expect(
      resolveReloadSeekTime({
        pendingSeek: 7.2,
        requestedSeek: null,
        storeCurrentTime: 7.2,
        duration: 20,
      }),
    ).toBe(7.2);
  });

  it("honors a deep-link seek request when no pending seek exists", () => {
    expect(
      resolveReloadSeekTime({
        pendingSeek: null,
        requestedSeek: 12.5,
        storeCurrentTime: 0,
        duration: 20,
      }),
    ).toBe(12.5);
  });

  it("THE BUG: a second overlapping reload (pending seek already consumed) restores the store playhead, not 0", () => {
    // Drop → reload #1 consumes pendingSeek and seeks/syncs to 7.2. A staggered
    // second reload (refreshPreviewDocumentVersion 80/300ms bumps) then finds the
    // slot empty — the old code reset the playhead to 0 here.
    expect(
      resolveReloadSeekTime({
        pendingSeek: null,
        requestedSeek: null,
        storeCurrentTime: 7.2,
        duration: 20,
      }),
    ).toBe(7.2);
  });

  it("fresh project load starts at 0 (store resets currentTime on project switch)", () => {
    expect(
      resolveReloadSeekTime({
        pendingSeek: null,
        requestedSeek: null,
        storeCurrentTime: 0,
        duration: 20,
      }),
    ).toBe(0);
  });

  it("clamps to duration when content shrank past the playhead (the one sanctioned move)", () => {
    expect(
      resolveReloadSeekTime({
        pendingSeek: 18,
        requestedSeek: null,
        storeCurrentTime: 18,
        duration: 9,
      }),
    ).toBe(9);
  });

  it("a pending seek of 0 is an explicit position, not a missing value", () => {
    expect(
      resolveReloadSeekTime({
        pendingSeek: 0,
        requestedSeek: 12,
        storeCurrentTime: 5,
        duration: 20,
      }),
    ).toBe(0);
  });

  it("guards against non-finite and negative targets", () => {
    expect(
      resolveReloadSeekTime({
        pendingSeek: Number.NaN,
        requestedSeek: null,
        storeCurrentTime: 5,
        duration: 20,
      }),
    ).toBe(0);
    expect(
      resolveReloadSeekTime({
        pendingSeek: -3,
        requestedSeek: null,
        storeCurrentTime: 5,
        duration: 20,
      }),
    ).toBe(0);
  });
});
