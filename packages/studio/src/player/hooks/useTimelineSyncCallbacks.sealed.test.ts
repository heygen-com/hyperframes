// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import { useTimelineSyncCallbacks } from "./useTimelineSyncCallbacks";
import { sealedPreviewFrame } from "../lib/sealedPreviewFrame.test-helpers";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

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
  const { sync, process } = processWith(sealedPreviewFrame().iframe);

  process({ clips: [boxClip], durationInFrames: 60 });

  await vi.waitFor(() => expect(sync.mock.calls.at(-1)?.[0][0]?.domId).toBe("box"));
  const [row] = sync.mock.calls.at(-1)![0];
  expect(row).toMatchObject({
    key: "index.html#box",
    sourceFile: "index.html",
    audioGroup: "voice",
  });
});

// fails without the fix: reading the frame's `__clipTree` threw, so a sealed scene's children and parents stayed empty.
it("fills a sealed scene's children and the runtime's clip parents", async () => {
  document.body.innerHTML = `<div data-composition-id="main" data-composition-file="index.html">
    <div id="scene" data-composition-id="scene" data-composition-file="scene.html" data-start="0" data-duration="2">
      <h1 id="title">Title</h1>
    </div>
  </div>`;
  (window as unknown as { __clipTree: unknown }).__clipTree = {
    roots: [
      { id: "scene", parentId: null, children: [{ id: "cue", parentId: "scene", children: [] }] },
    ],
  };
  onTestFinished(() => delete (window as unknown as { __clipTree?: unknown }).__clipTree);
  usePlayerStore.getState().setClipParentMap(new Map());
  usePlayerStore.getState().setDomClipChildren([]);
  const { process } = processWith(sealedPreviewFrame().iframe);

  process({
    clips: [
      {
        ...boxClip,
        id: "scene",
        label: "scene",
        kind: "composition",
        tagName: "div",
        compositionId: "scene",
      },
    ],
    durationInFrames: 60,
  });

  await vi.waitFor(() => expect(usePlayerStore.getState().clipParentMap.get("cue")).toBe("scene"));
  expect(usePlayerStore.getState().domClipChildren.map((child) => child.id)).toContain("title");
});
