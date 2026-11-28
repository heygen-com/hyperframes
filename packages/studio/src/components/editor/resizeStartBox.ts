import { previewGeometry } from "../../player/lib/previewElements";
import { readStudioBoxSizeDraftBase, type LayoutBox } from "./manualEditsDom";
import { previewStandIn } from "./previewDrafts";

/** A sealed resize's starting box: its gesture's draft base, else the frame's layout read now. Null when open. */
export function sealedResizeStartBox(standIn: HTMLElement): Promise<LayoutBox | null> | null {
  const target = previewStandIn(standIn);
  if (!target) return null;
  const base = readStudioBoxSizeDraftBase(standIn);
  if (base) return Promise.resolve(base);
  return previewGeometry(target.iframe, [target.handle]).then((reply) => {
    const layout = reply?.elements[0]?.layout;
    return layout && layout.width >= 1 && layout.height >= 1 ? { ...layout } : null;
  });
}
