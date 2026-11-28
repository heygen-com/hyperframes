import { useCallback, useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import { matchesKey } from "../../player/components/studioShortcuts";
import { onSealedCanvasCancel } from "../editor/useSealedCanvasKeys";
import type { CompositionLevel } from "./CompositionBreadcrumb";

// The preview frame sits in its player's shadow root, which contains() doesn't cross.
function placedElement(frame: HTMLIFrameElement): Element {
  const root = frame.getRootNode();
  return root instanceof ShadowRoot ? root.host : frame;
}

/** Escape in the shell leaves one composition level, and so does a no-press Escape from a sealed frame inside it. */
export function useCompositionEscape(
  updateCompositionStack: Dispatch<SetStateAction<CompositionLevel[]>>,
  containerRef: RefObject<HTMLDivElement | null>,
): (event: React.KeyboardEvent) => void {
  const pop = useCallback(
    () => updateCompositionStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev)),
    [updateCompositionStack],
  );
  useEffect(
    () =>
      onSealedCanvasCancel((frame) => {
        if (containerRef.current?.contains(placedElement(frame))) pop();
      }),
    [containerRef, pop],
  );
  return useCallback(
    (event: React.KeyboardEvent) => {
      if (matchesKey(event, "cancel")) pop();
    },
    [pop],
  );
}
