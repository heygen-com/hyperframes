/**
 * A sealed drag's selection chrome is painted by the frame with each draft (core `editing/dragChrome`), so it
 * lands in the layer's compositor frame. Studio sends a copy of its own chrome and keeps only what lies outside.
 */
import {
  parseDragChrome,
  type EditingDragChrome,
  type EditingDragChromeNode,
} from "@hyperframes/core/runtime/editing-port";
import { previewFrameOpaque } from "../../player/lib/previewChannel";
import { computeOverlayRootScale } from "./domEditOverlayBasis";
import {
  carryPreviewDraftChrome,
  endPreviewDraftChrome,
  type DraftChromeCarrier,
} from "./previewDrafts";

export const CHROME_PLANE_ATTR = "data-dom-edit-chrome-plane";

// Paint only; placement comes from each element's inline style, every step.
const LOOK = [
  "position",
  "display",
  "box-sizing",
  "left",
  "top",
  "right",
  "bottom",
  "width",
  "height",
  "align-items",
  "justify-content",
  ...["top", "right", "bottom", "left"].flatMap((side) =>
    ["width", "style", "color"].map((part) => `border-${side}-${part}`),
  ),
  ...["top-left", "top-right", "bottom-right", "bottom-left"].map((c) => `border-${c}-radius`),
  "background-color",
  "box-shadow",
  "color",
  "opacity",
  "transform",
  "overflow",
  "visibility",
  "z-index",
  "clip-path",
  "fill",
  "stroke",
  "stroke-width",
];
const UNSET = new Set(["", "auto", "none", "normal", "static", "visible", "rgba(0, 0, 0, 0)"]);
const SVG_ATTRS = [
  "d",
  "viewBox",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "width",
  "height",
];

function tagOf(element: Element): EditingDragChromeNode["tag"] | null {
  const tag = element.tagName.toLowerCase();
  if (tag === "svg" || tag === "path" || tag === "span" || tag === "div") return tag;
  return tag === "button" ? "div" : null;
}

function lookOf(element: Element): Record<string, string> {
  const computed = getComputedStyle(element);
  const look: Record<string, string> = {};
  for (const name of LOOK) {
    const value = computed.getPropertyValue(name);
    if (!UNSET.has(value) || name === "display") look[name] = value;
  }
  return look;
}

function attrsOf(element: Element): Record<string, string> | undefined {
  if (!(element instanceof SVGElement)) return undefined;
  const pairs = SVG_ATTRS.flatMap((name) => {
    const value = element.getAttribute(name);
    return value === null ? [] : [[name, value] as const];
  });
  return pairs.length ? Object.fromEntries(pairs) : undefined;
}

function copyOf(element: Element, elements: Element[]): EditingDragChromeNode | null {
  const tag = tagOf(element);
  if (!tag) return null;
  elements.push(element);
  const attrs = attrsOf(element);
  const children = [...element.children].flatMap((child) => copyOf(child, elements) ?? []);
  return {
    tag,
    look: lookOf(element),
    ...(attrs && { attrs }),
    ...(children.length && { children }),
  };
}

function placeOf(element: Element): Record<string, string> {
  const { style } = element as HTMLElement;
  const place: Record<string, string> = {};
  for (let i = 0; i < style.length; i++) place[style[i]!] = style.getPropertyValue(style[i]!);
  return place;
}

const listed = (plane: Element) =>
  [...plane.children].flatMap(function walk(el): Element[] {
    return tagOf(el) ? [el, ...[...el.children].flatMap(walk)] : [];
  });

const sameList = (a: readonly Element[], b: readonly Element[]) =>
  a.length === b.length && a.every((el, i) => el === b[i]);

/** Everything but the frame's own rect, in the plane's px. */
const outside = ({ x, y }: { x: number; y: number }, width: number, height: number) =>
  `path(evenodd, "M-100000 -100000H100000V100000H-100000Z M${x} ${y}h${width}v${height}h${-width}Z")`;

let current: {
  iframe: HTMLIFrameElement;
  plane: HTMLElement;
  held: () => boolean;
  carrier: DraftChromeCarrier;
} | null = null;

/** While `held`, the sealed frame paints Studio's chrome with each draft and Studio keeps what lies outside it. */
export function paintChromeInFrameWhile(
  iframe: HTMLIFrameElement | null,
  overlay: HTMLElement | null,
  held: () => boolean,
): void {
  const plane = overlay?.querySelector<HTMLElement>(`[${CHROME_PLANE_ATTR}]`);
  if (!iframe || !overlay || !plane || !previewFrameOpaque(iframe)) return;
  // ponytail: the frame's place in the overlay is read once per drag; a zoom or scroll mid-drag is not followed.
  const basis = computeOverlayRootScale(overlay as HTMLDivElement, iframe, null);
  if (!basis) return;
  endChromeInFrame();
  const origin = {
    x: basis.iframeRect.left - basis.overlayRect.left,
    y: basis.iframeRect.top - basis.overlayRect.top,
  };
  const scale = { x: basis.rootScaleX, y: basis.rootScaleY };
  let copied: Element[] = [];
  let inFrame = false;
  const carrier: DraftChromeCarrier = {
    read(): EditingDragChrome | undefined {
      const elements = listed(plane);
      let nodes: EditingDragChromeNode[] | undefined;
      if (!sameList(copied, elements)) {
        copied = [];
        nodes = [...plane.children].flatMap((child) => copyOf(child, copied) ?? []);
      }
      const chrome = { origin, scale, place: copied.map(placeOf), ...(nodes && { nodes }) };
      if (parseDragChrome(chrome) !== undefined) {
        inFrame = true;
        return chrome;
      }
      // A copy the frame would refuse rides no request, or it would take the drafts down with it.
      copied = [];
      plane.style.removeProperty("clip-path");
      const clear = inFrame ? null : undefined;
      inFrame = false;
      return clear;
    },
    shown() {
      if (current?.carrier === carrier)
        plane.style.clipPath = outside(origin, basis.iframeRect.width, basis.iframeRect.height);
    },
    // The frame had no copy this place fits (it reloaded): Studio draws it all until a new copy is shown.
    lost() {
      plane.style.removeProperty("clip-path");
      copied = [];
      inFrame = false;
    },
  };
  current = { iframe, plane, held, carrier };
  carryPreviewDraftChrome(iframe, carrier);
}

function endChromeInFrame(): void {
  if (!current) return;
  const { iframe, plane, carrier } = current;
  current = null;
  plane.style.removeProperty("clip-path");
  // Studio's whole chrome paints first; the frame's copy goes a frame later, so nothing blinks.
  requestAnimationFrame(() => endPreviewDraftChrome(iframe, carrier));
}

/** Gives the chrome back to Studio once the drag that showed it in the frame has ended. */
export function endChromeInFrameIfReleased(): void {
  if (current && !current.held()) endChromeInFrame();
}
