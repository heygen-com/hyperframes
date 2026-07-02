export interface ScreenshotClip {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function getElementScreenshotClip(
  selector: string,
  selectorIndex?: number,
): ScreenshotClip | undefined {
  const matches = Array.from(document.querySelectorAll(selector)).filter(
    (el): el is HTMLElement => el instanceof HTMLElement,
  );
  const safeIndex = Math.max(0, Math.min(matches.length - 1, Math.floor(selectorIndex ?? 0)));
  const el = matches[safeIndex] ?? null;
  if (!(el instanceof HTMLElement)) return undefined;
  const rect = el.getBoundingClientRect();
  if (rect.width < 4 || rect.height < 4) return undefined;
  const pad = 8;
  const x = Math.max(0, rect.left - pad);
  const y = Math.max(0, rect.top - pad);
  const maxWidth = window.innerWidth - x;
  const maxHeight = window.innerHeight - y;
  return {
    x,
    y,
    width: Math.max(1, Math.min(rect.width + pad * 2, maxWidth)),
    height: Math.max(1, Math.min(rect.height + pad * 2, maxHeight)),
  };
}
