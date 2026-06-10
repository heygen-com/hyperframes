import { useCallback, useEffect, useRef, type RefObject } from "react";

/**
 * Shared dismiss logic for context menus: closes on outside click or Escape.
 * Returns a ref to attach to the menu container element.
 */
export function useContextMenuDismiss(onClose: () => void): RefObject<HTMLDivElement | null> {
  const menuRef = useRef<HTMLDivElement>(null);

  const dismiss = useCallback(
    (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e instanceof MouseEvent && menuRef.current?.contains(e.target as Node)) return;
      onClose();
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, [dismiss]);

  return menuRef;
}
