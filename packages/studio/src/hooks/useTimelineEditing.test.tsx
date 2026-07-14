// @vitest-environment happy-dom

import React, { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { openComposition } from "@hyperframes/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore, type TimelineElement } from "../player";
import { useElementLifecycleOps } from "./useElementLifecycleOps";
import { useTimelineEditing } from "./useTimelineEditing";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ZIndexEntry = {
  element: HTMLElement;
  zIndex: number;
  id?: string;
  selector?: string;
  selectorIndex?: number;
  sourceFile: string;
};

afterEach(() => {
  document.body.innerHTML = "";
  usePlayerStore.getState().reset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function createPreviewIframe(
  clips: Array<{
    id: string;
    track: number;
    style?: string;
  }> = [
    { id: "front", track: 0 },
    { id: "back", track: 1 },
  ],
): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const doc = iframe.contentDocument;
  if (!doc) throw new Error("Expected iframe document");
  doc.body.innerHTML = clips
    .map(
      (clip) =>
        `<div id="${clip.id}" data-start="0" data-duration="2" data-track-index="${clip.track}"${
          clip.style ? ` style="${clip.style}"` : ""
        }></div>`,
    )
    .join("\n");
  return iframe;
}

function timelineElement(input: {
  id: string;
  track: number;
  zIndex: number;
  tag?: string;
  start?: number;
  duration?: number;
  sourceFile?: string;
}): TimelineElement {
  return {
    id: input.id,
    domId: input.id,
    hfId: `hf-${input.id}`,
    tag: input.tag ?? "div",
    start: input.start ?? 0,
    duration: input.duration ?? 2,
    track: input.track,
    zIndex: input.zIndex,
    stackingContextId: "root",
    parentCompositionId: null,
    compositionAncestors: ["root"],
    sourceFile: input.sourceFile ?? "index.html",
    timingSource: "authored",
  };
}

/** Mount a harness component under act() and return its unmount hook. */
function mountHarness(node: React.ReactElement): { unmount: () => void } {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(node);
  });
  return {
    unmount: () => {
      act(() => root.unmount());
    },
  };
}

function renderTimelineEditingHook(input: {
  timelineElements: TimelineElement[];
  iframe: HTMLIFrameElement;
  onZIndexCommit: (entries: ZIndexEntry[]) => Promise<void>;
  projectId?: string | null;
  writeProjectFile?: (path: string, content: string) => Promise<void>;
  recordEdit?: (input: {
    label: string;
    kind: string;
    coalesceKey?: string;
    files: Record<string, { before: string; after: string }>;
  }) => Promise<void>;
  reloadPreview?: () => void;
  sdkSession?: Awaited<ReturnType<typeof openComposition>> | null;
  forceReloadSdkSession?: () => void;
  showToast?: (message: string, kind?: string) => void;
}): {
  move: ReturnType<typeof useTimelineEditing>["handleTimelineElementMove"];
  resize: ReturnType<typeof useTimelineEditing>["handleTimelineElementResize"];
  groupMove: ReturnType<typeof useTimelineEditing>["handleTimelineGroupMove"];
  groupResize: ReturnType<typeof useTimelineEditing>["handleTimelineGroupResize"];
  del: ReturnType<typeof useTimelineEditing>["handleTimelineElementDelete"];
  unmount: () => void;
} {
  let move: ReturnType<typeof useTimelineEditing>["handleTimelineElementMove"] | null = null;
  let resize: ReturnType<typeof useTimelineEditing>["handleTimelineElementResize"] | null = null;
  let groupMove: ReturnType<typeof useTimelineEditing>["handleTimelineGroupMove"] | null = null;
  let groupResize: ReturnType<typeof useTimelineEditing>["handleTimelineGroupResize"] | null = null;
  let del: ReturnType<typeof useTimelineEditing>["handleTimelineElementDelete"] | null = null;

  function Harness() {
    const commitRef = useRef(input.onZIndexCommit);
    commitRef.current = input.onZIndexCommit;
    const hook = useTimelineEditing({
      projectId: input.projectId ?? null,
      activeCompPath: "index.html",
      timelineElements: input.timelineElements,
      showToast: input.showToast ?? vi.fn(),
      writeProjectFile: input.writeProjectFile ?? vi.fn(),
      recordEdit: input.recordEdit ?? vi.fn(),
      domEditSaveTimestampRef: { current: 0 },
      reloadPreview: input.reloadPreview ?? vi.fn(),
      previewIframeRef: { current: input.iframe },
      pendingTimelineEditPathRef: { current: new Set<string>() },
      uploadProjectFiles: vi.fn(),
      sdkSession: input.sdkSession,
      forceReloadSdkSession: input.forceReloadSdkSession,
      handleDomZIndexReorderCommitRef: commitRef,
    });
    move = hook.handleTimelineElementMove;
    resize = hook.handleTimelineElementResize;
    groupMove = hook.handleTimelineGroupMove;
    groupResize = hook.handleTimelineGroupResize;
    del = hook.handleTimelineElementDelete;
    return null;
  }

  const { unmount } = mountHarness(<Harness />);
  if (!move) throw new Error("Expected hook to expose move handler");
  if (!resize) throw new Error("Expected hook to expose resize handler");
  if (!groupMove) throw new Error("Expected hook to expose group move handler");
  if (!groupResize) throw new Error("Expected hook to expose group resize handler");
  if (!del) throw new Error("Expected hook to expose delete handler");
  return { move, resize, groupMove, groupResize, del, unmount };
}

type TimelineRecordEdit = NonNullable<
  Parameters<typeof renderTimelineEditingHook>[0]["recordEdit"]
>;

function renderTimelineEditingHookWithLifecycle(input: {
  timelineElements: TimelineElement[];
  iframe: HTMLIFrameElement;
  commitDomEditPatchBatches: ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<void>>>;
}): {
  move: ReturnType<typeof useTimelineEditing>["handleTimelineElementMove"];
  unmount: () => void;
} {
  let move: ReturnType<typeof useTimelineEditing>["handleTimelineElementMove"] | null = null;

  function Harness() {
    const lifecycle = useElementLifecycleOps({
      activeCompPath: "index.html",
      showToast: vi.fn(),
      writeProjectFile: vi.fn(),
      domEditSaveTimestampRef: { current: 0 },
      editHistory: { recordEdit: vi.fn() },
      projectIdRef: { current: "p1" },
      reloadPreview: vi.fn(),
      clearDomSelection: vi.fn(),
      commitDomEditPatchBatches: input.commitDomEditPatchBatches,
    });
    const commitRef = useRef(lifecycle.handleDomZIndexReorderCommit);
    commitRef.current = lifecycle.handleDomZIndexReorderCommit;
    const hook = useTimelineEditing({
      projectId: null,
      activeCompPath: "index.html",
      timelineElements: input.timelineElements,
      showToast: vi.fn(),
      writeProjectFile: vi.fn(),
      recordEdit: vi.fn(),
      domEditSaveTimestampRef: { current: 0 },
      reloadPreview: vi.fn(),
      previewIframeRef: { current: input.iframe },
      pendingTimelineEditPathRef: { current: new Set<string>() },
      uploadProjectFiles: vi.fn(),
      handleDomZIndexReorderCommitRef: commitRef,
    });
    move = hook.handleTimelineElementMove;
    return null;
  }

  const { unmount } = mountHarness(<Harness />);
  if (!move) throw new Error("Expected hook to expose move handler");
  return { move, unmount };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

async function flushAsyncWork(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve();
  }
}

/**
 * Stub global fetch for project "p1": serves file contents (a single source
 * string, or a path → content map) and answers the GSAP-mutation endpoint
 * with `gsapBody`. Returns the mock for call inspection.
 */
function stubProjectFetch(
  files: string | Record<string, string>,
  gsapBody: unknown = { ok: true },
) {
  const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
    const url = requestUrl(input);
    if (url.includes("/api/projects/p1/files/")) {
      if (typeof files === "string") return jsonResponse({ content: files });
      const path = decodeURIComponent(url.split("/files/")[1] ?? "index.html");
      return jsonResponse({ content: files[path] });
    }
    if (url.includes("/api/projects/p1/gsap-mutations/")) return jsonResponse(gsapBody);
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const ROOT_DURATION_FALLBACK_SOURCE = [
  `<div data-composition-id="main" data-duration="4">`,
  `  <div id="clip" data-hf-id="hf-clip" data-start="0" data-duration="2"></div>`,
  `</div>`,
].join("\n");

/** Shared setup for the SDK-fallback root-duration tests: one 2s clip in a 4s comp. */
async function setupRootDurationFallback() {
  const iframe = createPreviewIframe([{ id: "clip", track: 0 }]);
  const clip = timelineElement({ id: "clip", track: 0, zIndex: 0 });
  const sdkSession = await openComposition(ROOT_DURATION_FALLBACK_SOURCE);
  const setTimingSpy = vi.spyOn(sdkSession, "setTiming");
  const writeProjectFile = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
  const recordEdit = vi.fn<TimelineRecordEdit>(async () => {});
  const forceReloadSdkSession = vi.fn();
  const reloadPreview = vi.fn();
  const iframeWindow = iframe.contentWindow;
  if (!iframeWindow) throw new Error("Expected iframe window");
  const postMessageSpy = vi.spyOn(iframeWindow, "postMessage");
  stubProjectFetch(ROOT_DURATION_FALLBACK_SOURCE, { ok: true, mutated: false });
  usePlayerStore.getState().setDuration(4);
  const hook = renderTimelineEditingHook({
    timelineElements: [clip],
    iframe,
    onZIndexCommit: vi.fn().mockResolvedValue(undefined),
    projectId: "p1",
    writeProjectFile,
    recordEdit,
    sdkSession,
    forceReloadSdkSession,
    reloadPreview,
  });
  return {
    hook,
    clip,
    setTimingSpy,
    writeProjectFile,
    forceReloadSdkSession,
    reloadPreview,
    postMessageSpy,
  };
}

/** Shared assertions: the fallback path grew the root to 5s and did ONE full reload. */
function expectRootDurationExtendedViaFallback(
  ctx: Awaited<ReturnType<typeof setupRootDurationFallback>>,
): void {
  expect(ctx.setTimingSpy).not.toHaveBeenCalled();
  expect(ctx.writeProjectFile.mock.calls[0]![1]).toContain(
    'data-composition-id="main" data-duration="5"',
  );
  expect(usePlayerStore.getState().duration).toBe(5);
  expect(ctx.forceReloadSdkSession).toHaveBeenCalledTimes(1);
  // The GSAP endpoint returned no rewritten scriptText, so the timing sync
  // escalates from the flash-free soft reload to ONE full reload. The root
  // duration travels via the persisted content-driven `data-duration` (above),
  // not a `set-root-duration` postMessage.
  expect(ctx.reloadPreview).toHaveBeenCalledTimes(1);
  expect(ctx.postMessageSpy).not.toHaveBeenCalledWith(
    expect.objectContaining({ action: "set-root-duration" }),
    "*",
  );
}

describe("useTimelineEditing timeline z-index reorder", () => {
  it("extends root duration through the fallback path when an SDK-backed move passes the end", async () => {
    const ctx = await setupRootDurationFallback();

    await act(async () => {
      await ctx.hook.move(ctx.clip, { start: 3, track: ctx.clip.track });
    });

    expect(ctx.writeProjectFile.mock.calls[0]![1]).toContain('data-start="3"');
    expectRootDurationExtendedViaFallback(ctx);

    ctx.hook.unmount();
  });

  it("extends root duration through the fallback path when an SDK-backed resize passes the end", async () => {
    const ctx = await setupRootDurationFallback();

    await act(async () => {
      await ctx.hook.resize(ctx.clip, { start: 0, duration: 5, playbackStart: undefined });
    });

    expect(ctx.writeProjectFile.mock.calls[0]![1]).toContain('data-duration="5"></div>');
    expectRootDurationExtendedViaFallback(ctx);

    ctx.hook.unmount();
  });

  it("routes a vertical drag through the shared z-index commit without writing track-index", async () => {
    const iframe = createPreviewIframe([
      { id: "front", track: 0, style: "position: relative; z-index: 10" },
      { id: "back", track: 2, style: "position: relative; z-index: 1" },
    ]);
    const front = timelineElement({ id: "front", track: 0, zIndex: 10 });
    const back = timelineElement({ id: "back", track: 2, zIndex: 1 });
    const commit = vi.fn<(entries: ZIndexEntry[]) => Promise<void>>().mockResolvedValue(undefined);
    const { move, unmount } = renderTimelineEditingHook({
      timelineElements: [front, back],
      iframe,
      onZIndexCommit: commit,
    });

    await act(async () => {
      await move(back, {
        start: back.start,
        track: back.track,
        stackingReorder: {
          contextKey: "root",
          placement: { type: "onto", layerId: "layer-front" },
          zIndexChanges: [{ key: "back", zIndex: 10 }],
        },
      });
    });

    const doc = iframe.contentDocument;
    if (!doc) throw new Error("Expected iframe document");

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0]![0].map((entry) => [entry.id, entry.zIndex])).toEqual([
      ["back", 10],
    ]);
    expect(doc.getElementById("back")?.getAttribute("data-track-index")).toBe("2");

    unmount();
  });

  it("never writes z-index when the dragged clip is audio (no visual layer)", async () => {
    const iframe = createPreviewIframe([
      { id: "front", track: 0 },
      { id: "music", track: 1 },
    ]);
    const front = timelineElement({ id: "front", track: 0, zIndex: 0 });
    const music = timelineElement({ id: "music", track: 1, zIndex: 0, tag: "audio" });
    const commit = vi.fn<(entries: ZIndexEntry[]) => Promise<void>>().mockResolvedValue(undefined);
    const { move, unmount } = renderTimelineEditingHook({
      timelineElements: [front, music],
      iframe,
      onZIndexCommit: commit,
    });

    await act(async () => {
      await move(music, {
        start: music.start,
        track: music.track,
        stackingReorder: {
          contextKey: "root",
          placement: { type: "onto", layerId: "layer-front" },
          zIndexChanges: [{ key: "music", zIndex: 2 }],
        },
      });
    });

    expect(commit).not.toHaveBeenCalled();

    unmount();
  });

  it("commits only the minimum z-index changes resolved by the timeline drag", async () => {
    const iframe = createPreviewIframe([
      { id: "front", track: 0, style: "position: relative; z-index: 2" },
      { id: "back", track: 1, style: "position: relative; z-index: 1" },
      { id: "dragged", track: 2, style: "position: relative; z-index: 0" },
    ]);
    const front = timelineElement({ id: "front", track: 0, zIndex: 2 });
    const back = timelineElement({ id: "back", track: 1, zIndex: 1 });
    const dragged = timelineElement({ id: "dragged", track: 2, zIndex: 0 });
    const commit = vi.fn<(entries: ZIndexEntry[]) => Promise<void>>().mockResolvedValue(undefined);
    const { move, unmount } = renderTimelineEditingHook({
      timelineElements: [front, back, dragged],
      iframe,
      onZIndexCommit: commit,
    });

    await act(async () => {
      await move(dragged, {
        start: dragged.start,
        track: dragged.track,
        stackingReorder: {
          contextKey: "root",
          placement: { type: "between", beforeLayerId: "front", afterLayerId: "back" },
          zIndexChanges: [
            { key: "dragged", zIndex: 2 },
            { key: "front", zIndex: 3 },
          ],
        },
      });
    });

    expect(commit.mock.calls[0]![0].map((entry) => [entry.id, entry.zIndex])).toEqual([
      ["dragged", 2],
      ["front", 3],
    ]);

    unmount();
  });

  it("uses the shared lifecycle commit so static clips receive position relative", async () => {
    const iframe = createPreviewIframe([
      { id: "front", track: 0, style: "position: static" },
      { id: "back", track: 1, style: "position: static" },
    ]);
    const front = timelineElement({ id: "front", track: 0, zIndex: 0 });
    const back = timelineElement({ id: "back", track: 1, zIndex: 0 });
    const commitDomEditPatchBatches = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
    const { move, unmount } = renderTimelineEditingHookWithLifecycle({
      timelineElements: [front, back],
      iframe,
      commitDomEditPatchBatches,
    });

    await act(async () => {
      await move(back, {
        start: back.start,
        track: back.track,
        stackingReorder: {
          contextKey: "root",
          placement: { type: "above", layerId: "front" },
          zIndexChanges: [{ key: "back", zIndex: 2 }],
        },
      });
      await flushAsyncWork();
    });

    expect(commitDomEditPatchBatches).toHaveBeenCalled();
    const batch = commitDomEditPatchBatches.mock.calls[0]![0] as Array<{
      patches: Array<{ operations: unknown[] }>;
    }>;
    expect(batch[0]?.patches[0]?.operations).toEqual([
      { type: "inline-style", property: "z-index", value: "2" },
      { type: "inline-style", property: "position", value: "relative" },
    ]);

    unmount();
  });

  it("rejects and rolls back DOM and store z-index changes when a reorder save fails", async () => {
    const iframe = createPreviewIframe([
      { id: "front", track: 0, style: "position: relative; z-index: 7" },
      { id: "back", track: 1, style: "position: static" },
    ]);
    const front = timelineElement({ id: "front", track: 0, zIndex: 7 });
    const back = timelineElement({ id: "back", track: 1, zIndex: 0 });
    usePlayerStore.getState().setElements([
      { ...front, hasExplicitZIndex: true },
      { ...back, hasExplicitZIndex: false },
    ]);
    const saveError = new Error("save failed");
    const commitDomEditPatchBatches = vi
      .fn<(...args: unknown[]) => Promise<void>>()
      .mockRejectedValueOnce(saveError);
    const { move, unmount } = renderTimelineEditingHookWithLifecycle({
      timelineElements: [front, back],
      iframe,
      commitDomEditPatchBatches,
    });
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("Expected iframe document");
    const frontElement = doc.getElementById("front") as HTMLElement | null;
    const backElement = doc.getElementById("back") as HTMLElement | null;
    if (!frontElement || !backElement) throw new Error("Expected reordered elements");

    let rejection: unknown;
    await act(async () => {
      try {
        await move(back, {
          start: back.start,
          track: back.track,
          stackingReorder: {
            contextKey: "root",
            placement: { type: "above", layerId: "front" },
            zIndexChanges: [
              { key: "front", zIndex: 2 },
              { key: "back", zIndex: 5 },
            ],
          },
        });
      } catch (error) {
        rejection = error;
      }
      await flushAsyncWork();
    });

    expect(rejection).toBe(saveError);
    expect(frontElement.style.zIndex).toBe("7");
    expect(frontElement.style.position).toBe("relative");
    expect(backElement.style.zIndex).toBe("");
    expect(backElement.style.position).toBe("static");
    const storeEntries = usePlayerStore.getState().elements;
    expect(storeEntries.find((entry) => entry.id === "front")).toMatchObject({
      zIndex: 7,
      hasExplicitZIndex: true,
    });
    expect(storeEntries.find((entry) => entry.id === "back")).toMatchObject({
      zIndex: 0,
      hasExplicitZIndex: false,
    });

    unmount();
  });

  it("waits for the lifecycle z-index batch before resolving a reorder", async () => {
    const iframe = createPreviewIframe([
      { id: "front", track: 0, style: "position: relative; z-index: 1" },
      { id: "back", track: 1, style: "position: relative; z-index: 0" },
    ]);
    const front = timelineElement({ id: "front", track: 0, zIndex: 1 });
    const back = timelineElement({ id: "back", track: 1, zIndex: 0 });
    let releaseBatch!: () => void;
    const batchSave = new Promise<void>((resolve) => {
      releaseBatch = resolve;
    });
    const commitDomEditPatchBatches = vi
      .fn<(...args: unknown[]) => Promise<void>>()
      .mockReturnValueOnce(batchSave);
    const { move, unmount } = renderTimelineEditingHookWithLifecycle({
      timelineElements: [front, back],
      iframe,
      commitDomEditPatchBatches,
    });
    let settled = false;

    let movePromise!: Promise<void>;
    await act(async () => {
      movePromise = move(back, {
        start: back.start,
        track: back.track,
        stackingReorder: {
          contextKey: "root",
          placement: { type: "above", layerId: "front" },
          zIndexChanges: [
            { key: "front", zIndex: 2 },
            { key: "back", zIndex: 3 },
          ],
        },
      }).then(() => {
        settled = true;
      });
      await flushAsyncWork();
    });

    expect(commitDomEditPatchBatches).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    await act(async () => {
      releaseBatch();
      await movePromise;
      await flushAsyncWork();
    });
    expect(settled).toBe(true);

    unmount();
  });

  it("keeps horizontal-only drag on the timing and GSAP shift path without z-index writes", async () => {
    const iframe = createPreviewIframe([{ id: "clip", track: 0 }]);
    const clip = timelineElement({ id: "clip", track: 0, zIndex: 0 });
    const commit = vi.fn<(entries: ZIndexEntry[]) => Promise<void>>().mockResolvedValue(undefined);
    const writeProjectFile = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
    const recordEdit = vi.fn<TimelineRecordEdit>(async (_entry) => {});
    const reloadPreview = vi.fn();
    const fetchMock = stubProjectFetch('<div id="clip" data-start="0" data-track-index="0"></div>');
    const { move, unmount } = renderTimelineEditingHook({
      timelineElements: [clip],
      iframe,
      onZIndexCommit: commit,
      projectId: "p1",
      writeProjectFile,
      recordEdit,
      reloadPreview,
    });

    await act(async () => {
      await move(clip, { start: 1.25, track: clip.track });
    });

    const doc = iframe.contentDocument;
    if (!doc) throw new Error("Expected iframe document");
    expect(doc.getElementById("clip")?.getAttribute("data-start")).toBe("1.25");
    expect(doc.getElementById("clip")?.getAttribute("data-track-index")).toBe("0");
    expect(commit).not.toHaveBeenCalled();
    expect(writeProjectFile.mock.calls[0]![1]).toContain('data-start="1.25"');
    expect(writeProjectFile.mock.calls[0]![1]).toContain('data-track-index="0"');
    expect(writeProjectFile.mock.calls[0]![1]).not.toContain("z-index");
    expect(
      fetchMock.mock.calls.some((call) => requestUrl(call[0]).includes("gsap-mutations")),
    ).toBe(true);

    unmount();
  });

  it("persists a vertical-only lane move (start unchanged) through the single-element fallback", async () => {
    // Regression: `if (!startChanged) return` ran BEFORE the file persist, so a
    // pure lane change routed through onMoveElement (no onMoveElements wired)
    // wrote NOTHING — the lane snapped back on the next reload.
    const iframe = createPreviewIframe([{ id: "clip", track: 0 }]);
    const clip = timelineElement({ id: "clip", track: 0, zIndex: 0 });
    const commit = vi.fn<(entries: ZIndexEntry[]) => Promise<void>>().mockResolvedValue(undefined);
    const writeProjectFile = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
    stubProjectFetch('<div id="clip" data-start="0" data-track-index="0"></div>');
    const { move, unmount } = renderTimelineEditingHook({
      timelineElements: [clip],
      iframe,
      onZIndexCommit: commit,
      projectId: "p1",
      writeProjectFile,
      recordEdit: vi.fn(async () => {}),
    });

    await act(async () => {
      // Vertical-only: same start, new track (already authored-space on this path).
      await move(clip, { start: clip.start, track: 2 });
    });

    const doc = iframe.contentDocument;
    if (!doc) throw new Error("Expected iframe document");
    // Live DOM patched so a pre-reload re-discovery doesn't snap the lane back...
    expect(doc.getElementById("clip")?.getAttribute("data-track-index")).toBe("2");
    // ...and the file write carries the new data-track-index with start intact.
    expect(writeProjectFile).toHaveBeenCalled();
    expect(writeProjectFile.mock.calls[0]![1]).toContain('data-track-index="2"');
    expect(writeProjectFile.mock.calls[0]![1]).toContain('data-start="0"');

    unmount();
  });

  it("orders the timing write after the z-index commit so a diagonal drag can't clobber the restack", async () => {
    const iframe = createPreviewIframe([
      { id: "clip", track: 0, style: "position: relative; z-index: 0" },
    ]);
    const clip = timelineElement({ id: "clip", track: 0, zIndex: 0 });
    // Gate the z-index commit so we can observe whether the timing write waits.
    let releaseCommit!: () => void;
    const commitGate = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    const commit = vi.fn<(entries: ZIndexEntry[]) => Promise<void>>().mockReturnValue(commitGate);
    const writeProjectFile = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
    stubProjectFetch('<div id="clip" data-start="0" data-track-index="0"></div>');
    const { move, unmount } = renderTimelineEditingHook({
      timelineElements: [clip],
      iframe,
      onZIndexCommit: commit,
      projectId: "p1",
      writeProjectFile,
      recordEdit: vi.fn(async () => {}),
    });

    // Diagonal drag: both a time move (start change) and a restack (z-index change).
    let movePromise!: Promise<unknown>;
    await act(async () => {
      movePromise = move(clip, {
        start: 1.25,
        track: clip.track,
        stackingReorder: {
          contextKey: "root",
          placement: { type: "onto", layerId: "layer-clip" },
          zIndexChanges: [{ key: "clip", zIndex: 5 }],
        },
      });
      await flushAsyncWork();
    });

    // The z-index commit is in flight but gated; the full-file timing write must
    // not have run yet, or it would overwrite the file without the z-index change.
    expect(commit).toHaveBeenCalledTimes(1);
    expect(writeProjectFile).not.toHaveBeenCalled();

    // Release the z-index commit → the timing write now proceeds, on top of it.
    await act(async () => {
      releaseCommit();
      await movePromise;
      await flushAsyncWork();
    });
    expect(writeProjectFile).toHaveBeenCalled();

    unmount();
  });

  it("persists a same-file group move with one write containing every clip timing", async () => {
    const source = [
      '<div id="a" data-start="0" data-duration="1"></div>',
      '<div id="b" data-start="1" data-duration="1"></div>',
      '<div id="c" data-start="2" data-duration="1"></div>',
    ].join("\n");
    const iframe = createPreviewIframe([
      { id: "a", track: 0 },
      { id: "b", track: 1 },
      { id: "c", track: 2 },
    ]);
    const clips = [
      timelineElement({ id: "a", track: 0, zIndex: 0, start: 0, duration: 1 }),
      timelineElement({ id: "b", track: 1, zIndex: 0, start: 1, duration: 1 }),
      timelineElement({ id: "c", track: 2, zIndex: 0, start: 2, duration: 1 }),
    ];
    const writeProjectFile = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
    const recordEdit = vi.fn<TimelineRecordEdit>(async (_entry) => {});
    stubProjectFetch(source);
    const { groupMove, unmount } = renderTimelineEditingHook({
      timelineElements: clips,
      iframe,
      onZIndexCommit: vi.fn().mockResolvedValue(undefined),
      projectId: "p1",
      writeProjectFile,
      recordEdit,
    });

    await act(async () => {
      await groupMove([
        { element: clips[0], start: 0.5 },
        { element: clips[1], start: 1.5 },
        { element: clips[2], start: 2.5 },
      ]);
    });

    expect(writeProjectFile).toHaveBeenCalledTimes(1);
    const written = writeProjectFile.mock.calls[0]![1] as string;
    expect(written).toContain('id="a" data-start="0.5"');
    expect(written).toContain('id="b" data-start="1.5"');
    expect(written).toContain('id="c" data-start="2.5"');
    expect(recordEdit).toHaveBeenCalledTimes(1);
    expect(Object.keys(recordEdit.mock.calls[0]![0].files)).toEqual(["index.html"]);

    unmount();
  });

  it("partitions a group move by source file while keeping one undo entry", async () => {
    const files: Record<string, string> = {
      "index.html": '<div id="a" data-start="0" data-duration="1"></div>',
      "scene.html": '<div id="b" data-start="1" data-duration="1"></div>',
    };
    const iframe = createPreviewIframe([
      { id: "a", track: 0 },
      { id: "b", track: 1 },
    ]);
    const a = timelineElement({ id: "a", track: 0, zIndex: 0, start: 0, duration: 1 });
    const b = timelineElement({
      id: "b",
      track: 1,
      zIndex: 0,
      start: 1,
      duration: 1,
      sourceFile: "scene.html",
    });
    const writeProjectFile = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
    const recordEdit = vi.fn<TimelineRecordEdit>(async (_entry) => {});
    stubProjectFetch(files);
    const { groupMove, unmount } = renderTimelineEditingHook({
      timelineElements: [a, b],
      iframe,
      onZIndexCommit: vi.fn().mockResolvedValue(undefined),
      projectId: "p1",
      writeProjectFile,
      recordEdit,
    });

    await act(async () => {
      await groupMove([
        { element: a, start: 0.25 },
        { element: b, start: 1.25 },
      ]);
    });

    expect(writeProjectFile.mock.calls.map((call) => call[0])).toEqual([
      "index.html",
      "scene.html",
    ]);
    expect(writeProjectFile.mock.calls[0]![1]).toContain('data-start="0.25"');
    expect(writeProjectFile.mock.calls[1]![1]).toContain('data-start="1.25"');
    expect(recordEdit).toHaveBeenCalledTimes(1);
    expect(Object.keys(recordEdit.mock.calls[0]![0].files).sort()).toEqual([
      "index.html",
      "scene.html",
    ]);

    unmount();
  });

  it("waits for a z-index commit before the group timing write", async () => {
    const source = '<div id="clip" data-start="0" data-duration="1"></div>';
    const iframe = createPreviewIframe([{ id: "clip", track: 0 }]);
    const clip = timelineElement({ id: "clip", track: 0, zIndex: 0, start: 0, duration: 1 });
    let releaseCommit!: () => void;
    const zIndexCommit = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    const writeProjectFile = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
    stubProjectFetch(source);
    const { groupMove, unmount } = renderTimelineEditingHook({
      timelineElements: [clip],
      iframe,
      onZIndexCommit: vi.fn().mockResolvedValue(undefined),
      projectId: "p1",
      writeProjectFile,
      recordEdit: vi.fn(async () => {}),
    });

    let movePromise!: Promise<unknown>;
    await act(async () => {
      movePromise = groupMove([{ element: clip, start: 0.75 }], { beforeTiming: zIndexCommit });
      await flushAsyncWork();
    });
    expect(writeProjectFile).not.toHaveBeenCalled();

    await act(async () => {
      releaseCommit();
      await movePromise;
      await flushAsyncWork();
    });
    expect(writeProjectFile).toHaveBeenCalledTimes(1);

    unmount();
  });

  it("matches the single-clip move output when a group move contains one clip", async () => {
    const source = '<div id="clip" data-start="0" data-duration="1"></div>';
    const clip = timelineElement({ id: "clip", track: 0, zIndex: 0, start: 0, duration: 1 });
    stubProjectFetch(source);

    const singleWrite = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
    const single = renderTimelineEditingHook({
      timelineElements: [clip],
      iframe: createPreviewIframe([{ id: "clip", track: 0 }]),
      onZIndexCommit: vi.fn().mockResolvedValue(undefined),
      projectId: "p1",
      writeProjectFile: singleWrite,
      recordEdit: vi.fn(async () => {}),
    });
    await act(async () => {
      await single.move(clip, { start: 0.5, track: clip.track });
    });
    single.unmount();

    const groupWrite = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
    const group = renderTimelineEditingHook({
      timelineElements: [clip],
      iframe: createPreviewIframe([{ id: "clip", track: 0 }]),
      onZIndexCommit: vi.fn().mockResolvedValue(undefined),
      projectId: "p1",
      writeProjectFile: groupWrite,
      recordEdit: vi.fn(async () => {}),
    });
    await act(async () => {
      await group.groupMove([{ element: clip, start: 0.5 }]);
    });

    expect(groupWrite.mock.calls[0]![1]).toBe(singleWrite.mock.calls[0]![1]);
    group.unmount();
  });
});

describe("useTimelineEditing duration rollback on failed persist", () => {
  const ROLLBACK_SOURCE = [
    `<div data-composition-id="main" data-duration="4">`,
    `  <div id="clip" data-start="0" data-duration="2" data-track-index="0"></div>`,
    `</div>`,
  ].join("\n");

  /** Iframe with a comp root so the optimistic sync (and its rollback) can patch data-duration. */
  function createRootedIframe(source: string = ROLLBACK_SOURCE): HTMLIFrameElement {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("Expected iframe document");
    doc.body.innerHTML = source;
    return iframe;
  }

  function rootDurationAttr(iframe: HTMLIFrameElement): string | null | undefined {
    return iframe.contentDocument
      ?.querySelector("[data-composition-id]")
      ?.getAttribute("data-duration");
  }

  function setupFailedPersist() {
    const iframe = createRootedIframe();
    const clip = timelineElement({ id: "clip", track: 0, zIndex: 0 });
    const writeError = new Error("write failed");
    const writeProjectFile = vi
      .fn<(...args: unknown[]) => Promise<void>>()
      .mockRejectedValue(writeError);
    stubProjectFetch(ROLLBACK_SOURCE);
    usePlayerStore.getState().setDuration(4);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const hook = renderTimelineEditingHook({
      timelineElements: [clip],
      iframe,
      onZIndexCommit: vi.fn().mockResolvedValue(undefined),
      projectId: "p1",
      writeProjectFile,
      recordEdit: vi.fn(async () => {}),
      reloadPreview: vi.fn(),
    });
    return { iframe, clip, hook, writeError };
  }

  it("rolls back the store duration and live root when a move persist fails", async () => {
    const { iframe, clip, hook, writeError } = setupFailedPersist();

    let rejection: unknown;
    await act(async () => {
      // Move past the end: the optimistic sync grows the readout to 5s.
      await hook.move(clip, { start: 3, track: clip.track }).catch((error) => {
        rejection = error;
      });
      await flushAsyncWork();
    });

    expect(rejection).toBe(writeError);
    expect(usePlayerStore.getState().duration).toBe(4);
    expect(rootDurationAttr(iframe)).toBe("4");

    hook.unmount();
  });

  it("rolls back the store duration and live root when a resize persist fails", async () => {
    const { iframe, clip, hook, writeError } = setupFailedPersist();

    let rejection: unknown;
    await act(async () => {
      await hook
        .resize(clip, { start: 0, duration: 6, playbackStart: undefined })
        .catch((error) => {
          rejection = error;
        });
      await flushAsyncWork();
    });

    expect(rejection).toBe(writeError);
    expect(usePlayerStore.getState().duration).toBe(4);
    expect(rootDurationAttr(iframe)).toBe("4");

    hook.unmount();
  });

  it("rolls back the store duration and live root when a group move persist fails", async () => {
    const { iframe, clip, hook, writeError } = setupFailedPersist();

    let rejection: unknown;
    await act(async () => {
      await hook.groupMove([{ element: clip, start: 3.5 }]).catch((error) => {
        rejection = error;
      });
      await flushAsyncWork();
    });

    expect(rejection).toBe(writeError);
    expect(usePlayerStore.getState().duration).toBe(4);
    expect(rootDurationAttr(iframe)).toBe("4");

    hook.unmount();
  });

  it("rolls back the store duration and live root when a group resize persist fails", async () => {
    const { iframe, clip, hook, writeError } = setupFailedPersist();

    let rejection: unknown;
    await act(async () => {
      await hook.groupResize([{ element: clip, start: 0, duration: 7 }]).catch((error) => {
        rejection = error;
      });
      await flushAsyncWork();
    });

    expect(rejection).toBe(writeError);
    expect(usePlayerStore.getState().duration).toBe(4);
    expect(rootDurationAttr(iframe)).toBe("4");

    hook.unmount();
  });

  it("rolls back the store duration and live root when a delete persist fails", async () => {
    // Two clips; deleting the furthest one shrinks the content-driven duration
    // optimistically (4s -> 2s), so a failed write must roll that shrink back.
    const DELETE_SOURCE = [
      `<div data-composition-id="main" data-duration="4">`,
      `  <div id="clip" data-start="0" data-duration="2" data-track-index="0"></div>`,
      `  <div id="tail" data-start="2" data-duration="2" data-track-index="0"></div>`,
      `</div>`,
    ].join("\n");
    const DELETE_REMOVED_SOURCE = [
      `<div data-composition-id="main" data-duration="4">`,
      `  <div id="clip" data-start="0" data-duration="2" data-track-index="0"></div>`,
      `</div>`,
    ].join("\n");

    const iframe = createRootedIframe(DELETE_SOURCE);
    const tail = timelineElement({ id: "tail", track: 0, zIndex: 0, start: 2, duration: 2 });
    const writeError = new Error("write failed");
    const writeProjectFile = vi
      .fn<(...args: unknown[]) => Promise<void>>()
      .mockRejectedValue(writeError);
    // The delete path reads the file, then asks the server-side remove-element
    // mutation for the post-removal source before persisting it.
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
      const url = requestUrl(input);
      if (url.includes("/api/projects/p1/files/")) {
        return jsonResponse({ content: DELETE_SOURCE });
      }
      if (url.includes("/api/projects/p1/file-mutations/remove-element/")) {
        return jsonResponse({ changed: true, content: DELETE_REMOVED_SOURCE });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    usePlayerStore.getState().setDuration(4);
    const showToast = vi.fn();
    const hook = renderTimelineEditingHook({
      timelineElements: [tail],
      iframe,
      onZIndexCommit: vi.fn().mockResolvedValue(undefined),
      projectId: "p1",
      writeProjectFile,
      recordEdit: vi.fn(async () => {}),
      reloadPreview: vi.fn(),
      showToast,
    });

    await act(async () => {
      // Unlike move/resize, the delete handler swallows the persist failure
      // into a toast, so the promise resolves.
      await hook.del(tail);
      await flushAsyncWork();
    });

    // The optimistic shrink reached the persist attempt (root patched to the
    // furthest remaining clip end, 2s)...
    expect(writeProjectFile).toHaveBeenCalledTimes(1);
    expect(String(writeProjectFile.mock.calls[0]![1])).toContain(
      'data-composition-id="main" data-duration="2"',
    );
    expect(showToast).toHaveBeenCalledWith("write failed");
    // ...and the failed write rolled the readout AND the live root back.
    expect(usePlayerStore.getState().duration).toBe(4);
    expect(rootDurationAttr(iframe)).toBe("4");

    hook.unmount();
  });

  it("keeps the grown duration when the persist succeeds", async () => {
    const { iframe, clip, hook } = setupFailedPersist();
    // Same harness, but with a write that succeeds this time.
    hook.unmount();
    const writeProjectFile = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
    const succeeding = renderTimelineEditingHook({
      timelineElements: [clip],
      iframe,
      onZIndexCommit: vi.fn().mockResolvedValue(undefined),
      projectId: "p1",
      writeProjectFile,
      recordEdit: vi.fn(async () => {}),
      reloadPreview: vi.fn(),
    });

    await act(async () => {
      await succeeding.move(clip, { start: 3, track: clip.track });
      await flushAsyncWork();
    });

    expect(usePlayerStore.getState().duration).toBe(5);
    expect(rootDurationAttr(iframe)).toBe("5");

    succeeding.unmount();
  });
});
