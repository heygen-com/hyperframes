import type { ComponentProps } from "react";
import { DomEditOverlay } from "./DomEditOverlay";
import {
  useDomEditActionsContext,
  useDomEditSelectionContext,
} from "../../contexts/DomEditContext";
import { readHfId, type DomEditSelection } from "./domEditing";
import { buildStableSelector } from "./domEditingDom";
import { deriveTimelineStoreKey } from "../../player/lib/timelineElementHelpers";
import { zReorderCoalesceKey } from "../../hooks/useElementLifecycleOps";
import { useCanvasZOrderTimelineMirror } from "../nle/useCanvasZOrderTimelineMirror";
import { runZLaneGesture } from "../nle/zLaneGesture";

type HostInputProps = Pick<
  ComponentProps<typeof DomEditOverlay>,
  "canvasInput" | "onSelectionBoxClick"
>;

export interface ConnectedDomEditOverlayProps extends HostInputProps {
  activeCompositionPath: string | null;
  showHoverSelection: boolean;
  shouldShowSelectedDomBounds: boolean;
  isGestureRecording?: boolean;
  /** True when an in-place text edit opens its caret, false when it ends or unmounts. */
  onTextEditingChange?: (editing: boolean) => void;
}

type ZIndexReorderEntry = {
  element: HTMLElement;
  zIndex: number;
  id?: string;
  selector?: string;
  selectorIndex?: number;
  sourceFile: string;
  /** Timeline store key — lets the commit update the store zIndex synchronously. */
  key?: string;
};

/** Can this element be robustly re-targeted for a persisted z change? */
function canTargetZIndexElement(
  element: HTMLElement,
  id: string | undefined,
  selector: string | undefined,
): boolean {
  return Boolean(id || selector || readHfId(element));
}

/** The selected element carries its full selection identity. */
function selectedZIndexEntry(sel: DomEditSelection, zIndex: number): ZIndexReorderEntry {
  return {
    element: sel.element,
    zIndex,
    id: sel.id ?? undefined,
    selector: sel.selector,
    selectorIndex: sel.selectorIndex,
    sourceFile: sel.sourceFile,
    key: deriveTimelineStoreKey({
      domId: sel.id ?? undefined,
      selector: sel.selector,
      selectorIndex: sel.selectorIndex,
      sourceFile: sel.sourceFile,
    }),
  };
}

/** A raw iframe sibling in the selection's file; null with no id or selector (z stays live). */
function siblingZIndexEntry(
  element: HTMLElement,
  zIndex: number,
  sourceFile: string,
): ZIndexReorderEntry | null {
  const id = element.id || undefined;
  const selector = buildStableSelector(element);
  if (!canTargetZIndexElement(element, id, selector)) return null;
  return {
    element,
    zIndex,
    id,
    selector,
    selectorIndex: undefined,
    sourceFile,
    key: deriveTimelineStoreKey({ domId: id, selector, sourceFile }),
  };
}

/** Short human-readable label for a dropped sibling, for the console warning below. */
function describeZIndexElement(element: HTMLElement): string {
  if (element.id) return `#${element.id}`;
  const firstClass = element.classList.item(0);
  return firstClass
    ? `${element.tagName.toLowerCase()}.${firstClass}`
    : element.tagName.toLowerCase();
}

// Resolve z-index patches into commit entries; a sibling with no stable
// id/selector can't be written to source, so it is returned as `dropped` for
// the revert-on-reload warning. Exported so tests can drive the menu → commit path.
export function resolveZIndexEntries(
  sel: DomEditSelection,
  patches: ReadonlyArray<{ element: HTMLElement; zIndex: number }>,
): { entries: ZIndexReorderEntry[]; dropped: Array<{ element: HTMLElement; zIndex: number }> } {
  const entries: ZIndexReorderEntry[] = [];
  const dropped: Array<{ element: HTMLElement; zIndex: number }> = [];
  for (const patch of patches) {
    if (patch.element === sel.element) {
      entries.push(selectedZIndexEntry(sel, patch.zIndex));
      continue;
    }
    const entry = siblingZIndexEntry(patch.element, patch.zIndex, sel.sourceFile);
    if (entry) entries.push(entry);
    else dropped.push(patch);
  }
  return { entries, dropped };
}

// Studio's DomEditOverlay wired to the session in DomEditProvider, so a host
// outside EditorShell mounts the same canvas editing without its own callbacks.
export function ConnectedDomEditOverlay({
  activeCompositionPath,
  showHoverSelection,
  shouldShowSelectedDomBounds,
  isGestureRecording,
  canvasInput,
  onTextEditingChange,
  onSelectionBoxClick,
}: ConnectedDomEditOverlayProps) {
  const { domEditHoverSelection, domEditSelection, domEditGroupSelections } =
    useDomEditSelectionContext();
  const {
    previewIframeRef,
    handlePreviewCanvasMouseDown,
    handlePreviewCanvasPointerMove,
    handlePreviewCanvasPointerLeave,
    applyDomSelection,
    handleBlockedDomMove,
    handleDomManualDragStart,
    handleDomPathOffsetCommit,
    handleDomGroupPathOffsetCommit,
    handleDomBoxSizeCommit,
    handleDomRotationCommit,
    handleDomStyleCommit,
    applyMarqueeSelection,
    handleDomEditElementDelete,
    handleDomZIndexReorderCommit,
  } = useDomEditActionsContext();
  const mirrorZOrderToTimeline = useCanvasZOrderTimelineMirror();

  return (
    <DomEditOverlay
      iframeRef={previewIframeRef}
      activeCompositionPath={activeCompositionPath}
      hoverSelection={showHoverSelection ? domEditHoverSelection : null}
      selection={shouldShowSelectedDomBounds ? domEditSelection : null}
      groupSelections={shouldShowSelectedDomBounds ? domEditGroupSelections : []}
      allowCanvasMovement={!isGestureRecording}
      canvasInput={canvasInput}
      onTextEditingChange={onTextEditingChange}
      onSelectionBoxClick={onSelectionBoxClick}
      onCanvasMouseDown={handlePreviewCanvasMouseDown}
      onCanvasPointerMove={handlePreviewCanvasPointerMove}
      onCanvasPointerLeave={handlePreviewCanvasPointerLeave}
      onSelectionChange={applyDomSelection}
      onBlockedMove={handleBlockedDomMove}
      onManualDragStart={handleDomManualDragStart}
      onPathOffsetCommit={handleDomPathOffsetCommit}
      onGroupPathOffsetCommit={handleDomGroupPathOffsetCommit}
      onBoxSizeCommit={handleDomBoxSizeCommit}
      onRotationCommit={handleDomRotationCommit}
      onStyleCommit={handleDomStyleCommit}
      onDeleteSelection={handleDomEditElementDelete}
      onApplyZIndex={(sel, patches, action, crossed) => {
        const { entries, dropped } = resolveZIndexEntries(sel, patches);
        if (dropped.length > 0) {
          // These siblings can't be written to source. Apply their live z
          // anyway so the resolved stacking order renders coherently — it
          // just reverts to the prior order on the next reload.
          for (const patch of dropped) patch.element.style.zIndex = String(patch.zIndex);
          console.warn(
            "[studio] z-index reorder: dropping sibling(s) with no stable id/selector " +
              "(will revert on reload):",
            dropped.map((patch) => describeZIndexElement(patch.element)).join(", "),
          );
        }
        if (entries.length === 0) return;
        // One coalesce key for the z persist AND the lane mirror folds both into one undo entry;
        // passed explicitly so the mirror shares it by construction, not by formula duplication.
        const coalesceKey = zReorderCoalesceKey(entries, action);
        // One serialized z→lane transaction: the mirror runs only AFTER a durable z commit and
        // no second gesture interleaves (see runZLaneGesture). A failed z commit has already
        // toasted and rolled back, so the catch only keeps its rejection from going unhandled.
        runZLaneGesture({
          commitZ: () => handleDomZIndexReorderCommit(entries, coalesceKey, action),
          mirror: () =>
            mirrorZOrderToTimeline({
              selectionKey: entries.find((e) => e.element === sel.element)?.key,
              action,
              crossed,
              sourceFile: sel.sourceFile,
              coalesceKey,
            }),
        }).catch(() => undefined);
      }}
      onMarqueeSelect={applyMarqueeSelection}
    />
  );
}
