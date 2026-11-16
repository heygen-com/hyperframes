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

/** A sealed frame's size, as its player holds it: the runtime's timeline message sets it before the player is ready,
 * so before that the player's numbers are only its defaults. */
function readPlayerCompositionSize(iframe: HTMLIFrameElement): PreviewCompositionSize | null {
  const player = resolvePreviewPlayerHost(iframe) as SizedPlayer | null;
  if (!player?.ready) return null;
  const { compositionWidth: width, compositionHeight: height } = player;
  return isPositive(width) && isPositive(height) ? { width, height } : null;
}

/** The root composition's authored size, read from the preview document itself, or from its player when the frame
 * is sealed and its document is out of reach. */
// fallow-ignore-next-line complexity
export function readPreviewCompositionSize(
  iframe: HTMLIFrameElement | null,
): PreviewCompositionSize | null {
  if (iframe && previewFrameOpaque(iframe)) return readPlayerCompositionSize(iframe);
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
