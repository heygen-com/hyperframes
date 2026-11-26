import type { RefObject } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import { matchesKey } from "../../player/components/studioShortcuts";

/** Cancels a held gesture that loses the window, the tab or the overlay, or meets Escape. */
export function useHeldGestureCancel(
  cancelRef: RefObject<(dropQueued?: boolean) => void>,
  isHeld: () => boolean,
  suppressNextClickRef: RefObject<boolean>,
) {
  useMountEffect(() => {
    const cancel = () => cancelRef.current();
    const onEscape = (event: KeyboardEvent) => {
      if (!matchesKey(event, "cancel") || !isHeld()) return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
      // The button is still down, so its release must not land as a click on the canvas.
      suppressNextClickRef.current = true;
    };
    const onHidden = () => document.hidden && cancel();
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", onEscape, true);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", onEscape, true);
      document.removeEventListener("visibilitychange", onHidden);
      cancelRef.current(true);
    };
  });
}
