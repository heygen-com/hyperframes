// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore, type TimelineElement } from "../player";
import { sdkTimingPersist, type CutoverResult } from "../utils/sdkCutover";
import { persistTimelineEdit } from "./timelineEditingHelpers";
import { finishClipTimingFallback } from "./timelineTimingSync";
import {
  enqueueTimelineEdit,
  useTimelineEditQueue,
  type TimelineEditQueue,
} from "./timelineEditQueue";
import { LANE_OVERLAP_NOTICE } from "../player/components/timelineCollision";
import { useTimelineClipTimingEditing } from "./useTimelineClipTimingEditing";
import { installReactActEnvironment, mountReactHarness } from "./domSelectionTestHarness";

vi.mock("../utils/sdkCutover", async (original) => ({
  ...(await original<typeof import("../utils/sdkCutover")>()),
  sdkTimingPersist: vi.fn(),
}));
vi.mock("./timelineEditingHelpers", async (original) => ({
  ...(await original<typeof import("./timelineEditingHelpers")>()),
  persistTimelineEdit: vi.fn(async () => undefined),
}));
vi.mock("./timelineTimingSync", async (original) => ({
  ...(await original<typeof import("./timelineTimingSync")>()),
  finishClipTimingFallback: vi.fn(async () => undefined),
  readFileContent: vi.fn(async (projectId: string, path: string) => `${projectId}:${path}`),
}));

installReactActEnvironment();

const sdkWrites = vi.mocked(sdkTimingPersist);
const fileWrites = vi.mocked(persistTimelineEdit);
const gsapSyncs = vi.mocked(finishClipTimingFallback);

function mountClipTiming() {
  usePlayerStore.getState().setDuration(10);
  const queue: TimelineEditQueue = { current: Promise.resolve(), projectId: "project" };
  const showToast = vi.fn();
  let hook: ReturnType<typeof useTimelineClipTimingEditing> | null = null;
  function Harness() {
    hook = useTimelineClipTimingEditing({
      activeCompPath: "index.html",
      timelineElements: [],
      showToast,
      writeProjectFile: vi.fn(),
      recordEdit: vi.fn(),
      reloadPreview: vi.fn(),
      previewIframeRef: { current: null },
      pendingTimelineEditPathRef: { current: new Set() },
      sdkSession: {} as never,
      editQueueRef: queue,
    });
    return null;
  }
  const root = mountReactHarness(<Harness />);
  return { queue, showToast, getHook: () => hook!, unmount: () => act(() => root.unmount()) };
}

const clipB: TimelineElement = {
  id: "b",
  hfId: "hf-b",
  tag: "div",
  start: 2,
  duration: 2,
  track: 0,
};

describe.each<[string, CutoverResult]>([
  ["the SDK path", { status: "committed", version: "1", before: "<p></p>", after: "<p></p>" }],
  ["the file-write fallback", { status: "declined", reason: "feature_disabled" }],
])("a single-clip edit saved through %s", (_path, sdkResult) => {
  afterEach(() => vi.clearAllMocks());

  it("saves when nothing queued before it was refused", async () => {
    sdkWrites.mockResolvedValue(sdkResult);
    const { getHook, unmount } = mountClipTiming();
    await act(() => getHook().handleTimelineElementResize(clipB, { start: 2, duration: 3 }));
    expect(sdkWrites).toHaveBeenCalledOnce();
    expect(fileWrites).toHaveBeenCalledTimes(sdkResult.status === "committed" ? 0 : 1);
    unmount();
  });

  // fails without the fix: the SDK trim wrote B at its provisional 2 s start after the move to 2 s was refused.
  it("is refused before it writes when a move queued before it is refused", async () => {
    sdkWrites.mockResolvedValue(sdkResult);
    const { queue, getHook, unmount } = mountClipTiming();
    let refuseMove: (error: Error) => void = () => {};
    const moveSave = new Promise<void>((_, fail) => (refuseMove = fail));
    const move = enqueueTimelineEdit(queue, () => moveSave, { projectId: "project" });
    await act(async () => {
      const trim = getHook().handleTimelineElementResize(clipB, { start: 2, duration: 3 });
      refuseMove(new Error("move refused"));
      await expect(move).rejects.toThrow("move refused");
      await expect(trim).rejects.toThrow("move refused");
    });
    expect(sdkWrites).not.toHaveBeenCalled();
    expect(fileWrites).not.toHaveBeenCalled();
    unmount();
  });

  // Moves B to `to` while a move queued before it is held, then refuses that move with A back at 0-2.
  async function dragBehindRefusedMove(to: number) {
    usePlayerStore.getState().setElements([{ ...clipB, id: "a", hfId: "hf-a", start: 0 }, clipB]);
    sdkWrites.mockResolvedValue(sdkResult);
    const h = mountClipTiming();
    let refuseMove: (error: Error) => void = () => {};
    const moveSave = new Promise<void>((_, fail) => (refuseMove = fail));
    const move = enqueueTimelineEdit(h.queue, () => moveSave, { projectId: "project" });
    const onlyTheMove = h.queue.current;
    let drag: Promise<void> = Promise.resolve();
    await act(async () => {
      drag = h.getHook().handleTimelineElementMove(clipB, { start: to, track: 0 }) ?? drag;
      await vi.waitFor(() => expect(h.queue.current).not.toBe(onlyTheMove));
      refuseMove(new Error("move refused"));
      await expect(move).rejects.toThrow("move refused");
      await drag.catch(() => undefined);
    });
    h.unmount();
    usePlayerStore.getState().setElements([]);
    return { drag, showToast: h.showToast };
  }

  // fails without the fix: a single-clip drag saved B at 1 s over the restored A.
  it("refuses a single-clip drag that would land on a restored clip, with the refused-drop notice", async () => {
    const { drag, showToast } = await dragBehindRefusedMove(1);
    await expect(drag).rejects.toThrow(LANE_OVERLAP_NOTICE);
    expect(sdkWrites).not.toHaveBeenCalled();
    expect(fileWrites).not.toHaveBeenCalled();
    expect(showToast.mock.calls).toEqual([[LANE_OVERLAP_NOTICE, "info"]]);
  });

  it("keeps a single-clip drag that stays clear of a restored clip", async () => {
    const { drag } = await dragBehindRefusedMove(6);
    await expect(drag).resolves.toBeUndefined();
    expect(sdkWrites).toHaveBeenCalledOnce();
  });
});

describe("a single-clip trim queued before a project switch", () => {
  afterEach(() => vi.clearAllMocks());

  // fails without the fix: the queued SDK trim read index.html from the newly opened project.
  it("reads and writes only the project it was queued in", async () => {
    usePlayerStore.getState().setDuration(10);
    sdkWrites.mockResolvedValue({ status: "committed", version: "1", before: "", after: "" });
    let hook: ReturnType<typeof useTimelineClipTimingEditing> | null = null;
    let queue: TimelineEditQueue | null = null;
    function Harness({ projectId }: { projectId: string }) {
      queue = useTimelineEditQueue(projectId);
      hook = useTimelineClipTimingEditing({
        activeCompPath: "index.html",
        timelineElements: [],
        showToast: vi.fn(),
        writeProjectFile: vi.fn(),
        recordEdit: vi.fn(),
        reloadPreview: vi.fn(),
        previewIframeRef: { current: null },
        pendingTimelineEditPathRef: { current: new Set() },
        sdkSession: {} as never,
        editQueueRef: queue,
      });
      return null;
    }
    const root = mountReactHarness(<Harness projectId="old" />);
    let release: () => void = () => {};
    const held = new Promise<void>((done) => (release = done));
    void enqueueTimelineEdit(queue!, () => held);
    const trim = hook!.handleTimelineElementResize(clipB, { start: 2, duration: 3 });

    act(() => root.render(<Harness projectId="new" />));
    release();
    await act(() => trim);

    const sdkDeps = sdkWrites.mock.calls[0]?.[4];
    await expect(sdkDeps?.readProjectFile?.("index.html")).resolves.toBe("old:index.html");
    expect(gsapSyncs.mock.calls.map(([sync]) => sync.projectId)).toEqual(["old"]);
    act(() => root.unmount());
  });
});
