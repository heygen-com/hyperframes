// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
// The frame's real runtime agent, serving the opaque frame from this document as Studio's marked preview page.
import { installMarkedEditingAgent } from "../../../../core/src/runtime/editingAgent.test-helpers";
import type { TimelineElement } from "../store/playerStore";
import { detachedFakeIframe } from "./timelinePlayerTestHarness";
import { useTimelineSyncCallbacks } from "./useTimelineSyncCallbacks";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const closers: Array<() => void> = [];
afterEach(() => {
  closers.splice(0).forEach((close) => close());
  document.body.innerHTML = "";
});

/** A frame Studio cannot read, whose runtime is the real editing agent over this document. */
function opaqueFrame() {
  const frame: Record<string, unknown> = {};
  const iframe = detachedFakeIframe(frame);
  Object.defineProperty(iframe, "contentDocument", { value: null });
  Object.defineProperty(frame, "document", {
    get: () => {
      throw new DOMException("blocked", "SecurityError");
    },
  });
  const parent = {
    postMessage: (data: unknown, _origin: string, ports: MessagePort[]) =>
      window.dispatchEvent(
        new MessageEvent("message", { source: frame as unknown as Window, data, ports }),
      ),
  } as unknown as Window;
  const agent = installMarkedEditingAgent(parent);
  frame.postMessage = (data: unknown) =>
    window.dispatchEvent(new MessageEvent("message", { source: parent, data }));
  closers.push(() => agent.dispose());
  return iframe;
}

function processWith(iframe: HTMLIFrameElement) {
  const sync = vi.fn<(els: TimelineElement[], duration?: number) => void>();
  let callbacks: ReturnType<typeof useTimelineSyncCallbacks> | undefined;
  function Harness() {
    callbacks = useTimelineSyncCallbacks({
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
    });
    return null;
  }
  const host = document.createElement("div");
  act(() => createRoot(host).render(createElement(Harness)));
  return { sync, process: callbacks!.processTimelineMessage };
}

const boxClip = {
  id: "box",
  label: "box",
  start: 0,
  duration: 2,
  track: 0,
  kind: "element" as const,
  tagName: "div",
  compositionId: null,
  parentCompositionId: null,
  compositionSrc: null,
  assetUrl: null,
};

// fails without the fix: a sealed frame's rows had no element behind them, so no id, source file or audio group.
it("binds a sealed preview's timeline row to its element, as an open preview does", async () => {
  document.body.innerHTML = `<div data-composition-id="main" data-composition-file="index.html">
    <div id="box" class="clip" data-start="0" data-duration="2" data-audio-group="voice"></div>
  </div>`;
  const { sync, process } = processWith(opaqueFrame());

  process({ clips: [boxClip], durationInFrames: 60 });

  await vi.waitFor(() => expect(sync.mock.calls.at(-1)?.[0][0]?.domId).toBe("box"));
  const [row] = sync.mock.calls.at(-1)![0];
  expect(row).toMatchObject({
    key: "index.html#box",
    sourceFile: "index.html",
    audioGroup: "voice",
  });
});
