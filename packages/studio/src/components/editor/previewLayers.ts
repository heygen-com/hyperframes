/** Layers rows and marquee candidates for a preview frame Studio cannot script, from its runtime. */
import { MAX_DESCRIBE_HANDLES, type EditingLayer } from "@hyperframes/core/runtime/editing-port";
import {
  describePreviewElements,
  previewLayers,
  queryPreviewElements,
  type PreviewElement,
} from "../../player/lib/previewElements";
import type { Rect } from "../../utils/marqueeGeometry";
import { coversComposition } from "../../utils/studioPreviewHelpers";
import { buildElementLabel, getDataAttributes } from "./domEditingDom";
import { getDomEditLayerKey } from "./domEditingLayers";
import type { DomEditContextOptions, DomEditLayerItem, DomEditSelection } from "./domEditingTypes";
import { measurePreviewVisibleRects } from "./previewOverlayRects";
import {
  previewIdentity,
  readable,
  resolvePreviewSelection,
  standInFor,
  standInHandle,
} from "./previewSelection";

async function describeAll(iframe: HTMLIFrameElement, handles: readonly string[]) {
  const described: Array<PreviewElement | null> = [];
  for (let at = 0; at < handles.length; at += MAX_DESCRIBE_HANDLES) {
    const part = await describePreviewElements(
      iframe,
      handles.slice(at, at + MAX_DESCRIBE_HANDLES),
    );
    if (!part) return null;
    described.push(...part);
  }
  return described;
}

function layerItem(
  iframe: HTMLIFrameElement,
  layer: EditingLayer,
  element: PreviewElement,
  path: string | null,
): DomEditLayerItem {
  const probe = readable(element);
  const identity = previewIdentity(element, path);
  return {
    ...identity,
    key: getDomEditLayerKey(identity),
    element: standInFor(iframe, element),
    label: buildElementLabel(probe),
    tagName: element.tag,
    depth: layer.depth,
    childCount: layer.childCount,
    preview: {
      handle: layer.handle,
      zIndex: layer.zIndex,
      kind: layer.kind,
      dataAttributes: getDataAttributes(probe),
    },
  };
}

/**
 * `collectDomEditLayerItems` over the frame's runtime; null when it cannot answer. `missingGroup`
 * says the drilled-into group is gone from the frame, as after a reload, and lists nothing.
 */
export async function collectPreviewLayerItems(
  iframe: HTMLIFrameElement,
  options: Pick<DomEditContextOptions, "activeCompositionPath" | "activeGroupElement">,
  maxItems = Number.POSITIVE_INFINITY,
): Promise<{ items: DomEditLayerItem[]; missingGroup: boolean } | null> {
  const group = options.activeGroupElement && standInHandle(options.activeGroupElement);
  const reply = await previewLayers(iframe, group ?? undefined);
  const layers = reply?.layers.slice(0, maxItems) ?? [];
  const described =
    reply &&
    (await describeAll(
      iframe,
      layers.map((layer) => layer.handle),
    ));
  if (!reply || !described) return null;
  const items = layers.flatMap((layer, index) => {
    const element = described[index];
    return element ? [layerItem(iframe, layer, element, options.activeCompositionPath)] : [];
  });
  return { items, missingGroup: reply.missingGroup };
}

// A bound on the pages one read follows, so a frame that never stops paging cannot hold it open.
const MAX_LAYER_PAGES = 64;

/** Every layer the frame lists, page by page past its per-reply cap; null when it cannot answer. */
async function allPreviewLayers(iframe: HTMLIFrameElement): Promise<EditingLayer[] | null> {
  const layers: EditingLayer[] = [];
  for (let page = 0; page < MAX_LAYER_PAGES; page += 1) {
    const reply = await previewLayers(iframe, undefined, layers.length);
    if (!reply) return null;
    layers.push(...reply.layers);
    if (!reply.truncated || !reply.layers.length) break;
  }
  return layers;
}

/** A layer's `data-` attribute; a stand-in's comes from its description. */
export function layerDataAttribute(layer: DomEditLayerItem, name: `data-${string}`) {
  if (!layer.preview) return layer.element.getAttribute(name);
  return layer.preview.dataAttributes[name.slice("data-".length)] ?? null;
}

async function compositionViewport(iframe: HTMLIFrameElement) {
  const roots = await queryPreviewElements(iframe, "[data-composition-id]");
  const root = roots?.matches[0] ?? (await queryPreviewElements(iframe, "html"))?.matches[0];
  const [described] = (root && (await describePreviewElements(iframe, [root.handle]))) || [];
  if (!described) return null;
  const declared = (name: string) =>
    Number.parseFloat(described.attributes.find(([key]) => key === name)?.[1] ?? "");
  const [width, height] = [declared("data-width"), declared("data-height")];
  return {
    width: width > 0 ? width : described.rect.width || 1,
    height: height > 0 ? height : described.rect.height || 1,
  };
}

export interface PreviewMarqueeHit {
  element: HTMLElement;
  rect: Rect;
  description: PreviewElement;
}

/** `collectMarqueeCandidates` over the frame's runtime: every visible, not full-bleed layer. */
export async function collectPreviewMarqueeCandidates(
  iframe: HTMLIFrameElement,
  overlayEl: HTMLDivElement,
): Promise<PreviewMarqueeHit[]> {
  // Hit-testing takes the whole document, as same-origin does: a layer past one reply's cap still selects.
  const layers = await allPreviewLayers(iframe);
  const handles = layers?.map((layer) => layer.handle) ?? [];
  const viewport = handles.length ? await compositionViewport(iframe) : null;
  const described = viewport && (await describeAll(iframe, handles));
  const measured = described && (await measurePreviewVisibleRects(iframe, overlayEl, handles));
  if (!described || !measured || !viewport) return [];
  return handles.flatMap((_, index) => {
    const description = described[index];
    const box = measured[index];
    if (!description || !box?.visible || coversComposition(box.frame, viewport)) return [];
    const { left, top, width, height } = box.rect;
    const element = standInFor(iframe, description);
    return [{ element, rect: { left, top, width, height }, description }];
  });
}

/** Marquee picks as selections, read like the frame's own descriptions. */
export async function resolvePreviewMarqueeHits(
  iframe: HTMLIFrameElement,
  hits: PreviewMarqueeHit[],
  activeCompositionPath: string,
): Promise<DomEditSelection[]> {
  const isMasterView = !activeCompositionPath || activeCompositionPath === "index.html";
  const options = { activeCompositionPath, isMasterView, skipSourceProbe: true };
  const picks: DomEditSelection[] = [];
  for (const hit of hits) {
    const selection = await resolvePreviewSelection(iframe, hit.description, options);
    if (selection) picks.push(selection);
  }
  return picks;
}
