import type { Page } from "puppeteer-core";

type RecordedContext = { canvas: HTMLCanvasElement; ctx: WebGLRenderingContext; lost?: boolean };
type GlWindow = Window & { __hf_gl_contexts?: RecordedContext[] };

/** Records each WebGL context a page creates. Register with page.evaluateOnNewDocument before navigation. */
export function recordWebglContexts(): void {
  const w = window as GlWindow;
  w.__hf_gl_contexts = [];
  const canvasProto = HTMLCanvasElement.prototype as unknown as {
    getContext: (
      this: HTMLCanvasElement,
      type: string,
      attrs?: unknown,
    ) => WebGLRenderingContext | null;
  };
  const orig = canvasProto.getContext;
  canvasProto.getContext = function (type, attrs) {
    const ctx = orig.call(this, type, attrs);
    if (ctx && (type === "webgl" || type === "webgl2" || type === "experimental-webgl")) {
      const list = w.__hf_gl_contexts ?? [];
      if (!list.some((r) => r.ctx === ctx)) list.push({ canvas: this, ctx });
      w.__hf_gl_contexts = list;
    }
    return ctx;
  };
}

/** Releases the WebGL context of each canvas in a hidden clip whose runtime-resolved window ended by `time`. */
export async function releaseEndedWebglContexts(page: Page, time: number): Promise<number> {
  return page.evaluate((t: number) => {
    const clipWindow = window.__hf?.clipWindow;
    if (!clipWindow) return 0;
    const hasEnded = (el: Element): boolean => {
      for (let up: Element | null = el; up; up = up.parentElement) {
        const span = up.hasAttribute("data-hf-clip-hidden") ? clipWindow(up) : null;
        if (span && Number.isFinite(span.end) && span.end <= t) return true;
      }
      return false;
    };
    const live = ((window as GlWindow).__hf_gl_contexts ?? []).filter(
      (r) => !r.lost && hasEnded(r.canvas),
    );
    for (const rec of live) {
      rec.lost = true;
      rec.ctx.getExtension("WEBGL_lose_context")?.loseContext();
    }
    return live.length;
  }, time);
}
