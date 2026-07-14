import { useState } from "react";
import { CaptionOverlay } from "../../captions/components/CaptionOverlay";
import { DomEditOverlay } from "../editor/DomEditOverlay";
import { MotionPathOverlay } from "../editor/MotionPathOverlay";
import { SnapToolbar } from "../editor/SnapToolbar";
import { useCompositionDimensions } from "../../hooks/useCompositionDimensions";
import {
  STUDIO_INSPECTOR_PANELS_ENABLED,
  STUDIO_KEYFRAMES_ENABLED,
  STUDIO_PREVIEW_MANUAL_EDITING_ENABLED,
  STUDIO_PREVIEW_SELECTION_ENABLED,
} from "../editor/manualEditingAvailability";
import { useStudioPlaybackContext, useStudioShellContext } from "../../contexts/StudioContext";
import {
  useDomEditActionsContext,
  useDomEditSelectionContext,
} from "../../contexts/DomEditContext";
import { readStudioUiPreferences } from "../../utils/studioUiPreferences";
import { readHfId, type DomEditSelection } from "../editor/domEditing";
import { buildStableSelector } from "../editor/domEditingDom";
import { deriveTimelineStoreKey } from "../../player/lib/timelineElementHelpers";
import { zReorderCoalesceKey } from "../../hooks/useElementLifecycleOps";
import { useCanvasZOrderTimelineMirror } from "./useCanvasZOrderTimelineMirror";
import { runZLaneGesture } from "./zLaneGesture";
import type { BlockPreviewInfo } from "../sidebar/BlocksTab";
import type { GestureRecordingState } from "../editor/GestureRecordControl";
import type { ReactNode } from "react";

export interface PreviewOverlaysProps {
  shouldShowSelectedDomBounds: boolean;
  blockPreview?: BlockPreviewInfo | null;
  isGestureRecording?: boolean;
  recordingState?: GestureRecordingState;
  onToggleRecording?: () => void;
  gestureOverlay?: ReactNode;
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

/**
 * Sibling elements are raw iframe DOM nodes with no selection object: derive a
 * PatchTarget from the node itself (siblings live in the same document, so they
 * share the selection's sourceFile). Null when it cannot be robustly targeted
 * (no id and no selector) — its z stays live-only.
 */
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
// the revert-on-reload warning (and a live-only style write, so the resolved
// stacking order still renders coherently). Exported so tests can drive the
// menu → commit path through the same wiring the app uses.
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

// fallow-ignore-next-line complexity
export function PreviewOverlays({
  shouldShowSelectedDomBounds,
  blockPreview,
  isGestureRecording,
  recordingState,
  onToggleRecording,
  gestureOverlay,
}: PreviewOverlaysProps) {
  const { activeCompPath, previewIframeRef } = useStudioShellContext();
  const { captionEditMode, compositionLoading, isPlaying } = useStudioPlaybackContext();
  const compositionDimensions = useCompositionDimensions();

  const { domEditHoverSelection, domEditSelection, domEditGroupSelections } =
    useDomEditSelectionContext();
  const {
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

  // fallow-ignore-next-line complexity
  const [snapPrefs, setSnapPrefs] = useState(() => {
    const p = readStudioUiPreferences();
    return {
      snapEnabled: p.snapEnabled ?? true,
      gridVisible: p.gridVisible ?? false,
      gridSpacing: p.gridSpacing ?? 50,
      snapToGrid: p.snapToGrid ?? false,
    };
  });

  if (blockPreview) {
    return (
      <div className="absolute inset-0 z-30 bg-black pointer-events-none">
        {blockPreview.videoUrl ? (
          <video
            src={blockPreview.videoUrl}
            autoPlay
            muted
            loop
            playsInline
            className="w-full h-full object-contain"
          />
        ) : blockPreview.posterUrl ? (
          <img
            src={blockPreview.posterUrl}
            alt={blockPreview.title}
            className="w-full h-full object-contain"
          />
        ) : null}
      </div>
    );
  }

  if (captionEditMode) {
    return <CaptionOverlay iframeRef={previewIframeRef} />;
  }

  if (!STUDIO_INSPECTOR_PANELS_ENABLED) return null;

  return (
    <>
      <DomEditOverlay
        iframeRef={previewIframeRef}
        activeCompositionPath={activeCompPath}
        hoverSelection={
          STUDIO_PREVIEW_SELECTION_ENABLED && !captionEditMode && !compositionLoading && !isPlaying
            ? domEditHoverSelection
            : null
        }
        selection={shouldShowSelectedDomBounds ? domEditSelection : null}
        groupSelections={shouldShowSelectedDomBounds ? domEditGroupSelections : []}
        allowCanvasMovement={STUDIO_PREVIEW_MANUAL_EDITING_ENABLED && !isGestureRecording}
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
          // Shared undo coalesce key: passed to BOTH the z persist and the
          // timeline lane mirror below so editHistory folds the two records
          // into one undo entry (same value handleDomZIndexReorderCommit would
          // default to — passed explicitly so the mirror shares it by
          // construction, not by formula duplication).
          const coalesceKey = zReorderCoalesceKey(entries, action);
          // One serialized z→lane transaction: the mirror runs only AFTER the
          // z commit resolved AND reported durable targets, and a second rapid
          // gesture cannot interleave between the two phases — see
          // runZLaneGesture. A failed z commit already toasted + rolled back.
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
        gridVisible={snapPrefs.gridVisible}
        gridSpacing={snapPrefs.gridSpacing}
        recordingState={recordingState}
        onToggleRecording={onToggleRecording}
        onMarqueeSelect={applyMarqueeSelection}
      />
      <SnapToolbar onSnapChange={setSnapPrefs} />
      {STUDIO_KEYFRAMES_ENABLED && (
        <MotionPathOverlay
          iframeRef={previewIframeRef}
          selection={shouldShowSelectedDomBounds ? domEditSelection : null}
          compositionSize={compositionDimensions}
          isPlaying={isPlaying}
        />
      )}
      {gestureOverlay}
    </>
  );
}
