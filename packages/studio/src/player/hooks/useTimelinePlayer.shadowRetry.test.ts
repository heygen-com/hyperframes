// @vitest-environment happy-dom
// A reload that ran out its budgets is tried once more, so an edit is not left unseen behind the old preview.

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SHADOW_READY_BUDGETS, SHADOW_READY_TIMEOUT_MS } from "./useShadowPreviewReload";
import { BUSY_PAGE_RETRIES, SHADOW_RETRY_DELAY_MS } from "./useShadowReloadRetry";
import { refusedPreviewMessage } from "@hyperframes/core/studio-preview-mark";
import type { TimelinePlayerApi } from "./timelinePlayerTestHarness";
import {
  makeAdapterWindow,
  makeFakeIframe,
  renderTimelinePlayerHarness,
  resetPlayerStore,
} from "./timelinePlayerTestHarness";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FULL_WAIT_MS = SHADOW_READY_TIMEOUT_MS * SHADOW_READY_BUDGETS;

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

function beginReload(onPreviewReloadFailed = vi.fn()) {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const harness = renderTimelinePlayerHarness({ onPreviewReloadFailed });
  const live = makeFakeIframe(makeAdapterWindow().win);
  act(() => {
    harness.getApi().iframeRef.current = live;
    harness.getApi().onIframeLoad();
  });
  act(() => harness.getApi().refreshPlayer());
  return { ...harness, onPreviewReloadFailed };
}

const shadows = (slots: { role: string; url?: string; gen: number }[]) =>
  slots.filter((slot) => slot.role === "shadow");

describe("a shadow reload that timed out", () => {
  it("is loaded once more after a short wait, with a fresh address", () => {
    const { getApi, onPreviewReloadFailed } = beginReload();
    const first = shadows(getApi().previewSlots)[0]!;

    act(() => void vi.advanceTimersByTime(FULL_WAIT_MS));
    expect(onPreviewReloadFailed).toHaveBeenCalledTimes(1);
    expect(shadows(getApi().previewSlots)).toHaveLength(0);

    act(() => void vi.advanceTimersByTime(SHADOW_RETRY_DELAY_MS));
    const again = shadows(getApi().previewSlots);
    expect(again).toHaveLength(1);
    expect(again[0]!.gen).toBeGreaterThan(first.gen);
    expect(new URL(again[0]!.url!, "http://x").pathname).toBe(
      new URL(first.url!, "http://x").pathname,
    );
  });

  it("is not tried a third time when the retry also runs out its budgets", () => {
    const { getApi, onPreviewReloadFailed } = beginReload();
    act(() => void vi.advanceTimersByTime(FULL_WAIT_MS + SHADOW_RETRY_DELAY_MS));
    expect(shadows(getApi().previewSlots)).toHaveLength(1);

    act(() => void vi.advanceTimersByTime(FULL_WAIT_MS + SHADOW_RETRY_DELAY_MS * 3));
    expect(onPreviewReloadFailed).toHaveBeenCalledTimes(2);
    expect(shadows(getApi().previewSlots)).toHaveLength(0);
  });

  it("is not retried when a newer reload has taken over during the wait", () => {
    const { getApi } = beginReload();
    act(() => void vi.advanceTimersByTime(FULL_WAIT_MS));
    act(() => getApi().refreshPlayer());
    const newer = shadows(getApi().previewSlots);
    expect(newer).toHaveLength(1);

    act(() => void vi.advanceTimersByTime(SHADOW_RETRY_DELAY_MS));
    expect(shadows(getApi().previewSlots)).toEqual(newer);
  });
});

/** The shadow's frame loads the page its server refused with `status`, which carries a runtime as the real one does. */
function refuse(getApi: () => TimelinePlayerApi, status: number, retryAfterS?: number) {
  const gen = shadows(getApi().previewSlots)[0]!.gen;
  const { win } = makeAdapterWindow();
  Object.assign(win, {
    __hfPreviewErrors: [refusedPreviewMessage(status)],
    ...(retryAfterS !== undefined && { __hfPreviewRetryAfter: retryAfterS }),
  });
  act(() => getApi().setShadowIframeNode(makeFakeIframe(win)));
  act(() => getApi().onShadowIframeLoad(gen));
  return gen;
}

// A server answers 503 with Retry-After when a project's folder or a page build is too slow right now: the reload asks
// again after it, instead of keeping the old preview until the next edit.
describe("a shadow reload whose page the server refused with 503", () => {
  it("asks for the page again after the server's Retry-After, a bounded number of times", () => {
    const { getApi, onPreviewReloadFailed } = beginReload();
    for (let tries = 0; tries < BUSY_PAGE_RETRIES; tries++) {
      const gen = refuse(getApi, 503, 5);
      expect(onPreviewReloadFailed).not.toHaveBeenCalled();
      expect(shadows(getApi().previewSlots)).toHaveLength(0);
      act(() => void vi.advanceTimersByTime(4_999));
      expect(shadows(getApi().previewSlots)).toHaveLength(0);
      act(() => void vi.advanceTimersByTime(1));
      expect(shadows(getApi().previewSlots)[0]!.gen).toBeGreaterThan(gen);
    }
    refuse(getApi, 503, 5);
    act(() => void vi.advanceTimersByTime(60_000));
    expect(shadows(getApi().previewSlots)).toHaveLength(0);
    expect(onPreviewReloadFailed).toHaveBeenCalledTimes(1);
  });

  it("does not ask again when the server did not say when to", () => {
    const { getApi } = beginReload();
    refuse(getApi, 503);
    act(() => void vi.advanceTimersByTime(60_000));
    expect(shadows(getApi().previewSlots)).toHaveLength(0);
  });

  it("waits at least a second when the server's Retry-After is 0", () => {
    const { getApi } = beginReload();
    refuse(getApi, 503, 0);
    act(() => void vi.advanceTimersByTime(999));
    expect(shadows(getApi().previewSlots)).toHaveLength(0);
    act(() => void vi.advanceTimersByTime(1));
    expect(shadows(getApi().previewSlots)).toHaveLength(1);
  });

  it("does not ask again for a page the server said is missing", () => {
    const { getApi } = beginReload();
    refuse(getApi, 404, 5);
    act(() => void vi.advanceTimersByTime(60_000));
    expect(shadows(getApi().previewSlots)).toHaveLength(0);
  });
});
