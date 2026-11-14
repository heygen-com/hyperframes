// fallow-ignore-file code-duplication
import { snapCandidates } from "@hyperframes/core/runtime/editing-port";
import type { DomEditSelection } from "./domEditing";
import { toVisibleOverlayRect, type OverlayRect } from "./domEditOverlayGeometry";
import {
  extractSnapTargets,
  buildCompositionSnapTarget,
  buildGridSnapEdges,
  type SnapTarget,
  type SnapEdge,
} from "./snapEngine";
import { readStudioUiPreferences } from "../../utils/studioUiPreferences";

export interface SnapContext {
  targets: SnapTarget[];
  compositionTarget: SnapTarget | null;
  gridEdges: { x: SnapEdge[]; y: SnapEdge[] } | null;
  snapEnabled: boolean;
}

function readPositiveDimension(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function snapContextFromRects(
  composition: OverlayRect,
  rects: ReadonlyArray<OverlayRect | null>,
): SnapContext {
  const prefs = readStudioUiPreferences();
  const entries = rects.flatMap((rect, i) => (rect ? [{ rect, id: `snap-target-${i}` }] : []));
  const gridSpacing = prefs.gridSpacing ?? 50;
  const snapToGrid = prefs.snapToGrid ?? false;
  return {
    targets: extractSnapTargets(entries),
    compositionTarget: buildCompositionSnapTarget(composition),
    gridEdges:
      snapToGrid && gridSpacing > 0
        ? buildGridSnapEdges(composition, gridSpacing, composition.editScaleX)
        : null,
    snapEnabled: prefs.snapEnabled ?? true,
  };
}

// fallow-ignore-next-line complexity
export function collectSnapContext(input: {
  overlayEl: HTMLDivElement;
  iframe: HTMLIFrameElement;
  excludeElements: Set<HTMLElement>;
}): SnapContext {
  const snapEnabled = readStudioUiPreferences().snapEnabled ?? true;

  const doc = input.iframe.contentDocument;
  if (!doc) {
    return { targets: [], compositionTarget: null, gridEdges: null, snapEnabled };
  }

  const root =
    doc.querySelector<HTMLElement>("[data-composition-id]") ?? (doc.documentElement as HTMLElement);
  const rootRect = root?.getBoundingClientRect();
  const declaredWidth = readPositiveDimension(root?.getAttribute("data-width") ?? null);
  const declaredHeight = readPositiveDimension(root?.getAttribute("data-height") ?? null);
  const rootWidth = declaredWidth ?? rootRect?.width;
  const rootHeight = declaredHeight ?? rootRect?.height;

  if (!rootWidth || !rootHeight || !rootRect) {
    return { targets: [], compositionTarget: null, gridEdges: null, snapEnabled };
  }

  const iframeRect = input.iframe.getBoundingClientRect();
  const overlayRect = input.overlayEl.getBoundingClientRect();
  const compositionOverlayRect: OverlayRect = {
    left: iframeRect.left - overlayRect.left,
    top: iframeRect.top - overlayRect.top,
    width: iframeRect.width,
    height: iframeRect.height,
    editScaleX: iframeRect.width / rootWidth,
    editScaleY: iframeRect.height / rootHeight,
  };
  const elements = snapCandidates(root, input.excludeElements);
  const rects = elements.map((element) =>
    toVisibleOverlayRect(input.overlayEl, input.iframe, element),
  );
  return snapContextFromRects(compositionOverlayRect, rects);
}

// fallow-ignore-next-line complexity
export function buildExcludeElements(input: {
  iframe: HTMLIFrameElement;
  selection?: DomEditSelection | null;
  groupSelections?: DomEditSelection[];
}): Set<HTMLElement> {
  const elements = new Set<HTMLElement>();
  const sel = input.selection;
  if (sel?.element) {
    elements.add(sel.element);
  }
  if (input.groupSelections) {
    for (const gs of input.groupSelections) {
      if (gs.element) elements.add(gs.element);
    }
  }
  return elements;
}
