import { useMemo, type RefObject } from "react";
import { usePreviewIframeStore } from "../../player/store/previewIframeStore";
import { useDomEditCompositionRect } from "./useDomEditCompositionRect";

export type { DomEditCompositionRect as PreviewCompositionRect } from "./useDomEditCompositionRect";

/**
 * Where the composition sits inside `overlayRef`, in overlay pixels, plus the scale from
 * composition units to pixels. Follows the live preview iframe across reloads.
 */
export function usePreviewCompositionRect(overlayRef: RefObject<HTMLDivElement | null>) {
  const iframeRef = useMemo<RefObject<HTMLIFrameElement | null>>(
    () => ({
      get current() {
        return usePreviewIframeStore.getState().iframe;
      },
    }),
    [],
  );
  return useDomEditCompositionRect({ iframeRef, overlayRef });
}
