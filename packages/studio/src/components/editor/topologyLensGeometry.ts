import { previewFrameOpaque } from "../../player/lib/previewChannel";
import { agentPreview } from "../../webmcp/agentPreview";
import { resolveElementHandle } from "../../webmcp/handles";
import { collectStudioLookScene } from "../../webmcp/tools/lookTools";
import type { DomEditLayerItem } from "./domEditingTypes";
import { toVisibleOverlayRects, type OverlayRect } from "./domEditOverlayGeometry";
import { measurePreviewVisibleRects } from "./previewOverlayRects";

export interface TopologyLensNode {
  label: string;
  rect: OverlayRect;
}

export interface TopologyLensGeometry {
  field: TopologyLensNode;
  target: TopologyLensNode;
  contours: TopologyLensNode[];
}

function findSourceContextIndex(items: readonly DomEditLayerItem[], targetIndex: number): number {
  const target = items[targetIndex]!;
  let contextIndex = targetIndex;
  let parentDepth = target.depth - 1;
  for (let index = targetIndex - 1; index >= 0 && parentDepth >= 0; index--) {
    const item = items[index]!;
    if (item.depth !== parentDepth) continue;
    if (item.sourceFile !== target.sourceFile) break;
    contextIndex = index;
    parentDepth -= 1;
  }
  return contextIndex;
}

function collectSourceContours(
  items: readonly DomEditLayerItem[],
  contextIndex: number,
  target: DomEditLayerItem,
): HTMLElement[] {
  const context = items[contextIndex]!;
  const contours: HTMLElement[] = [];
  for (let index = contextIndex + 1; index < items.length; index++) {
    const item = items[index]!;
    if (item.depth <= context.depth) break;
    if (item.sourceFile === target.sourceFile && item.element !== target.element) {
      contours.push(item.element);
    }
  }
  return contours;
}

const SOURCE_HOST = ["data-composition-file", "data-composition-src"];

function sourceHostOf(items: readonly DomEditLayerItem[], targetIndex: number): HTMLElement | null {
  const target = items[targetIndex]!;
  if (!target.preview)
    return target.element.closest<HTMLElement>(SOURCE_HOST.map((name) => `[${name}]`).join());
  let depth = Number.POSITIVE_INFINITY;
  for (let index = targetIndex; index >= 0; index--) {
    const item = items[index]!;
    if (item.depth >= depth) continue;
    depth = item.depth;
    if (SOURCE_HOST.some((name) => name in (item.preview?.dataAttributes ?? {})))
      return item.element;
  }
  return null;
}

type LensElements = { context: HTMLElement; target: HTMLElement; contours: HTMLElement[] };

function lensElements(items: readonly DomEditLayerItem[], targetIndex: number): LensElements {
  const targetItem = items[targetIndex]!;
  const contextIndex = findSourceContextIndex(items, targetIndex);
  return {
    context: sourceHostOf(items, targetIndex) ?? items[contextIndex]!.element,
    target: targetItem.element,
    contours: collectSourceContours(items, contextIndex, targetItem),
  };
}

/**
 * Resolve the same nested preorder used by studio_look. This keeps the lens on
 * the agent's source-safe scene model instead of guessing hierarchy from an
 * unrelated presentation selector.
 */
export function resolveTopologyLensElements(
  doc: Document,
  activeCompositionPath: string | null,
  handle: string,
): LensElements | null {
  const target = resolveElementHandle(doc, handle);
  if (!target) return null;
  const scene = collectStudioLookScene(doc, activeCompositionPath, null);
  if (scene.status === "loading") return null;
  const targetIndex = scene.items.findIndex((item) => item.element === target);
  if (targetIndex < 0) return { context: target, target, contours: [] };
  return lensElements(scene.items, targetIndex);
}

async function resolveSealedLensElements(
  iframe: HTMLIFrameElement,
  activeCompositionPath: string | null,
  handle: string,
): Promise<{ elements: LensElements; handles: Map<HTMLElement, string> } | null> {
  const preview = agentPreview(() => iframe, activeCompositionPath);
  const [found, scene] = await Promise.all([preview.find(handle), preview.scene(null)]);
  if (!found || !("handle" in found) || scene.status === "loading") return null;
  const targetIndex = scene.items.findIndex((item) => item.preview?.handle === found.handle);
  if (targetIndex < 0) return null;
  const handles = new Map<HTMLElement, string>();
  for (const item of scene.items) if (item.preview) handles.set(item.element, item.preview.handle);
  return { elements: lensElements(scene.items, targetIndex), handles };
}

function isRenderableRect(rect: OverlayRect | null | undefined): rect is OverlayRect {
  return Boolean(rect && rect.width > 0 && rect.height > 0);
}

function lensOrder({ context, target, contours }: LensElements): HTMLElement[] {
  return context === target ? [target, ...contours] : [context, target, ...contours];
}

async function measureLens(input: {
  overlay: HTMLDivElement;
  iframe: HTMLIFrameElement;
  activeCompositionPath: string | null;
  handle: string;
}): Promise<{ elements: LensElements; measured: Array<OverlayRect | null> } | null> {
  const { overlay, iframe, activeCompositionPath, handle } = input;
  if (!previewFrameOpaque(iframe)) {
    const doc = iframe.contentDocument;
    const elements = doc && resolveTopologyLensElements(doc, activeCompositionPath, handle);
    return (
      elements && {
        elements,
        measured: toVisibleOverlayRects(overlay, iframe, lensOrder(elements)),
      }
    );
  }
  const resolved = await resolveSealedLensElements(iframe, activeCompositionPath, handle);
  if (!resolved) return null;
  const order = lensOrder(resolved.elements).map((element) => resolved.handles.get(element));
  if (order.some((entry) => entry === undefined)) return null;
  const boxes = await measurePreviewVisibleRects(iframe, overlay, order as string[]);
  return boxes && { elements: resolved.elements, measured: boxes.map((box) => box?.rect ?? null) };
}

export async function measureTopologyLensGeometry(input: {
  overlay: HTMLDivElement;
  iframe: HTMLIFrameElement;
  activeCompositionPath: string | null;
  handle: string;
}): Promise<TopologyLensGeometry | null> {
  const lens = await measureLens(input);
  if (!lens) return null;
  const { elements, measured } = lens;
  const sharedField = elements.context === elements.target;
  const target = measured[sharedField ? 0 : 1];
  if (!isRenderableRect(target)) return null;
  const measuredField = measured[0];
  const fieldUsesContext = !sharedField && isRenderableRect(measuredField);
  const contourOffset = sharedField ? 1 : 2;
  return {
    field: {
      label: (fieldUsesContext ? elements.context : elements.target).tagName.toLowerCase(),
      rect: fieldUsesContext ? measuredField : target,
    },
    target: { label: elements.target.tagName.toLowerCase(), rect: target },
    contours: measured
      .slice(contourOffset)
      .map((rect, index) => ({
        label: elements.contours[index]!.tagName.toLowerCase(),
        rect,
      }))
      .filter((item): item is TopologyLensNode => isRenderableRect(item.rect)),
  };
}
