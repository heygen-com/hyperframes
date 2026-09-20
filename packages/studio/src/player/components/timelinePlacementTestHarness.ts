import { expect, vi } from "vitest";
import type { TimelineGroupResizeChange } from "../../hooks/useTimelineGroupEditing";
import type { TimelineElement } from "../store/playerStore";
import type { DragCommitDeps, TimelineMoveEdit } from "./timelineClipDragCommit";
import type { DraggedClipState } from "./timelineClipDragTypes";
import type { PlacementFold, PlacementOps } from "./timelinePlacementCommit";
import {
  buildEditHistoryEntry,
  createEmptyEditHistory,
  hashEditHistoryContent,
  pushEditHistoryEntry,
  undoEditHistory,
  type EditHistoryState,
} from "../../utils/editHistory";

export function clip(
  id: string,
  start: number,
  duration: number,
  extra: Partial<TimelineElement> = {},
) {
  return { id, domId: id, tag: "video", start, duration, track: 1, ...extra } as TimelineElement;
}

export interface Doc {
  [id: string]: { start: number; duration: number; playbackStart?: number };
}

/** A tiny stand-in for the project file plus the history recorder, driven by the real reducer. */
export function createFakeProject(initial: Doc) {
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
    reloadPreview: vi.fn(),
  };
  const resize = async (changes: TimelineGroupResizeChange[], fold: PlacementFold) => {
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

export function dragOf(element: TimelineElement, previewStart: number, previewTrack = 1) {
  return {
    element,
    previewStart,
    previewTrack,
    insertRow: null,
  } as unknown as DraggedClipState;
}

export function depsOf(elements: TimelineElement[], project: ReturnType<typeof createFakeProject>) {
  return {
    elements,
    trackOrder: [1],
    updateElement: vi.fn(),
    placementOps: project.ops,
    onResizeElements: project.resize,
  } as unknown as DragCommitDeps;
}
