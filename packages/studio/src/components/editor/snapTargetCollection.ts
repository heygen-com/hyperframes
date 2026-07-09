// fallow-ignore-file code-duplication
import type { DomEditSelection } from "./domEditing";
import {
  isElementVisibleForOverlay,
  toVisibleOverlayRect,
  type OverlayRect,
} from "./domEditOverlayGeometry";
import {
  extractSnapTargets,
  buildCompositionSnapTarget,
  buildGridSnapEdges,
  type SnapTarget,
  type SnapEdge,
} from "./snapEngine";
import { readStudioUiPreferences } from "../../utils/studioUiPreferences";
import { resolvePreviewCoordinateSpace } from "../../utils/previewCoordinates";

export interface SnapContext {
  targets: SnapTarget[];
  compositionTarget: SnapTarget | null;
  gridEdges: { x: SnapEdge[]; y: SnapEdge[] } | null;
  snapEnabled: boolean;
}

const IGNORED_TAGS = new Set(["script", "style", "link", "meta", "base", "template", "br", "wbr"]);

function isHtmlElement(node: Node): node is HTMLElement {
  return node.nodeType === 1;
}

function collectVisibleElements(
  root: HTMLElement,
  excludeElements: Set<HTMLElement>,
  maxItems: number,
): HTMLElement[] {
  const result: HTMLElement[] = [];
  // fallow-ignore-next-line complexity
  const visit = (el: HTMLElement) => {
    if (result.length >= maxItems) return;
    for (const child of Array.from(el.children)) {
      if (!isHtmlElement(child)) continue;
      if (IGNORED_TAGS.has(child.tagName.toLowerCase())) continue;
      if (child.hasAttribute("data-composition-id")) continue;
      if (excludeElements.has(child)) continue;
      if (!isElementVisibleForOverlay(child)) continue;
      result.push(child);
      visit(child);
    }
  };
  visit(root);
  return result;
}

// fallow-ignore-next-line complexity
export function collectSnapContext(input: {
  overlayEl: HTMLDivElement;
  iframe: HTMLIFrameElement;
  excludeElements: Set<HTMLElement>;
}): SnapContext {
  const prefs = readStudioUiPreferences();
  const snapEnabled = prefs.snapEnabled ?? true;

  const space = resolvePreviewCoordinateSpace(input.iframe);
  if (!space) {
    return { targets: [], compositionTarget: null, gridEdges: null, snapEnabled };
  }

  const overlayRect = input.overlayEl.getBoundingClientRect();

  const compositionOverlayRect: OverlayRect = {
    left: space.iframeRect.left - overlayRect.left,
    top: space.iframeRect.top - overlayRect.top,
    width: space.iframeRect.width,
    height: space.iframeRect.height,
    editScaleX: space.scaleX,
    editScaleY: space.scaleY,
  };
  const compositionTarget = buildCompositionSnapTarget(compositionOverlayRect);

  const MAX_SNAP_TARGETS = 80;
  const elements = collectVisibleElements(space.root, input.excludeElements, MAX_SNAP_TARGETS);

  const entries: Array<{
    rect: { left: number; top: number; width: number; height: number };
    id: string;
  }> = [];
  for (let i = 0; i < elements.length; i++) {
    const rect = toVisibleOverlayRect(input.overlayEl, input.iframe, elements[i]);
    if (rect) entries.push({ rect, id: `snap-target-${i}` });
  }

  const targets = extractSnapTargets(entries);

  let gridEdges: { x: SnapEdge[]; y: SnapEdge[] } | null = null;
  const gridSpacing = prefs.gridSpacing ?? 50;
  const snapToGrid = prefs.snapToGrid ?? false;
  if (snapToGrid && gridSpacing > 0) {
    gridEdges = buildGridSnapEdges(compositionOverlayRect, gridSpacing, space.scaleX, space.scaleY);
  }

  return { targets, compositionTarget, gridEdges, snapEnabled };
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
