import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import type { TimelineElement } from "../player";
import type { DomEditSelection } from "../components/editor/domEditing";
import { resolveTimelineIdForSelection } from "../utils/studioHelpers";
import { logSelect } from "../utils/selectDebug";

interface UseTimelineSelectionPreviewSyncParams {
  selectedElementId: string | null;
  selectedElementIds: Set<string>;
  timelineElements: TimelineElement[];
  domEditSelection: DomEditSelection | null;
  domEditGroupSelections: DomEditSelection[];
  activeCompPath: string | null;
  buildDomSelectionForTimelineElement: (
    element: TimelineElement,
  ) => Promise<DomEditSelection | null>;
  applyDomSelection: (
    selection: DomEditSelection | null,
    options?: {
      revealPanel?: boolean;
      additive?: boolean;
      preserveGroup?: boolean;
      announce?: boolean;
    },
  ) => void;
  applyMarqueeSelection: (selections: DomEditSelection[], additive: boolean) => void;
  onSelectionNotFound: () => void;
}

// A member still resolving (a just-dropped/pasted/duplicated clip, or a preview
// still reloading) heals within a few retries. One that never will (deleted out
// of band, a stale id) would otherwise bail forever; past this cap, apply
// whatever did resolve instead of leaving the group selection stuck.
const MAX_UNRESOLVED_SYNC_RETRIES = 3;

function orderSelectedIds(ids: Set<string>, anchor: string | null): string[] {
  const ordered = [...ids];
  if (!anchor || !ids.has(anchor)) return ordered;
  return [anchor, ...ordered.filter((id) => id !== anchor)];
}

function selectionIdsMatch(
  currentIds: string[],
  selectedIds: string[],
  currentAnchor: string | null,
  wantedAnchor: string | null,
): boolean {
  // Compare as sets in BOTH directions: length equality misreads duplicates (two DOM
  // children resolving to the same clip id) as a full match and skips mirroring the
  // members that never made it into the preview.
  const current = new Set(currentIds);
  const selected = new Set(selectedIds);
  if (current.size !== selected.size) return false;
  for (const id of selected) {
    if (!current.has(id)) return false;
  }
  // The primary/anchor must also agree, or a change of just the anchor within the
  // same set would never re-sync the preview's primary selection.
  return currentAnchor === wantedAnchor;
}

/**
 * The invariant this file owes the Delete key, now that Delete prefers the
 * canvas: the canvas selection never points outside the current timeline
 * selection. A member still resolving has no anchor of its own yet, so it is
 * not caught here — only a canvas selection that belongs to something else.
 */
function anchorIsOutsideSelection(anchor: string | null, selectedIds: string[]): boolean {
  return anchor !== null && !selectedIds.includes(anchor);
}

/**
 * Records this attempt against the per-selection retry budget (a new
 * selectedKey starts a fresh count) and reports whether it's still within
 * budget to bail and retry.
 */
function recordUnresolvedSelectionAttempt(
  attemptsRef: MutableRefObject<{ key: string; count: number }>,
  selectedKey: string,
): boolean {
  const previous = attemptsRef.current;
  const count = previous.key === selectedKey ? previous.count + 1 : 1;
  attemptsRef.current = { key: selectedKey, count };
  return count <= MAX_UNRESOLVED_SYNC_RETRIES;
}

async function resolveSelectionsForIds(
  ids: string[],
  timelineElements: TimelineElement[],
  buildDomSelectionForTimelineElement: UseTimelineSelectionPreviewSyncParams["buildDomSelectionForTimelineElement"],
): Promise<DomEditSelection[]> {
  const selections: DomEditSelection[] = [];
  for (const id of ids) {
    const element = timelineElements.find((item) => (item.key ?? item.id) === id);
    if (!element) continue;
    const selection = await buildDomSelectionForTimelineElement(element);
    if (selection) selections.push(selection);
  }
  return selections;
}

function applyResolvedSelections(
  selections: DomEditSelection[],
  applyDomSelection: UseTimelineSelectionPreviewSyncParams["applyDomSelection"],
  applyMarqueeSelection: UseTimelineSelectionPreviewSyncParams["applyMarqueeSelection"],
): void {
  if (selections.length === 0) {
    applyDomSelection(null, { revealPanel: false });
  } else if (selections.length === 1) {
    applyDomSelection(selections[0]);
  } else {
    applyMarqueeSelection(selections, false);
  }
}

export function useTimelineSelectionPreviewSync({
  selectedElementId,
  selectedElementIds,
  timelineElements,
  domEditSelection,
  domEditGroupSelections,
  activeCompPath,
  buildDomSelectionForTimelineElement,
  applyDomSelection,
  applyMarqueeSelection,
  onSelectionNotFound,
}: UseTimelineSelectionPreviewSyncParams): void {
  const selectedIds = useMemo(
    () => orderSelectedIds(selectedElementIds, selectedElementId),
    [selectedElementId, selectedElementIds],
  );
  const selectedKey = selectedIds.join("\0");
  const domEditSelectionRef = useRef(domEditSelection);
  const domEditGroupSelectionsRef = useRef(domEditGroupSelections);
  const lastSyncedSelectedKeyRef = useRef("");
  const missingSelectionKeyRef = useRef("");
  const unresolvedAttemptsRef = useRef<{ key: string; count: number }>({ key: "", count: 0 });
  domEditSelectionRef.current = domEditSelection;
  domEditGroupSelectionsRef.current = domEditGroupSelections;

  useEffect(() => {
    const previousSelectedKey = lastSyncedSelectedKeyRef.current;
    lastSyncedSelectedKeyRef.current = selectedKey;
    const currentDomEditSelection = domEditSelectionRef.current;
    const currentDomEditGroupSelections = domEditGroupSelectionsRef.current;
    const currentSelections =
      currentDomEditGroupSelections.length > 1
        ? currentDomEditGroupSelections
        : currentDomEditSelection
          ? [currentDomEditSelection]
          : [];
    const currentIds = currentSelections
      .map((selection) =>
        resolveTimelineIdForSelection(selection, timelineElements, activeCompPath),
      )
      .filter((id): id is string => Boolean(id));
    const currentAnchor = currentDomEditSelection
      ? resolveTimelineIdForSelection(currentDomEditSelection, timelineElements, activeCompPath)
      : null;

    if (selectedIds.length === 0) {
      missingSelectionKeyRef.current = "";
      // A deselect is the one unambiguous "new attempt" signal: without it, reselecting the
      // same permanently-unresolvable id later picks up an already-exhausted retry budget
      // and skips straight to the degraded fallback instead of getting a fresh grace window.
      unresolvedAttemptsRef.current = { key: "", count: 0 };
      // The timeline holds nothing, so the canvas is about to hold nothing either.
      // This is the path that silently drops a selection the user can still see.
      logSelect("timeline-empty", {
        had: currentIds.length,
        previousKey: previousSelectedKey.length > 0,
        clearing: previousSelectedKey.length > 0 && currentIds.length > 0,
      });
      if (previousSelectedKey.length > 0 && currentIds.length > 0) {
        applyDomSelection(null, { revealPanel: false });
      }
      return;
    }
    if (selectionIdsMatch(currentIds, selectedIds, currentAnchor, selectedElementId)) {
      missingSelectionKeyRef.current = "";
      return;
    }

    let cancelled = false;
    // One warning per selection, however many times the effect retries it.
    const warnSelectionMissingOnce = () => {
      if (missingSelectionKeyRef.current === selectedKey) return;
      missingSelectionKeyRef.current = selectedKey;
      onSelectionNotFound();
    };
    const syncSelection = async () => {
      const selections = await resolveSelectionsForIds(
        selectedIds,
        timelineElements,
        buildDomSelectionForTimelineElement,
      );
      if (cancelled) return;
      if (selections.length < selectedIds.length) {
        if (recordUnresolvedSelectionAttempt(unresolvedAttemptsRef, selectedKey)) {
          warnSelectionMissingOnce();
          // Delete acts on the canvas first, so only an anchor OUTSIDE this selection
          // (an element the user isn't looking at) is cleared here, quietly — a member
          // still resolving has no anchor yet and is left for the later run.
          if (anchorIsOutsideSelection(currentAnchor, selectedIds)) {
            applyDomSelection(null, { revealPanel: false, announce: false });
          }
          return;
        }
      } else {
        unresolvedAttemptsRef.current = { key: "", count: 0 };
      }
      missingSelectionKeyRef.current = "";
      logSelect("timeline-sync", {
        wanted: selectedIds.length,
        had: currentIds.length,
        resolved: selections.length,
      });
      applyResolvedSelections(selections, applyDomSelection, applyMarqueeSelection);
    };

    void syncSelection();
    return () => {
      cancelled = true;
    };
    // DOM selection changes are read through refs. Depending on them directly
    // would let the preview-to-timeline echo cancel an in-flight timeline click.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeCompPath,
    applyDomSelection,
    applyMarqueeSelection,
    buildDomSelectionForTimelineElement,
    onSelectionNotFound,
    selectedElementId,
    selectedIds,
    selectedKey,
    timelineElements,
  ]);
}
