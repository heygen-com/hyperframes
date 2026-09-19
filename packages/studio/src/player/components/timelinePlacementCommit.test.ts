import { describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import type { DragCommitDeps, TimelineMoveEdit } from "./timelineClipDragCommit";
import type { DraggedClipState } from "./timelineClipDragTypes";
import type { PlacementResult } from "./timelinePlacement";
import {
  buildPlacementSteps,
  commitPlacementDrop,
  placementRefusal,
  runPlacementSteps,
  type PlacementFold,
  type PlacementOps,
  type PlacementResizeChange,
} from "./timelinePlacementCommit";
import {
  buildEditHistoryEntry,
  createEmptyEditHistory,
  hashEditHistoryContent,
  pushEditHistoryEntry,
  undoEditHistory,
  type EditHistoryState,
} from "../../utils/editHistory";

function clip(id: string, start: number, duration: number, extra: Partial<TimelineElement> = {}) {
  return { id, domId: id, tag: "video", start, duration, track: 1, ...extra } as TimelineElement;
}

const dragged = clip("d", 20, 2);
const draggedEdit = (start: number): TimelineMoveEdit => ({
  element: dragged,
  updates: { start, track: 1 },
});
const result = (r: Partial<PlacementResult>): PlacementResult => ({
  track: 1,
  start: 0,
  cuts: [],
  shifts: [],
  ...r,
});

describe("buildPlacementSteps", () => {
  const a = clip("a", 0, 4);
  const b = clip("b", 4, 4, { playbackStart: 1, playbackRate: 2 });

  it("removes a covered clip and then moves the dragged clip", () => {
    const steps = buildPlacementSteps({
      result: result({ start: 0, cuts: [{ kind: "remove", key: "a" }] }),
      mode: "overwrite",
      laneClips: [a],
      draggedEdit: draggedEdit(0),
    });
    expect(steps).toEqual([
      { kind: "remove", elements: [a] },
      { kind: "move", edits: [draggedEdit(0)] },
    ]);
  });

  it("trims a tail without touching its start", () => {
    const steps = buildPlacementSteps({
      result: result({ start: 2, cuts: [{ kind: "trim-tail", key: "a", duration: 2 }] }),
      mode: "overwrite",
      laneClips: [a],
      draggedEdit: draggedEdit(2),
    });
    expect(steps[0]).toEqual({
      kind: "resize",
      changes: [{ element: a, start: 0, duration: 2 }],
    });
  });

  it("trims a head and moves its source in-point by the cut at the clip's own rate", () => {
    const steps = buildPlacementSteps({
      result: result({
        start: 2,
        cuts: [{ kind: "trim-head", key: "b", start: 6, duration: 2, sourceShift: 2 }],
      }),
      mode: "overwrite",
      laneClips: [b],
      draggedEdit: draggedEdit(4),
    });
    // 1s in-point + 2s of timeline cut at 2x rate = 5s into the source.
    expect(steps[0]).toEqual({
      kind: "resize",
      changes: [{ element: b, start: 6, duration: 2, playbackStart: 5 }],
    });
  });

  it("leaves the playback start of a clip with no source alone", () => {
    const text = clip("t", 4, 4, { tag: "div" });
    const steps = buildPlacementSteps({
      result: result({
        cuts: [{ kind: "trim-head", key: "t", start: 6, duration: 2, sourceShift: 2 }],
      }),
      mode: "overwrite",
      laneClips: [text],
      draggedEdit: draggedEdit(4),
    });
    expect(steps[0]).toMatchObject({
      changes: [{ start: 6, duration: 2, playbackStart: undefined }],
    });
  });

  it("splits at the end of the drop range, then trims the original with its post-split length", () => {
    const steps = buildPlacementSteps({
      result: result({
        start: 1,
        cuts: [
          {
            kind: "split",
            key: "a",
            headDuration: 1,
            tail: { start: 3, duration: 1, sourceShift: 3 },
          },
        ],
      }),
      mode: "overwrite",
      laneClips: [a],
      draggedEdit: draggedEdit(1),
    });
    expect(steps).toEqual([
      { kind: "split", element: a, at: 3 },
      {
        kind: "resize",
        changes: [{ element: { ...a, duration: 3 }, start: 0, duration: 1 }],
      },
      { kind: "move", edits: [draggedEdit(1)] },
    ]);
  });

  it("insert pushes later clips before the dragged clip lands", () => {
    const steps = buildPlacementSteps({
      result: result({ start: 4, shifts: [{ key: "b", start: 6 }] }),
      mode: "insert",
      laneClips: [b],
      draggedEdit: draggedEdit(4),
    });
    expect(steps).toEqual([
      { kind: "move", edits: [{ element: b, updates: { start: 6, track: 1 } }] },
      { kind: "move", edits: [draggedEdit(4)] },
    ]);
  });

  it("insert into a straddled clip pushes it, splits at the pushed drop end, moves the head back", () => {
    const steps = buildPlacementSteps({
      result: result({
        start: 6,
        cuts: [
          {
            kind: "split",
            key: "b",
            headDuration: 2,
            tail: { start: 8, duration: 2, sourceShift: 2 },
          },
        ],
      }),
      mode: "insert",
      laneClips: [b],
      draggedEdit: draggedEdit(6),
    });
    const pushed = { ...b, start: 6 };
    expect(steps).toEqual([
      { kind: "move", edits: [{ element: b, updates: { start: 6, track: 1 } }] },
      { kind: "split", element: pushed, at: 8 },
      {
        kind: "move",
        edits: [
          { element: { ...pushed, duration: 2 }, updates: { start: 4, track: 1 } },
          draggedEdit(6),
        ],
      },
    ]);
  });
});

describe("placementRefusal", () => {
  const cutA = result({ start: 0, cuts: [{ kind: "remove", key: "a" }] });

  it("allows a clean overwrite", () => {
    expect(placementRefusal(cutA, "overwrite", [clip("a", 0, 4)])).toBeNull();
  });

  it("refuses when a clip that would be cut is locked", () => {
    expect(
      placementRefusal(cutA, "overwrite", [clip("a", 0, 4, { timelineLocked: true })]),
    ).toMatch(/locked or expanded/);
  });

  it("refuses when a clip that would be cut is an expanded child", () => {
    expect(
      placementRefusal(cutA, "overwrite", [clip("a", 0, 4, { expandedParentStart: 2 })]),
    ).toMatch(/locked or expanded/);
  });

  it("refuses when a clip that would be pushed is locked", () => {
    const push = result({ start: 0, shifts: [{ key: "a", start: 2 }] });
    expect(placementRefusal(push, "insert", [clip("a", 0, 4, { timelineLocked: true })])).toMatch(
      /locked or expanded/,
    );
  });

  it("refuses a split closer to a clip edge than the split epsilon", () => {
    const split = result({
      start: 0,
      cuts: [
        {
          kind: "split",
          key: "a",
          headDuration: 3.98,
          tail: { start: 3.99, duration: 0.01, sourceShift: 3.99 },
        },
      ],
    });
    expect(placementRefusal(split, "overwrite", [clip("a", 0, 4)])).toMatch(/split/);
  });
});

interface Doc {
  [id: string]: { start: number; duration: number; playbackStart?: number };
}

/** A tiny stand-in for the project file plus the history recorder, driven by the real reducer. */
function createFakeProject(initial: Doc) {
  let doc: Doc = structuredClone(initial);
  let history: EditHistoryState = createEmptyEditHistory();
  let clock = 0;
  const serialize = (d: Doc) =>
    JSON.stringify(Object.entries(d).sort(([x], [y]) => (x < y ? -1 : 1)));
  const record = (mutate: () => void, label: string, fold: PlacementFold) => {
    const before = serialize(doc);
    mutate();
    history = pushEditHistoryEntry(
      history,
      buildEditHistoryEntry({
        id: `e${clock}`,
        projectId: "p",
        label,
        kind: "timeline",
        coalesceKey: fold.coalesceKey,
        coalesceMs: fold.coalesceMs,
        now: (clock += 1000),
        files: { "index.html": { before, after: serialize(doc) } },
      }),
    );
  };
  const current = (element: TimelineElement) => {
    const found = doc[element.id];
    if (!found) throw new Error(`${element.id} is not in the document`);
    // The element a step hands over must describe what the document holds right now.
    expect({ start: element.start, duration: element.duration }).toEqual({
      start: found.start,
      duration: found.duration,
    });
    return found;
  };
  const ops: PlacementOps = {
    split: async (element, at, fold) => {
      record(
        () => {
          const target = current(element);
          const end = target.start + target.duration;
          doc[`${element.id}-split`] = {
            start: at,
            duration: end - at,
            playbackStart: (target.playbackStart ?? 0) + (at - target.start),
          };
          target.duration = at - target.start;
        },
        "split",
        fold,
      );
      return true;
    },
    remove: async (elements, fold) => {
      record(
        () => {
          for (const element of elements) {
            current(element);
            delete doc[element.id];
          }
        },
        "delete",
        fold,
      );
      return true;
    },
    toast: vi.fn(),
  };
  const resize = async (changes: PlacementResizeChange[], fold: PlacementFold) => {
    record(
      () => {
        for (const change of changes) {
          const target = current(change.element);
          target.start = change.start;
          target.duration = change.duration;
          if (change.playbackStart != null) target.playbackStart = change.playbackStart;
        }
      },
      "resize",
      fold,
    );
  };
  const move = async (edits: TimelineMoveEdit[], fold: PlacementFold) => {
    record(
      () => {
        for (const edit of edits) {
          const found = doc[edit.element.id];
          if (found) found.start = edit.updates.start;
          else
            doc[edit.element.id] = { start: edit.updates.start, duration: edit.element.duration };
        }
      },
      "move",
      fold,
    );
    return true;
  };
  return {
    ops,
    resize,
    move,
    doc: () => doc,
    history: () => history,
    undo: () => {
      const undone = undoEditHistory(
        history,
        { "index.html": hashEditHistoryContent(serialize(doc)) },
        0,
      );
      if (!undone.ok) throw new Error(`undo refused: ${undone.reason}`);
      return undone.filesToWrite["index.html"];
    },
    serializeInitial: () => serialize(initial),
  };
}

function dragOf(element: TimelineElement, previewStart: number, previewTrack = 1) {
  return {
    element,
    previewStart,
    previewTrack,
    insertRow: null,
  } as unknown as DraggedClipState;
}

function depsOf(elements: TimelineElement[], project: ReturnType<typeof createFakeProject>) {
  return {
    elements,
    trackOrder: [1],
    updateElement: vi.fn(),
    placementOps: project.ops,
    onResizeElements: project.resize,
  } as unknown as DragCommitDeps;
}

describe("commitPlacementDrop: one undo step for the move and every cut", () => {
  // Lane 1: a [0,4) and b [4,8) video (b reads its source from 1s at rate 1), dragged d [20,22).
  const a = clip("a", 0, 4);
  const b = clip("b", 4, 4, { playbackStart: 1 });
  const d = clip("d", 20, 2);
  const start: Doc = {
    a: { start: 0, duration: 4 },
    b: { start: 4, duration: 4, playbackStart: 1 },
    d: { start: 20, duration: 2 },
  };

  async function drop(at: number, mode: "overwrite" | "insert" = "overwrite", lane = [a, b]) {
    const project = createFakeProject(start);
    const placed = commitPlacementDrop(
      dragOf(d, at),
      depsOf([...lane, d], project),
      mode,
      project.move,
    );
    expect(placed).not.toBeNull();
    await placed;
    return project;
  }

  it("trimmed head: the clip underneath starts later and reads its source later", async () => {
    const project = await drop(4);
    // d [4,6) leaves a alone and trims b to [6,8), reading the source from 3s.
    expect(project.doc()).toEqual({
      a: { start: 0, duration: 4 },
      b: { start: 6, duration: 2, playbackStart: 3 },
      d: { start: 4, duration: 2 },
    });
    expect(project.history().undo).toHaveLength(1);
    expect(project.undo()).toBe(project.serializeInitial());
  });

  it("removed: a clip the drop fully covers is deleted and the drop lands", async () => {
    const project = createFakeProject({ ...start, d: { start: 20, duration: 6 } });
    const long = clip("d", 20, 6);
    await commitPlacementDrop(
      dragOf(long, 4),
      depsOf([a, b, long], project),
      "overwrite",
      project.move,
    );
    expect(project.doc()).toEqual({
      a: { start: 0, duration: 4 },
      d: { start: 4, duration: 6 },
    });
    expect(project.history().undo).toHaveLength(1);
    expect(project.undo()).toBe(project.serializeInitial());
  });

  it("trimmed tail: the drop over a tail shortens the clip underneath", async () => {
    const project = await drop(2);
    // d [2,4): a loses [2,4) so it ends at 2.
    expect(project.doc().a).toEqual({ start: 0, duration: 2 });
    expect(project.doc().d).toEqual({ start: 2, duration: 2 });
    expect(project.history().undo).toHaveLength(1);
    expect(project.undo()).toBe(project.serializeInitial());
  });

  it("split: a drop inside a clip leaves a head and a tail, one undo removes the tail too", async () => {
    const project = await drop(1, "overwrite", [a]);
    // d [1,3) inside a [0,4): head [0,1), tail [3,4) reading the source from 3s.
    expect(project.doc()).toEqual({
      b: { start: 4, duration: 4, playbackStart: 1 },
      a: { start: 0, duration: 1 },
      "a-split": { start: 3, duration: 1, playbackStart: 3 },
      d: { start: 1, duration: 2 },
    });
    expect(project.history().undo).toHaveLength(1);
    expect(project.undo()).toBe(project.serializeInitial());
  });

  it("insert: what follows is pushed right and the straddled clip is split around the drop", async () => {
    const project = await drop(6, "insert", [b]);
    // d [6,8) into b [4,8): head [4,6), tail [8,10) reading the source from 3s.
    expect(project.doc()).toEqual({
      a: { start: 0, duration: 4 },
      b: { start: 4, duration: 2, playbackStart: 1 },
      "b-split": { start: 8, duration: 2, playbackStart: 3 },
      d: { start: 6, duration: 2 },
    });
    expect(project.history().undo).toHaveLength(1);
    expect(project.undo()).toBe(project.serializeInitial());
  });

  it("refuses the whole drop when a clip it would cut is locked, writing nothing", async () => {
    const project = createFakeProject(start);
    const locked = clip("b", 4, 4, { timelineLocked: true });
    await commitPlacementDrop(
      dragOf(d, 4),
      depsOf([a, locked, d], project),
      "overwrite",
      project.move,
    );
    expect(project.history().undo).toHaveLength(0);
    expect(project.doc()).toEqual(start);
    expect(project.ops.toast).toHaveBeenCalledWith(expect.stringMatching(/locked or expanded/));
  });

  it("leaves a drop that touches nothing to the plain move paths", () => {
    const project = createFakeProject(start);
    expect(
      commitPlacementDrop(dragOf(d, 10), depsOf([a, b, d], project), "overwrite", project.move),
    ).toBeNull();
  });

  it("leaves a drop that did not move to the plain move paths", () => {
    const project = createFakeProject(start);
    expect(
      commitPlacementDrop(dragOf(d, 20), depsOf([a, b, d], project), "overwrite", project.move),
    ).toBeNull();
  });
});

describe("runPlacementSteps failures", () => {
  const steps = [
    { kind: "split", element: clip("a", 0, 4), at: 2 },
    { kind: "move", edits: [] },
  ] as const;

  it("names a partial apply and stops when a later step fails", async () => {
    const toast = vi.fn();
    await runPlacementSteps(steps, {
      ops: { split: async () => true, remove: async () => true, toast },
      resize: vi.fn(),
      move: async () => false,
    });
    expect(toast).toHaveBeenCalledWith("Overwrite partly applied, Undo restores it");
  });

  it("says nothing extra when the first step fails, since nothing was applied", async () => {
    const toast = vi.fn();
    const move = vi.fn(async () => true);
    await runPlacementSteps(steps, {
      ops: { split: async () => false, remove: async () => true, toast },
      resize: vi.fn(),
      move,
    });
    expect(toast).not.toHaveBeenCalled();
    expect(move).not.toHaveBeenCalled();
  });

  it("treats a rejected step as a failure", async () => {
    const toast = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await runPlacementSteps(steps, {
      ops: { split: async () => true, remove: async () => true, toast },
      resize: vi.fn(),
      move: async () => {
        throw new Error("write failed");
      },
    });
    expect(toast).toHaveBeenCalledWith("Overwrite partly applied, Undo restores it");
  });
});
