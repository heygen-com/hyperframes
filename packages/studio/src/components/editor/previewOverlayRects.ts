/**
 * Overlay rects for a preview frame Studio cannot script. The runtime measures the elements (see
 * `editingGeometry.ts` in core); the arithmetic that places them on the overlay is
 * `domEditOverlayGeometry`'s, so both kinds of frame draw an element's chrome in the same place.
 */
import {
  MAX_DESCRIBE_HANDLES,
  ROTATION_GATE_EPSILON_DEG,
  type EditingElementBox,
  type EditingElementGeometry,
  type EditingRect,
} from "@hyperframes/core/runtime/editing-port";
import { previewGeometry } from "../../player/lib/previewElements";
import { computeOverlayRootScale, type OverlayRootScale } from "./domEditOverlayBasis";
import { hugRectForClipPath } from "./domEditOverlayCrop";
import {
  frameCornersToOverlay,
  frameRectToOverlay,
  orientOverlayRect,
  resolveDomEditGroupOverlayRect,
  type OverlayRect,
} from "./domEditOverlayGeometry";

const clientRect = ({ x, y, width, height }: EditingRect) => ({ left: x, top: y, width, height });

/** `toOverlayRect`. */
const baseRect = (scale: OverlayRootScale, box: EditingElementBox) =>
  frameRectToOverlay(scale, clientRect(box.rect), box.source);

/** `orientedOverlayRect`. */
function orientedRect(scale: OverlayRootScale, box: EditingElementBox): OverlayRect {
  const base = baseRect(scale, box);
  if (Math.abs(box.angle) < ROTATION_GATE_EPSILON_DEG) return base;
  return orientOverlayRect(
    base,
    box.angle,
    box.corners && frameCornersToOverlay(scale, box.corners),
  );
}

/** `groupAwareOverlayRect`, or with `oriented`, `orientedGroupAwareOverlayRect`. */
function groupAwareRect(
  scale: OverlayRootScale,
  geometry: EditingElementGeometry,
  oriented: boolean,
): OverlayRect {
  if (!geometry.members)
    return oriented ? orientedRect(scale, geometry) : baseRect(scale, geometry);
  const rect = baseRect(scale, geometry);
  const members = geometry.members.map((member) =>
    frameRectToOverlay(scale, clientRect(member), null),
  );
  const union = resolveDomEditGroupOverlayRect(members);
  return union ? { ...union, editScaleX: rect.editScaleX, editScaleY: rect.editScaleY } : rect;
}

/** `orientedVisibleOverlayRect`. */
function visibleRect(scale: OverlayRootScale, box: EditingElementBox): OverlayRect {
  const rect = orientedRect(scale, box);
  return { ...rect, ...hugRectForClipPath(rect, box.clipPath) };
}

export interface PreviewOverlayTargets {
  selection: string | null;
  group: Array<string | null>;
  hover: string | null;
}

export interface PreviewOverlayRects {
  /** Null when the element is gone or does not render. */
  selection: OverlayRect | null;
  /** The selection's descendants' outlines, as `useDomEditOverlayRects` draws them. */
  children: OverlayRect[];
  group: Array<OverlayRect | null>;
  hover: OverlayRect | null;
}

/** The rects `useDomEditOverlayRects` draws, in one geometry read; null when the frame cannot answer. */
export async function measurePreviewOverlay(
  iframe: HTMLIFrameElement,
  overlayEl: HTMLDivElement,
  targets: PreviewOverlayTargets,
): Promise<PreviewOverlayRects | null> {
  const handles = [...new Set([targets.selection, targets.hover, ...targets.group])].filter(
    (handle): handle is string => Boolean(handle),
  );
  // A selection with no handle is not in this frame; it draws nothing, as one not found there.
  const reply = handles.length
    ? await previewGeometry(iframe, handles, targets.selection ?? undefined)
    : { elements: [], children: null };
  const scale = reply && computeOverlayRootScale(overlayEl, iframe, null);
  if (!reply || !scale) return null;
  const read = (handle: string | null) =>
    handle ? (reply.elements[handles.indexOf(handle)] ?? null) : null;
  const selected = read(targets.selection);
  const shown = selected?.visible ? selected : null;
  const hovered = read(targets.hover);
  return {
    selection: shown && groupAwareRect(scale, shown, true),
    children: shown
      ? (reply.children ?? [])
          .map((box) => visibleRect(scale, box))
          .filter((rect) => rect.width > 2 && rect.height > 2)
      : [],
    group: targets.group.map((handle) => {
      const member = read(handle);
      const rect = member && groupAwareRect(scale, member, false);
      return rect && { ...rect, ...hugRectForClipPath(rect, member.clipPath) };
    }),
    hover: hovered && groupAwareRect(scale, hovered, true),
  };
}

/** `orientedGroupAwareOverlayRect` for each handle; null when the frame cannot answer. */
export async function measurePreviewRects(
  iframe: HTMLIFrameElement,
  overlayEl: HTMLDivElement,
  handles: string[],
): Promise<Array<OverlayRect | null> | null> {
  const reply = await previewGeometry(iframe, handles);
  const scale = reply && computeOverlayRootScale(overlayEl, iframe, null);
  if (!reply || !scale) return null;
  return reply.elements.map((geometry) => geometry && groupAwareRect(scale, geometry, true));
}

/** `toVisibleOverlayRect` for each handle, with its frame rect and whether it renders. */
export async function measurePreviewVisibleRects(
  iframe: HTMLIFrameElement,
  overlayEl: HTMLDivElement,
  handles: string[],
) {
  const measured: Array<{ rect: OverlayRect; frame: EditingRect; visible: boolean } | null> = [];
  for (let at = 0; at < handles.length; at += MAX_DESCRIBE_HANDLES) {
    const reply = await previewGeometry(iframe, handles.slice(at, at + MAX_DESCRIBE_HANDLES));
    const scale = reply && computeOverlayRootScale(overlayEl, iframe, null);
    if (!reply || !scale) return null;
    for (const box of reply.elements) {
      const rect = box && baseRect(scale, box);
      measured.push(
        box &&
          rect && {
            rect: { ...rect, ...hugRectForClipPath(rect, box.clipPath) },
            frame: box.rect,
            visible: box.visible,
          },
      );
    }
  }
  return measured;
}
