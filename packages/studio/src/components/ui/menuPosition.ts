const MENU_MARGIN = 8;

export interface MenuAnchor {
  left: number;
  top: number;
  bottom: number;
}

export const pointAnchor = (x: number, y: number): MenuAnchor => ({ left: x, top: y, bottom: y });

/** The pressed element's `[data-menu-anchor]` box, else the pointer's point. */
export function menuAnchor(target: EventTarget | null, x: number, y: number): MenuAnchor {
  const anchor = (target as Element | null)?.closest?.("[data-menu-anchor]");
  return anchor ? anchor.getBoundingClientRect() : pointAnchor(x, y);
}

/** Below the anchor; above it when that does not fit; clamped inside the window only when neither fits. */
export function placeMenu(
  anchor: MenuAnchor,
  size: { width: number; height: number },
  view = { width: window.innerWidth, height: window.innerHeight },
): { left: number; top: number } {
  const left = anchor.left + size.width > view.width ? anchor.left - size.width : anchor.left;
  if (anchor.bottom + size.height <= view.height) return { left, top: anchor.bottom };
  if (anchor.top - size.height >= 0) return { left, top: anchor.top - size.height };
  return { left, top: Math.max(MENU_MARGIN, view.height - size.height - MENU_MARGIN) };
}
