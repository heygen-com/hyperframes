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

/** Releases the WebGL context of every canvas in a hidden clip (data-hf-clip-hidden) that has ended by `time`. */
export async function releaseEndedWebglContexts(page: Page, time: number): Promise<number> {
  return page.evaluate((t: number) => {
    const clipsAround = (el: Element): Element[] => {
      const clips: Element[] = [];
      for (let up: Element | null = el; up; up = up.parentElement) {
        if (up.getAttribute("data-start") !== null) clips.unshift(up);
      }
      return clips;
    };
    const hasEnded = (el: Element): boolean => {
      let offset = 0;
      return clipsAround(el).some((clip) => {
        offset += Number(clip.getAttribute("data-start")) || 0;
        const length =
          clip.getAttribute("data-duration") ?? clip.getAttribute("data-hf-authored-duration");
        return (
          length !== null &&
          clip.hasAttribute("data-hf-clip-hidden") &&
          offset + Number(length) <= t
        );
      });
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
