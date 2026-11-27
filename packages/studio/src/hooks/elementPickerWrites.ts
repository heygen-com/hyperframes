import { compositionPathOfPreviewUrl } from "../player/components/CompositionThumbnail";
import { previewFrameOpaque } from "../player/lib/previewChannel";
import {
  describePreviewElements,
  editPreviewElement,
  previewElementSourceFile,
  queryPreviewElements,
} from "../player/lib/previewElements";
import { getSourceFileForElement } from "../components/editor/domEditingDom";

const previewedPath = (iframe: HTMLIFrameElement) =>
  compositionPathOfPreviewUrl(iframe.getAttribute("src") ?? "");

export interface PickedSource {
  hfId: string | null;
  ownFile: string;
}

export interface PickedWrite {
  live: (el: HTMLElement) => void;
  sealed: Parameters<typeof editPreviewElement>[2];
}

/** Draws `write` on the frame's first `selector` match; the element's source, or null when nothing was drawn. */
export function writePicked(
  iframe: HTMLIFrameElement,
  selector: string,
  write: PickedWrite,
): PickedSource | null | Promise<PickedSource | null> {
  if (previewFrameOpaque(iframe)) return writeSealedPicked(iframe, selector, write.sealed);
  try {
    const el = iframe.contentDocument?.querySelector<HTMLElement>(selector);
    if (!el) return null;
    write.live(el);
    const ownFile = getSourceFileForElement(el, previewedPath(iframe)).sourceFile;
    return { hfId: el.getAttribute("data-hf-id"), ownFile };
  } catch {
    return null;
  }
}

async function writeSealedPicked(
  iframe: HTMLIFrameElement,
  selector: string,
  edit: PickedWrite["sealed"],
): Promise<PickedSource | null> {
  const handle = (await queryPreviewElements(iframe, selector))?.matches[0]?.handle;
  const [element] = (handle && (await describePreviewElements(iframe, [handle]))) || [];
  if (!element || !(await editPreviewElement(iframe, element.handle, edit).drawn)) return null;
  const hfId = element.attributes.find(([name]) => name === "data-hf-id")?.[1] ?? null;
  return { hfId, ownFile: previewElementSourceFile(element, previewedPath(iframe)) };
}
