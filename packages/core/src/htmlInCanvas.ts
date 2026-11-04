/** Chrome <=155 marks a capture canvas with `layoutsubtree`; 157+ with `content="drawable"` and `drawable` on each captured child. */
export type HtmlInCanvasForm = "layoutsubtree" | "drawable";

export const CAPTURE_CANVAS_SELECTOR = 'canvas[layoutsubtree], canvas[content="drawable"]';

/** The form this browser's html-in-canvas takes, or null when it has no usable one. */
export function htmlInCanvasForm(win: Window = window): HtmlInCanvasForm | null {
  const ctx = (win as Window & { CanvasRenderingContext2D?: { prototype: object } })
    .CanvasRenderingContext2D?.prototype;
  if (!ctx || !("drawElementImage" in ctx)) return null;
  const canvas = win.document.createElement("canvas");
  if (!("requestPaint" in canvas)) return null;
  // 155 already has updateElementGeometry but still wants layoutsubtree, so this order matters.
  if ("layoutSubtree" in canvas) return "layoutsubtree";
  return "updateElementGeometry" in canvas ? "drawable" : null;
}

export function markCaptureCanvas(canvas: HTMLCanvasElement, form: HtmlInCanvasForm): void {
  if (form === "layoutsubtree") canvas.setAttribute("layoutsubtree", "");
  else canvas.setAttribute("content", "drawable");
}

export function markCaptured(el: Element, form: HtmlInCanvasForm): void {
  if (form === "drawable") el.setAttribute("drawable", "");
}

export function unmarkCaptured(el: Element, form: HtmlInCanvasForm): void {
  if (form === "drawable") el.removeAttribute("drawable");
}
