import { previewFrameOpaque } from "../player/lib/previewChannel";
import { resolvePreviewPlayerHost } from "../player/lib/timelineIframeHelpers";

export interface PreviewCompositionSize {
  width: number;
  height: number;
}

type SizedPlayer = HTMLElement & {
  ready?: boolean;
  compositionWidth?: number;
  compositionHeight?: number;
};

const isPositive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

function readyPlayerCompositionSize(iframe: HTMLIFrameElement): PreviewCompositionSize | null {
  const player = resolvePreviewPlayerHost(iframe) as SizedPlayer | null;
  if (!player?.ready) return null;
  const { compositionWidth: width, compositionHeight: height } = player;
  return isPositive(width) && isPositive(height) ? { width, height } : null;
}

/** The root composition's authored size, from the preview document, or from its player when the frame is sealed. */
// fallow-ignore-next-line complexity
export function readPreviewCompositionSize(
  iframe: HTMLIFrameElement | null,
): PreviewCompositionSize | null {
  if (iframe && previewFrameOpaque(iframe)) return readyPlayerCompositionSize(iframe);
  try {
    const doc = iframe?.contentDocument;
    const root =
      doc?.querySelector("[data-composition-id][data-width][data-height]") ??
      doc?.querySelector("[data-width][data-height]");
    if (!root) return null;
    const width = Number.parseInt(root.getAttribute("data-width") ?? "", 10);
    const height = Number.parseInt(root.getAttribute("data-height") ?? "", 10);
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
      return null;
    }
    return { width, height };
  } catch {
    return null;
  }
}
