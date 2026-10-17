/**
 * Runs in the checked page before its scripts: records each WebGL canvas for the layout audit and
 * keeps its drawing buffer, so the audit can still read the frame after Chrome presents it.
 */
export function registerWebglCanvases(): void {
  const getContext = HTMLCanvasElement.prototype.getContext;
  const canvases = new Map<HTMLCanvasElement, WebGLRenderingContext | WebGL2RenderingContext>();
  Object.defineProperty(window, "__hfWebglCanvases", { value: canvases });
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    type: string,
    attributes?: Record<string, unknown>,
  ) {
    const webgl = type === "webgl" || type === "webgl2" || type === "experimental-webgl";
    const options = webgl ? { ...attributes, preserveDrawingBuffer: true } : attributes;
    const context = Reflect.apply(getContext, this, [type, options]);
    if (webgl && context) canvases.set(this, context);
    return context;
  } as typeof getContext;
}
