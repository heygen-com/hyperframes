/** The frame's layout box of each element a sealed gesture pressed, by handle, from its gesture-start read. */
const layouts = new Map<string, { width: number; height: number }>();

/** Replaces the boxes with this press's: a size under 1 px in either axis is no box. */
export function rememberGestureStartLayouts(
  boxes: Array<{ handle: string; layout: { width: number; height: number } | null | undefined }>,
): void {
  layouts.clear();
  for (const { handle, layout } of boxes)
    if (layout && layout.width >= 1 && layout.height >= 1) layouts.set(handle, { ...layout });
}

export const gestureStartLayout = (handle: string) => layouts.get(handle) ?? null;
