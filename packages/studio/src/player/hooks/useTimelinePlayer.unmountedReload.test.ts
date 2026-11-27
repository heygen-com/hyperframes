// @vitest-environment happy-dom
// A reload asked of an unmounted player starts nothing: no late failure and no changing mark on the open preview.

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SHADOW_READY_BUDGETS, SHADOW_READY_TIMEOUT_MS } from "./useShadowPreviewReload";
import { isPreviewChanging } from "../previewReloading";
import {
  makeAdapterWindow,
  makeFakeIframe,
  renderTimelinePlayerHarness,
  resetPlayerStore,
} from "./timelinePlayerTestHarness";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../utils/gsapSoftReload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/gsapSoftReload")>()),
  ensureMotionPathPluginLoaded: vi.fn(),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  resetPlayerStore();
});

describe("a reload asked of an unmounted player", () => {
  it("never starts, so it never gives up and the open preview is not held as changing", () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onPreviewReloadFailed = vi.fn();
    const { getApi, root } = renderTimelinePlayerHarness({ onPreviewReloadFailed });
    act(() => {
      getApi().iframeRef.current = makeFakeIframe(makeAdapterWindow().win);
      getApi().onIframeLoad();
    });
    const api = getApi();

    act(() => root.unmount());
    api.refreshPlayer();
    expect(isPreviewChanging()).toBe(false);
    vi.advanceTimersByTime(SHADOW_READY_TIMEOUT_MS * SHADOW_READY_BUDGETS * 3);

    expect(onPreviewReloadFailed).not.toHaveBeenCalled();
  });
});
