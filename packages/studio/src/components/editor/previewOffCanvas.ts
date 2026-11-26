/** Off-canvas indicators for a preview frame Studio cannot script, from its runtime's layers and geometry. */
import {
  MAX_DESCRIBE_HANDLES,
  type EditingElementGeometry,
} from "@hyperframes/core/runtime/editing-port";
import { describePreviewElements, previewGeometry } from "../../player/lib/previewElements";
import type { ReadPriority } from "../../player/lib/previewChannel";
import type { OffCanvasRect } from "./OffCanvasIndicators";
import { computeOverlayRootScale } from "./domEditOverlayBasis";
import { resolveDomEditSelection } from "./domEditingLayers";
import type { DomEditSelection } from "./domEditingTypes";
import { hugRectForClipPath } from "./domEditOverlayCrop";
import { extendsOutside } from "./offCanvasIndicatorGeometry";
import { groupAwareRect } from "./previewOverlayRects";
import { collectAllPreviewLayerItems } from "./previewLayers";
import {
  resolvePreviewSelection,
  standInHandle,
  type PreviewSelectionOptions,
} from "./previewSelection";

async function geometryOf(iframe: HTMLIFrameElement, handles: string[], priority: ReadPriority) {
  const boxes: Array<EditingElementGeometry | null> = [];
  for (let at = 0; at < handles.length; at += MAX_DESCRIBE_HANDLES) {
    const handlesNow = handles.slice(at, at + MAX_DESCRIBE_HANDLES);
    const reply = await previewGeometry(iframe, handlesNow, undefined, priority);
    if (!reply) return null;
    boxes.push(...reply.elements);
  }
  return boxes;
}

/** `recomputeOffCanvasIndicators` over the frame's runtime; null when the frame cannot answer. */
export async function measurePreviewOffCanvas(
  iframe: HTMLIFrameElement,
  overlay: HTMLDivElement,
  comp: { left: number; top: number; width: number; height: number },
  activeCompositionPath: string | null,
  priority: ReadPriority = "now",
): Promise<{ rects: OffCanvasRect[]; elements: Map<string, HTMLElement> } | null> {
  const rects: OffCanvasRect[] = [];
  const elements = new Map<string, HTMLElement>();
  if (comp.width <= 0) return { rects, elements };
  const path = activeCompositionPath ?? "index.html";
  const items = await collectAllPreviewLayerItems(iframe, path, priority);
  const boxes =
    items &&
    (await geometryOf(
      iframe,
      items.map((item) => item.preview!.handle),
      priority,
    ));
  const scale = boxes && computeOverlayRootScale(overlay, iframe, null);
  if (!items || !boxes || !scale) return null;
  items.forEach((item, index) => {
    const box = boxes[index];
    if (!box?.visible) return;
    // As the same-origin read: a group by its members' union, then hugged to its crop.
    const base = groupAwareRect(scale, box, true);
    const r = { ...base, ...hugRectForClipPath(base, box.clipPath) };
    if (!extendsOutside(r, comp)) return;
    rects.push({
      key: item.key,
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height,
      angle: r.angle,
    });
    elements.set(item.key, item.element);
  });
  return { rects, elements };
}

/** The selection a click on an indicator makes; a sealed frame's stand-in resolves through the frame. */
export async function resolveIndicatorSelection(
  iframe: HTMLIFrameElement | null,
  element: HTMLElement,
  options: PreviewSelectionOptions,
): Promise<DomEditSelection | null> {
  const handle = standInHandle(element);
  if (!handle || !iframe) return resolveDomEditSelection(element, options);
  const [described] = (await describePreviewElements(iframe, [handle])) ?? [];
  return described ? resolvePreviewSelection(iframe, described, options) : null;
}
