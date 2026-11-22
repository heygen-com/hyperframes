// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore, type TimelineElement } from "../player";
import { sdkTimingPersist, type CutoverResult } from "../utils/sdkCutover";
import { persistTimelineEdit } from "./timelineEditingHelpers";
import { enqueueTimelineEdit, type TimelineEditQueue } from "./timelineEditQueue";
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
}));

installReactActEnvironment();

const sdkWrites = vi.mocked(sdkTimingPersist);
const fileWrites = vi.mocked(persistTimelineEdit);

function mountClipTiming() {
  usePlayerStore.getState().setDuration(10);
  const queue: TimelineEditQueue = { current: Promise.resolve() };
  let hook: ReturnType<typeof useTimelineClipTimingEditing> | null = null;
  function Harness() {
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
      projectIdRef: { current: "project" },
    });
    return null;
  }
  const root = mountReactHarness(<Harness />);
  return { queue, getHook: () => hook!, unmount: () => act(() => root.unmount()) };
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
])("a single-clip trim saved through %s", (_path, sdkResult) => {
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
    const move = enqueueTimelineEdit(queue, () => moveSave);
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
});
