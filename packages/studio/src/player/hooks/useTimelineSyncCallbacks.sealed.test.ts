// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import type { PlaybackAdapter } from "../lib/playbackTypes";
import { useTimelineSyncCallbacks } from "./useTimelineSyncCallbacks";
import { sealedPreviewFrame } from "../lib/sealedPreviewFrame.test-helpers";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

function processWith(iframe: HTMLIFrameElement, adapter: PlaybackAdapter | null = null) {
  const sync = vi.fn<(els: TimelineElement[], duration?: number) => void>();
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
      onAdapterReady: (_iframe, _context, commit) => commit(),
    });
    return null;
  }
  const host = document.createElement("div");
  act(() => createRoot(host).render(createElement(Harness)));
  const { processTimelineMessage, initializeAdapter } = callbacks!;
  return {
    sync,
    process: processTimelineMessage,
    initialize: () => act(() => initializeAdapter()),
  };
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

const rootOnly = `<section id="scene5-root" data-composition-id="scene5" data-duration="5">
  <h1>Scene 6</h1>
</section>`;

function rootRow(sync: ReturnType<typeof processWith>["sync"]) {
  return sync.mock.calls.at(-1)?.[0].map((row) => `${row.id}@${row.start}+${row.duration}`);
}

// fails without the fix: an empty clip list from a sealed frame committed no rows, so the composition had no clip.
it("shows a sealed composition the runtime lists no clips for as its own row", async () => {
  document.body.innerHTML = rootOnly;
  const { sync, process } = processWith(sealedPreviewFrame().iframe);

  process({ clips: [], durationInFrames: 0 });

  await vi.waitFor(() => expect(rootRow(sync)).toEqual(["scene5@0+5"]));
});

// fails without the fix: reading the sealed frame's manifest threw, so loading it ended with no clip.
it("gives a sealed composition its row when the preview loads", async () => {
  document.body.innerHTML = rootOnly;
  usePlayerStore.getState().setElements([]);
  const adapter = {
    pause() {},
    seek() {},
    play() {},
    getTime: () => 0,
    getDuration: () => 5,
    isPlaying: () => false,
  };
  const { sync, initialize } = processWith(sealedPreviewFrame().iframe, adapter);

  initialize();

  await vi.waitFor(() => expect(rootRow(sync)).toEqual(["scene5@0+5"]));
});
