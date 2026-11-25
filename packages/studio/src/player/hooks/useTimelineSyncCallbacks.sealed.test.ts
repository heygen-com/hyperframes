// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import type { PlaybackAdapter } from "../lib/playbackTypes";
import { useTimelineSyncCallbacks } from "./useTimelineSyncCallbacks";
import { sealedPreviewFrame } from "../lib/sealedPreviewFrame.test-helpers";
import { previewClipParents, previewDocumentCopy } from "../lib/previewChannel";
import { detachedFakeIframe } from "./timelinePlayerTestHarness";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

function processWith(
  iframe: HTMLIFrameElement,
  adapter: PlaybackAdapter | null = null,
  isCurrent?: () => boolean,
  sync = vi.fn<(els: TimelineElement[], duration?: number) => void>(),
  liveFrame?: () => HTMLIFrameElement | null,
) {
  let callbacks: ReturnType<typeof useTimelineSyncCallbacks> | undefined;
  const iframeRef: { current: HTMLIFrameElement | null } = { current: iframe };
  function Harness() {
    callbacks = useTimelineSyncCallbacks({
      iframeRef,
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
      isCurrent,
      liveFrame,
    });
    return null;
  }
  const host = document.createElement("div");
  act(() => createRoot(host).render(createElement(Harness)));
  const { processTimelineMessage, initializeAdapter, onIframeLoad } = callbacks!;
  return {
    sync,
    iframeRef,
    process: processTimelineMessage,
    enrich: () => callbacks!.enrichMissingCompositions(),
    initialize: () => act(() => initializeAdapter()),
    load: () => act(() => onIframeLoad()),
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

const adapterOf = (duration: number): PlaybackAdapter => ({
  pause() {},
  seek() {},
  play() {},
  getTime: () => 0,
  getDuration: () => duration,
  isPlaying: () => false,
});

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
  const { sync, initialize } = processWith(sealedPreviewFrame().iframe, adapterOf(5));

  initialize();

  await vi.waitFor(() => expect(rootRow(sync)).toEqual(["scene5@0+5"]));
});

// fails without the fix: the reply was read against the frame ref, which a shadow promotion has already cleared.
it("keeps a sealed load's row when its frame is promoted before the reply", async () => {
  document.body.innerHTML = rootOnly;
  usePlayerStore.getState().setElements([]);
  const promoted = sealedPreviewFrame().iframe;
  // The shadow's own ref lets go at promotion; the live ref, the one on screen, now holds its frame.
  const sync = vi.fn<(els: TimelineElement[], duration?: number) => void>();
  const shadow = processWith(
    promoted,
    adapterOf(5),
    () => true,
    sync,
    () => promoted,
  );

  shadow.initialize();
  shadow.iframeRef.current = null;

  await vi.waitFor(() => expect(rootRow(sync)).toEqual(["scene5@0+5"]));
});

// fails without the fix: the previous preview's late reply replaced the rows of the preview loaded after it.
it("drops a sealed load's reply that arrives after the next preview loaded", async () => {
  document.body.innerHTML = rootOnly;
  (window as unknown as { __clipManifest: unknown }).__clipManifest = {
    clips: [{ ...boxClip, id: "stale" }],
    durationInFrames: 60,
  };
  onTestFinished(() => delete (window as unknown as { __clipManifest?: unknown }).__clipManifest);
  usePlayerStore.getState().setElements([]);
  const sealed = sealedPreviewFrame().iframe;
  const { sync, iframeRef, initialize, load } = processWith(sealed, adapterOf(5));
  initialize();

  iframeRef.current = detachedFakeIframe({
    __clipManifest: { clips: [{ ...boxClip, id: "next" }], durationInFrames: 60 },
    scrollTo() {},
  });
  load();
  // The channel answers in order: once a later request is back, the first load's reply has landed too.
  await previewDocumentCopy(sealed);
  await previewClipParents(sealed);

  expect(sync.mock.calls.flatMap(([rows]) => rows.map((row) => row.id))).not.toContain("stale");
  expect(rootRow(sync)).toEqual(["next@0+2"]);
});

// fails without the fix: the row took the frame-rounded total, 151 frames, instead of the authored 5.01 s.
it("gives a composition's own row its authored length, not the frame-rounded total", async () => {
  document.body.innerHTML = rootOnly.replace('data-duration="5"', 'data-duration="5.01"');
  const { sync, process } = processWith(sealedPreviewFrame().iframe);

  process({ clips: [], durationInFrames: 151 });

  await vi.waitFor(() => expect(rootRow(sync)).toEqual(["scene5@0+5.01"]));
});

// fails without the fix: with no clip list and no authored length, the preview's own duration was ignored.
it("gives a sealed composition with no authored length the preview's duration", async () => {
  document.body.innerHTML = rootOnly.replace(' data-duration="5"', "");
  usePlayerStore.getState().setElements([]);
  const { sync, initialize } = processWith(sealedPreviewFrame().iframe, adapterOf(4));

  initialize();

  await vi.waitFor(() => expect(rootRow(sync)).toEqual(["scene5@0+4"]));
});

/** Studio's end of the port, holding the frame's replies until released, newest first: an older read lands last. */
function heldReplies() {
  const queue: MessageEvent[] = [];
  let holding = false;
  let deliver: ((event: MessageEvent) => void) | null = null;
  const wrap = (port: MessagePort) =>
    ({
      postMessage: (data: unknown) => port.postMessage(data),
      start: () => port.start(),
      close: () => port.close(),
      get onmessage() {
        return port.onmessage;
      },
      set onmessage(listener: ((event: MessageEvent) => void) | null) {
        deliver = listener;
        port.onmessage = listener && ((event) => (holding ? queue.push(event) : listener(event)));
      },
    }) as unknown as MessagePort;
  const releaseNewestFirst = () => {
    holding = false;
    for (const event of queue.splice(0).reverse()) deliver?.(event);
  };
  return { wrap, hold: () => (holding = true), held: () => queue.length, releaseNewestFirst };
}

// fails without the fix: an empty clip list was dropped while the timeline held rows, so a deleted clip stayed.
it("replaces the timeline's rows when a sealed load's own clip list is empty", async () => {
  document.body.innerHTML = rootOnly;
  (window as unknown as { __clipManifest: unknown }).__clipManifest = {
    clips: [],
    durationInFrames: 0,
  };
  onTestFinished(() => delete (window as unknown as { __clipManifest?: unknown }).__clipManifest);
  usePlayerStore
    .getState()
    .setElements([{ id: "deleted", start: 0, duration: 2 } as TimelineElement]);
  const { sync, initialize } = processWith(sealedPreviewFrame().iframe, adapterOf(5));

  initialize();

  await vi.waitFor(() => expect(rootRow(sync)).toEqual(["scene5@0+5"]));
});

// fails without the fix: the shadow's and the live hook's reads were ordered apart, so the older one landed last.
it("keeps a newer clip list over a promotion's read that answers after it", async () => {
  document.body.innerHTML = `<div data-composition-id="main">
    <div id="old" data-start="0" data-duration="2"></div><div id="fresh" data-start="0" data-duration="2"></div>
  </div>`;
  (window as unknown as { __clipManifest: unknown }).__clipManifest = {
    clips: [{ ...boxClip, id: "old" }],
    durationInFrames: 60,
  };
  onTestFinished(() => delete (window as unknown as { __clipManifest?: unknown }).__clipManifest);
  const replies = heldReplies();
  const frame = sealedPreviewFrame({ wrapHandedOverPort: replies.wrap }).iframe;
  await previewDocumentCopy(frame);
  const sync = vi.fn<(els: TimelineElement[], duration?: number) => void>();
  const shadow = processWith(frame, adapterOf(2), () => true, sync);
  const live = processWith(frame, adapterOf(2), undefined, sync);

  replies.hold();
  shadow.initialize();
  live.process({ clips: [{ ...boxClip, id: "fresh" }], durationInFrames: 60 });
  // The promotion's clip list, copy and tree, then the live message's copy and tree.
  await vi.waitFor(() => expect(replies.held()).toBe(5));
  replies.releaseNewestFirst();
  await vi.waitFor(() => expect(sync).toHaveBeenCalled());
  await previewDocumentCopy(frame);

  expect(rootRow(sync)).toEqual(["fresh@0+2"]);
});

// fails without the fix: the row took the preview's 4 s, then the empty list's default total clamped it to 1 s.
it("keeps a sealed root row at the preview's length over an empty list's default total", async () => {
  document.body.innerHTML = rootOnly.replace(' data-duration="5"', "");
  const { sync, process } = processWith(sealedPreviewFrame().iframe, adapterOf(4));

  process({ clips: [], durationInFrames: 30 });

  await vi.waitFor(() => expect(rootRow(sync)).toEqual(["scene5@0+4"]));
});

// fails without the fix: a replaced frame's reply still landed until the replacement's load callback ran.
it("drops a reply from a frame once another is on screen, before that one loads", async () => {
  document.body.innerHTML = `<div data-composition-id="main"><div id="stale" data-start="0" data-duration="2"></div></div>`;
  const replaced = sealedPreviewFrame().iframe;
  const { sync, iframeRef, process } = processWith(replaced, adapterOf(2));

  process({ clips: [{ ...boxClip, id: "stale" }], durationInFrames: 60 });
  iframeRef.current = detachedFakeIframe({ scrollTo() {} });
  await previewDocumentCopy(replaced);
  await previewClipParents(replaced);

  expect(sync).not.toHaveBeenCalled();
});

// fails without the fix: a read the frame's own reload cut off landed with no document; its rows lost their ids.
it("drops a sealed read the frame's own reload cut off", async () => {
  document.body.innerHTML = `<div data-composition-id="main" data-composition-file="index.html">
    <div id="box" class="clip" data-start="0" data-duration="2"></div>
  </div>`;
  const sealed = sealedPreviewFrame();
  const { sync, process } = processWith(sealed.iframe, adapterOf(2));

  process({ clips: [boxClip], durationInFrames: 60 });
  sealed.reload();
  process({ clips: [boxClip], durationInFrames: 60 });

  await vi.waitFor(() => expect(sync).toHaveBeenCalled());
  await previewDocumentCopy(sealed.iframe);
  await previewClipParents(sealed.iframe);
  expect(sync.mock.calls.flatMap(([rows]) => rows.map((row) => row.key))).toEqual([
    "index.html#box",
  ]);
});

// fails without the fix: the hidden reload's load cancelled the on-screen frame's read, so its rows never came.
it("keeps the on-screen frame's read when a hidden reload starts loading", async () => {
  document.body.innerHTML = `<div data-composition-id="main"><div id="fresh" data-start="0" data-duration="2"></div></div>`;
  const onScreen = sealedPreviewFrame().iframe;
  const sync = vi.fn<(els: TimelineElement[], duration?: number) => void>();
  const live = processWith(onScreen, adapterOf(2), undefined, sync);
  const hidden = processWith(
    detachedFakeIframe({ scrollTo() {} }),
    null,
    () => true,
    sync,
    () => live.iframeRef.current,
  );

  live.process({ clips: [{ ...boxClip, id: "fresh" }], durationInFrames: 60 });
  hidden.load();

  await vi.waitFor(() => expect(rootRow(sync)).toEqual(["fresh@0+2"]));
});

// fails without the fix: Studio left the player while the read was out, and its old rows still landed.
it("drops a sealed read whose frame its player removed before the reply", async () => {
  document.body.innerHTML = `<div data-composition-id="main"><div id="old" data-start="0" data-duration="2"></div></div>`;
  (window as unknown as { __clipManifest: unknown }).__clipManifest = {
    clips: [{ ...boxClip, id: "old" }],
    durationInFrames: 60,
  };
  onTestFinished(() => delete (window as unknown as { __clipManifest?: unknown }).__clipManifest);
  const replies = heldReplies();
  const promoted = sealedPreviewFrame({ wrapHandedOverPort: replies.wrap }).iframe;
  await previewDocumentCopy(promoted);
  const sync = vi.fn<(els: TimelineElement[], duration?: number) => void>();
  const shadow = processWith(
    promoted,
    adapterOf(2),
    () => true,
    sync,
    () => promoted,
  );

  replies.hold();
  shadow.initialize();
  await vi.waitFor(() => expect(replies.held()).toBe(3));
  promoted.remove();
  replies.releaseNewestFirst();
  await previewDocumentCopy(promoted);

  expect(sync).not.toHaveBeenCalled();
});

// Pins the promotion path: the retiring live Player's removal must not take the promoted frame's read with it.
it("lands a promoted frame's read after the old live player is removed", async () => {
  document.body.innerHTML = rootOnly;
  usePlayerStore.getState().setElements([]);
  const retiring = sealedPreviewFrame().iframe;
  const promoted = sealedPreviewFrame().iframe;
  const sync = vi.fn<(els: TimelineElement[], duration?: number) => void>();
  const live = processWith(retiring, adapterOf(5), undefined, sync);
  const shadow = processWith(
    promoted,
    adapterOf(5),
    () => true,
    sync,
    () => live.iframeRef.current,
  );

  live.iframeRef.current = promoted;
  shadow.initialize();
  retiring.remove();

  await vi.waitFor(() => expect(rootRow(sync)).toEqual(["scene5@0+5"]));
});

const NESTED = `<div data-composition-id="main" data-composition-file="index.html" data-duration="20">
  <div id="intro" data-composition-id="intro" data-composition-src="compositions/intro.html" data-start="2" data-duration="10">
    <div id="logo" data-composition-id="logo" data-composition-src="compositions/logo.html" data-start="3"></div>
  </div>
</div>`;
const introClip = { ...boxClip, id: "intro", label: "intro", start: 2, duration: 10 };
const nestedManifest = {
  clips: [
    { ...introClip, kind: "composition" as const, compositionId: "intro", timelineDuration: 10 },
    {
      ...introClip,
      ...{ id: "logo", label: "logo", start: 5, duration: 5, kind: "composition" as const },
      ...{ compositionId: "logo", parentCompositionId: "intro", timelineDuration: 5 },
    },
  ],
  durationInFrames: 600,
};

// fails without the fix: sealed, the pass that adds a composition nested in a sub-composition read the frame's
// window and never ran, so the nested host had no row; open, it gets one from its timeline's length.
it.each(["unsealed", "sealed"])(
  "gives a composition nested in a sub-composition its row, %s",
  async (mode) => {
    usePlayerStore.getState().setElements([]);
    usePlayerStore.getState().setDuration(20);
    const sync = vi.fn((els: TimelineElement[]) => usePlayerStore.getState().setElements(els));
    let iframe: HTMLIFrameElement;
    if (mode === "sealed") {
      document.body.innerHTML = NESTED;
      iframe = sealedPreviewFrame().iframe;
    } else {
      iframe = document.createElement("iframe");
      document.body.append(iframe);
      iframe.contentDocument!.body.innerHTML = NESTED;
      const logo = { duration: () => 5 };
      Object.assign(iframe.contentWindow!, {
        __timelines: { intro: { duration: () => 10 }, logo },
      });
    }
    const { process, enrich } = processWith(iframe, null, undefined, sync);

    process(nestedManifest);
    enrich();

    const rows = () =>
      usePlayerStore.getState().elements.map((r) => `${r.domId}@${r.start}+${r.duration}`);
    await vi.waitFor(() => expect(rows()).toEqual(["intro@2+10", "logo@5+5"]));
  },
);

const NO_LENGTH = NESTED;
const inheritedManifest = {
  clips: nestedManifest.clips.map((clip) =>
    clip.id === "logo" ? { ...clip, duration: 7, timelineDuration: null } : clip,
  ),
  durationInFrames: 600,
};

// fails without the fix: sealed took the length the runtime's clip list inherits for a nested composition with no
// length and no timeline, so it showed a row the open preview leaves out.
it.each(["unsealed", "sealed"])(
  "leaves out a nested composition with no length and no timeline, %s",
  async (mode) => {
    usePlayerStore.getState().setElements([]);
    usePlayerStore.getState().setDuration(20);
    const sync = vi.fn((els: TimelineElement[]) => usePlayerStore.getState().setElements(els));
    let iframe: HTMLIFrameElement;
    if (mode === "sealed") {
      document.body.innerHTML = NO_LENGTH;
      iframe = sealedPreviewFrame().iframe;
    } else {
      iframe = document.createElement("iframe");
      document.body.append(iframe);
      iframe.contentDocument!.body.innerHTML = NO_LENGTH;
      Object.assign(iframe.contentWindow!, { __timelines: { intro: { duration: () => 10 } } });
    }
    const { process, enrich } = processWith(iframe, null, undefined, sync);

    process(inheritedManifest);
    enrich();
    await vi.waitFor(() => expect(usePlayerStore.getState().elements).not.toHaveLength(0));
    // The channel answers in order: once this later request is back, the timeline read's pass has run.
    if (mode === "sealed") await previewClipParents(iframe);

    const rows = usePlayerStore
      .getState()
      .elements.map((r) => `${r.domId}@${r.start}+${r.duration}`);
    expect(rows).toEqual(["intro@2+10"]);
  },
);
