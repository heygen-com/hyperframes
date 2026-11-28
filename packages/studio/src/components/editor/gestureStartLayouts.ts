const layouts = new Map<string, { width: number; height: number }>();

export function rememberGestureStartLayouts(
  boxes: Array<{ handle: string; layout: { width: number; height: number } | null | undefined }>,
): void {
  layouts.clear();
  for (const { handle, layout } of boxes)
    if (layout && layout.width >= 1 && layout.height >= 1) layouts.set(handle, { ...layout });
}

export const gestureStartLayout = (handle: string) => layouts.get(handle) ?? null;
