// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "../store/playerStore";
import {
  attachIframeWindow,
  makeAdapterWindow,
  renderTimelinePlayerHarness,
  resetPlayerStore,
} from "./timelinePlayerTestHarness";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  resetPlayerStore();
});

describe("useTimelinePlayer tab hidden while playing", () => {
  it("pauses on the adapter's time, like any other pause", () => {
    const { api, root } = renderTimelinePlayerHarness();
    const { adapter, win } = makeAdapterWindow();
    attachIframeWindow(api, win);
    act(() => api.play());
    adapter.seek(6);

    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    act(() => void document.dispatchEvent(new Event("visibilitychange")));

    expect(usePlayerStore.getState().isPlaying).toBe(false);
    expect(usePlayerStore.getState().currentTime).toBe(6);
    act(() => root.unmount());
  });
});
