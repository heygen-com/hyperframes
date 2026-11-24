// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { detachedFakeIframe } from "./timelinePlayerTestHarness";
import { useTimelineSyncCallbacks } from "./useTimelineSyncCallbacks";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("processTimelineMessage with an empty manifest", () => {
  it("commits zero rows without adopting the runtime 1s floor as the duration", () => {
    const sync = vi.fn<(els: TimelineElement[], duration?: number) => void>();
    let processTimelineMessage: ReturnType<
      typeof useTimelineSyncCallbacks
    >["processTimelineMessage"];
    function Harness() {
      ({ processTimelineMessage } = useTimelineSyncCallbacks({
        iframeRef: { current: null },
        probeIntervalRef: { current: undefined },
        pendingSeekRef: { current: null },
        isRefreshingRef: { current: false },
        getAdapter: () => null,
        syncTimelineElements: sync,
        setDuration: () => {},
        setCurrentTime: () => {},
        requestTimelineReady: () => {},
        setIsPlaying: () => {},
        attachIframeShortcutListeners: () => {},
        applyPreviewAudioState: () => {},
      }));
      return null;
    }
    const host = document.createElement("div");
    act(() => createRoot(host).render(<Harness />));

    processTimelineMessage!({ clips: [], durationInFrames: 30 });

    expect(sync).toHaveBeenCalledWith([], undefined);
  });
});

/** An open preview of `src` showing a root composition with nothing in it. */
function emptyRootPreview(src: string, compositionId: string) {
  const iframe = detachedFakeIframe({});
  Object.defineProperty(iframe, "src", { value: src, configurable: true });
  iframe.contentDocument!.body.innerHTML = `<div id="root" data-composition-id="${compositionId}" data-start="0" data-duration="10"></div>`;
  const sync = vi.fn<(els: TimelineElement[], duration?: number) => void>();
  let processTimelineMessage: ReturnType<typeof useTimelineSyncCallbacks>["processTimelineMessage"];
  function Harness() {
    ({ processTimelineMessage } = useTimelineSyncCallbacks({
      iframeRef: { current: iframe },
      probeIntervalRef: { current: undefined },
      pendingSeekRef: { current: null },
      isRefreshingRef: { current: false },
      getAdapter: () => null,
      syncTimelineElements: sync,
      setDuration: () => {},
      setCurrentTime: () => {},
      requestTimelineReady: () => {},
      setIsPlaying: () => {},
      attachIframeShortcutListeners: () => {},
      applyPreviewAudioState: () => {},
    }));
    return null;
  }
  act(() => createRoot(document.createElement("div")).render(<Harness />));
  processTimelineMessage!({ clips: [], durationInFrames: 300 });
  return sync.mock.calls.at(-1)?.[0].map((row) => row.id);
}

describe("an empty clip list's root row", () => {
  // fails without the fix: a new blank project's timeline showed its own film as one 10 s clip named "main".
  it("is left out for the project's own film, so a blank project opens on an empty timeline", () => {
    expect(emptyRootPreview("http://localhost/api/projects/b/preview", "main")).toEqual([]);
  });

  it("is the one clip of a composition opened on its own", () => {
    expect(
      emptyRootPreview(
        "http://localhost/api/projects/b/preview/comp/compositions/scene5.html",
        "scene5",
      ),
    ).toEqual(["scene5"]);
  });
});
