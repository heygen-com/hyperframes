import type { DomEditSelection } from "./domEditing";

interface SelectionShapeStyles {
  borderRadius: string | number;
  clipPath: string | undefined;
}

// fallow-ignore-next-line complexity
export function resolveSelectionShapeStyles(
  selection: DomEditSelection | null,
): SelectionShapeStyles {
  const fallback = {
    borderRadius: 8 as string | number,
    clipPath: undefined as string | undefined,
  };
  if (!selection?.element) return fallback;
  try {
    const tag = selection.element.tagName.toLowerCase();
    if (tag === "svg" || tag === "img" || tag === "video" || tag === "canvas") return fallback;
    const win = selection.element.ownerDocument.defaultView;
    if (!win) return fallback;
    const cs = win.getComputedStyle(selection.element);
    const br = cs.borderRadius;
    const cp = cs.clipPath;
    return {
      borderRadius: br && br !== "0px" ? br : 4,
      clipPath: cp && cp !== "none" ? cp : undefined,
    };
  } catch {
    return fallback;
  }
}
