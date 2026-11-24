// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import type { PlaybackAdapter } from "../lib/playbackTypes";
import { previewClipParents } from "../lib/previewChannel";
import { sealedPreviewFrame } from "../lib/sealedPreviewFrame.test-helpers";
import { createPreviewMessageHandler } from "./previewMessageRouter";
import { detachedFakeIframe } from "./timelinePlayerTestHarness";
import { useTimelineSyncCallbacks } from "./useTimelineSyncCallbacks";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Posts `data` to the real router over the real timeline sync for `iframe`; rows land in the store. */
function routeTimeline(iframe: HTMLIFrameElement, frame: object, adapter: PlaybackAdapter | null) {
  usePlayerStore.getState().setElements([]);
  const sync = vi.fn((els: TimelineElement[]) => usePlayerStore.getState().setElements(els));
  let callbacks: ReturnType<typeof useTimelineSyncCallbacks> | undefined;
  function Harness() {
    callbacks = useTimelineSyncCallbacks({
      iframeRef: { current: iframe },
      probeIntervalRef: { current: undefined },
      pendingSeekRef: { current: null },
      isRefreshingRef: { current: false },
      getAdapter: () => adapter,
      syncTimelineElements: sync,
      setDuration: () => {},
      setCurrentTime: () => {},
      requestTimelineReady: () => {},
      setIsPlaying: () => {},
      attachIframeShortcutListeners: () => {},
      applyPreviewAudioState: () => {},
    });
    return null;
  }
  act(() => createRoot(document.createElement("div")).render(createElement(Harness)));
  const handle = createPreviewMessageHandler({
    iframeRef: { current: iframe },
    processTimelineMessageRef: callbacks!.processTimelineMessageRef,
    enrichMissingCompositionsRef: callbacks!.enrichMissingCompositionsRef,
    lastTimelineMessageRef: { current: 0 },
  });
  return (data: unknown, origin = window.location.origin) =>
    handle(new MessageEvent("message", { source: frame as Window, origin, data }));
}

const rows = () =>
  usePlayerStore.getState().elements.map((r) => `${r.domId}@${r.start}+${r.duration}`);
const emptyList = { source: "hf-preview", type: "timeline", clips: [], durationInFrames: 300 };

// Pins an open preview's rows for an empty clip list: the timeline sync parses the document, the router adds nothing.
it("fills an open preview's empty clip list from its document, through the router", () => {
  const frame = {};
  const iframe = detachedFakeIframe(frame);
  iframe.contentDocument!.body.innerHTML = `<div data-composition-id="main" data-duration="10">
    <div id="box" class="clip" data-start="1" data-duration="2"></div>
  </div>`;

  routeTimeline(iframe, frame, null)(emptyList);

  expect(rows()).toEqual(["box@1+2"]);
});

const UNPLAYED = `<div data-composition-id="main">
  <div id="host" data-composition-id="host" data-start="5">
    <div id="cue" class="clip" data-start="0" data-duration="2"></div>
  </div>
</div>`;
const OWN_FILM = "http://localhost/api/projects/demo/preview";
const playerOf = (seconds: number) => ({ getDuration: () => seconds }) as PlaybackAdapter;

// The one change to an open preview's rows: before, the router parsed the document again at the player's length and
// showed rows for a nested clip the runtime's clip list cut away, content the preview never plays.
it.each(["unsealed", "sealed"])(
  "shows no row for an empty clip list whose only timed clip is one the runtime cut away, %s",
  async (mode) => {
    let post: ReturnType<typeof routeTimeline>;
    if (mode === "sealed") {
      document.body.innerHTML = UNPLAYED;
      const { iframe, frame } = sealedPreviewFrame();
      Object.defineProperty(iframe, "src", { value: OWN_FILM });
      post = routeTimeline(iframe, frame, playerOf(10));
      post(emptyList, "null");
      // The channel answers in order: once this later request is back, the sealed timeline read has landed.
      await previewClipParents(iframe);
    } else {
      const frame = {};
      const iframe = detachedFakeIframe(frame);
      Object.defineProperty(iframe, "src", { value: OWN_FILM });
      iframe.contentDocument!.body.innerHTML = UNPLAYED;
      post = routeTimeline(iframe, frame, playerOf(10));
      post(emptyList);
    }

    expect(rows()).toEqual([]);
  },
);
