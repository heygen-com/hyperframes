export type DraftPayload =
  | { type: "move"; hfId: string; dx: number; dy: number }
  | { type: "resize"; hfId: string; w: number; h: number };

export type CommitPatch =
  | { type: "moveElement"; hfId: string; dx: number; dy: number }
  | { type: "resize"; hfId: string; width: number; height: number };

export interface PreviewAdapter {
  elementAtPoint(x: number, y: number, opts?: { atTime?: number }): Element | null;
  applyDraft(payload: DraftPayload): void;
  revertDraft(): void;
  commitPreview(): CommitPatch | null;
  getElementTimings(): Record<string, { start?: number; end?: number }>;
}

interface GestureState {
  hfId: string;
  payload: DraftPayload;
  originalTranslate: string | undefined;
}

export function createPreviewAdapter(
  doc: Document,
  opts?: { resolvePoint?: (x: number, y: number) => Element | null },
): PreviewAdapter {
  let gesture: GestureState | null = null;

  function findById(hfId: string): HTMLElement | null {
    return doc.querySelector(`[data-hf-id="${hfId}"]`) as HTMLElement | null;
  }

  function opacity(el: Element): number {
    const view = doc.defaultView;
    if (!view) return 1;
    return parseFloat(view.getComputedStyle(el).opacity) || 0;
  }

  return {
    elementAtPoint(x, y, _opts) {
      const hit = opts?.resolvePoint?.(x, y) ?? null;
      if (!hit) return null;

      let el: Element | null = hit;
      while (el && el !== doc.body) {
        if (el.hasAttribute("data-hf-id")) {
          return opacity(el) === 0 ? null : (el as HTMLElement);
        }
        // data-hf-root without data-hf-id = outermost stage root — stop
        if (el.hasAttribute("data-hf-root")) return null;
        el = el.parentElement;
      }
      return null;
    },

    applyDraft(payload) {
      const target = findById(payload.hfId);
      if (!target) return;

      const originalTranslate = target.style.getPropertyValue("translate") || undefined;
      gesture = { hfId: payload.hfId, payload, originalTranslate };
      target.setAttribute("data-hf-studio-manual-edit-gesture", "true");

      if (payload.type === "move") {
        target.style.setProperty("--hf-studio-offset-x", `${payload.dx}px`);
        target.style.setProperty("--hf-studio-offset-y", `${payload.dy}px`);
      } else {
        target.style.setProperty("--hf-studio-width", `${payload.w}px`);
        target.style.setProperty("--hf-studio-height", `${payload.h}px`);
      }
    },

    revertDraft() {
      if (!gesture) return;
      const target = findById(gesture.hfId);
      if (target) {
        target.style.removeProperty("--hf-studio-offset-x");
        target.style.removeProperty("--hf-studio-offset-y");
        target.style.removeProperty("--hf-studio-width");
        target.style.removeProperty("--hf-studio-height");
        target.removeAttribute("data-hf-studio-manual-edit-gesture");
        if (gesture.originalTranslate !== undefined) {
          target.style.setProperty("translate", gesture.originalTranslate);
        }
      }
      gesture = null;
    },

    commitPreview() {
      if (!gesture) return null;
      const { hfId, payload } = gesture;

      const target = findById(hfId);
      if (target) {
        target.removeAttribute("data-hf-studio-manual-edit-gesture");
      }
      gesture = null;

      if (payload.type === "move") {
        return { type: "moveElement", hfId, dx: payload.dx, dy: payload.dy };
      }
      return { type: "resize", hfId, width: payload.w, height: payload.h };
    },

    getElementTimings() {
      const result: Record<string, { start?: number; end?: number }> = {};
      for (const el of Array.from(doc.querySelectorAll("[data-hf-id]"))) {
        const hfId = el.getAttribute("data-hf-id");
        if (!hfId) continue;
        const s = el.getAttribute("data-start");
        const e = el.getAttribute("data-end");
        result[hfId] = {
          start: s !== null ? parseFloat(s) : undefined,
          end: e !== null ? parseFloat(e) : undefined,
        };
      }
      return result;
    },
  };
}
