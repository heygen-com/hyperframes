export interface PreviewViewportSize {
  width: number;
  height: number;
}

export interface PreviewCoordinateSpace {
  doc: Document;
  win: Window;
  root: HTMLElement;
  iframeRect: DOMRect;
  rootRect: DOMRect;
  viewport: PreviewViewportSize;
  scaleX: number;
  scaleY: number;
}

export interface PreviewPoint {
  x: number;
  y: number;
  viewport: PreviewViewportSize;
}

export function readPositiveDimension(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function resolvePreviewRoot(doc: Document): HTMLElement | null {
  return doc.querySelector<HTMLElement>("[data-composition-id]") ?? doc.documentElement ?? null;
}

export function resolvePreviewCoordinateSpace(
  iframe: HTMLIFrameElement,
): PreviewCoordinateSpace | null {
  let doc: Document | null = null;
  let win: Window | null = null;
  try {
    doc = iframe.contentDocument;
    win = iframe.contentWindow;
  } catch {
    return null;
  }
  if (!doc || !win) return null;

  const root = resolvePreviewRoot(doc);
  if (!root) return null;

  const iframeRect = iframe.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  const rootRectWidth = rootRect.width > 0 ? rootRect.width : null;
  const rootRectHeight = rootRect.height > 0 ? rootRect.height : null;
  const fallbackWidth = win.innerWidth > 0 ? win.innerWidth : null;
  const fallbackHeight = win.innerHeight > 0 ? win.innerHeight : null;
  const rootWidth =
    readPositiveDimension(root.getAttribute("data-width")) ?? rootRectWidth ?? fallbackWidth;
  const rootHeight =
    readPositiveDimension(root.getAttribute("data-height")) ?? rootRectHeight ?? fallbackHeight;
  if (!rootWidth || !rootHeight || !iframeRect.width || !iframeRect.height) return null;

  return {
    doc,
    win,
    root,
    iframeRect,
    rootRect,
    viewport: { width: rootWidth, height: rootHeight },
    scaleX: iframeRect.width / rootWidth,
    scaleY: iframeRect.height / rootHeight,
  };
}

export function previewPointFromClient(
  space: PreviewCoordinateSpace,
  clientX: number,
  clientY: number,
): PreviewPoint {
  return {
    x: (clientX - space.iframeRect.left) / space.scaleX,
    y: (clientY - space.iframeRect.top) / space.scaleY,
    viewport: space.viewport,
  };
}
