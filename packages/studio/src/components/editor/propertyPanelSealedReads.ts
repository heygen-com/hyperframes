import { useEffect, useState } from "react";
import type { GsapAnimation } from "@hyperframes/parsers/gsap-parser";
import type { DomEditSelection } from "./domEditing";
import { findPreviewNode } from "./domEditingElement";
import {
  previewComputedStyles,
  previewDocumentMarkup,
  previewFrameOpaque,
} from "../../player/lib/previewChannel";

type PanelBorderRadius = { tl: number; tr: number; br: number; bl: number };

const RADIUS_CORNERS = [
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
] as const;

function cornerRadii(read: (corner: string) => string | undefined): PanelBorderRadius {
  const [tl, tr, br, bl] = RADIUS_CORNERS.map(
    (corner) => Number.parseFloat(read(corner) ?? "") || 0,
  );
  return { tl: tl!, tr: tr!, br: br!, bl: bl! };
}

/** The element's computed corner radii while GSAP animates them: at once from a readable frame, else asked of it. */
export function readGsapBorderRadiusForPanel(
  gsapRuntimeValues: Record<string, number> | null,
  gsapAnimations: GsapAnimation[],
  element: DomEditSelection,
  iframe: HTMLIFrameElement | null,
): PanelBorderRadius | Promise<PanelBorderRadius | null> | null {
  if (!gsapRuntimeValues || !("borderRadius" in gsapRuntimeValues)) {
    const hasBRProp = gsapAnimations.some(
      (a) =>
        "borderRadius" in a.properties ||
        a.keyframes?.keyframes.some((kf) => "borderRadius" in kf.properties),
    );
    if (!hasBRProp) return null;
  }
  if (!iframe) return null;
  if (previewFrameOpaque(iframe)) {
    if (!element.handle) return null;
    return previewComputedStyles(iframe, { handle: element.handle }, [...RADIUS_CORNERS]).then(
      (styles) => styles && cornerRadii((corner) => styles[corner]),
    );
  }
  try {
    const el = iframe.contentDocument && findPreviewNode(iframe.contentDocument, element);
    if (!el || !iframe.contentWindow) return null;
    const cs = iframe.contentWindow.getComputedStyle(el);
    return cornerRadii((corner) => cs.getPropertyValue(corner));
  } catch {
    return null;
  }
}

/**
 * The "element info" text copied for an AI agent, its line found in the frame's markup `src`; both inspector
 * headers share it. Pure — the caller owns the clipboard write, toast, and copied state.
 */
// fallow-ignore-next-line complexity
function buildElementInfoText(
  element: DomEditSelection,
  sourceLabel: string,
  gsapAnimations: GsapAnimation[],
  src: string,
): string {
  const file = element.sourceFile ?? "index.html";
  let lineNum: number | null = null;
  if (src && element.id) {
    const idx = src.indexOf(`id="${element.id}"`);
    if (idx > -1) lineNum = src.slice(0, idx).split("\n").length;
  }
  if (!lineNum && element.selector) {
    const tag = element.tagName.toLowerCase();
    const cls = element.selector.startsWith(".") ? element.selector.slice(1).split(".")[0] : null;
    const search = cls ? `class="${cls}` : `<${tag}`;
    const idx = src.indexOf(search);
    if (idx > -1) lineNum = src.slice(0, idx).split("\n").length;
  }
  const fileLoc = lineNum ? `${file}:${lineNum}` : file;
  const lines = [
    `Element: ${element.label} (${sourceLabel})`,
    `File: ${fileLoc}`,
    `Position: x=${Math.round(element.boundingBox.x)}, y=${Math.round(element.boundingBox.y)}`,
    `Size: ${Math.round(element.boundingBox.width)}×${Math.round(element.boundingBox.height)}`,
    `Tag: <${element.tagName}>`,
  ];
  if (element.computedStyles["z-index"] && element.computedStyles["z-index"] !== "auto") {
    lines.push(`Z-index: ${element.computedStyles["z-index"]}`);
  }
  if (gsapAnimations.length > 0) {
    const anim = gsapAnimations[0];
    lines.push(
      `Animation: ${anim.method}() ${anim.duration}s at ${anim.position}s, ease: ${anim.ease ?? "default"}`,
    );
    const props = Object.entries(anim.properties)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    if (props) lines.push(`Properties: ${props}`);
  }
  return lines.join("\n");
}

export async function readElementInfoText(
  element: DomEditSelection,
  sourceLabel: string,
  gsapAnimations: GsapAnimation[],
  iframe: HTMLIFrameElement | null | undefined,
): Promise<string> {
  let src = "";
  try {
    if (iframe && previewFrameOpaque(iframe)) src = (await previewDocumentMarkup(iframe)) ?? "";
    else src = iframe?.contentDocument?.documentElement?.outerHTML ?? "";
  } catch {}
  return buildElementInfoText(element, sourceLabel, gsapAnimations, src);
}

export function useAnswered<T extends object>(
  read: T | Promise<T | null> | null,
  owner: unknown,
): T | null {
  const [answered, setAnswered] = useState<{ owner: unknown; value: T | null } | null>(null);
  useEffect(() => {
    if (!(read instanceof Promise)) return;
    let current = true;
    void read.then((value) => current && setAnswered({ owner, value }));
    return () => {
      current = false;
    };
  }, [read, owner]);
  if (!(read instanceof Promise)) return read;
  return answered && answered.owner === owner ? answered.value : null;
}
