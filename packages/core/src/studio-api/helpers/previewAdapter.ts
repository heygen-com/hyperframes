import {
  STUDIO_OFFSET_X_PROP,
  STUDIO_OFFSET_Y_PROP,
  STUDIO_WIDTH_PROP,
  STUDIO_HEIGHT_PROP,
  STUDIO_MANUAL_EDIT_GESTURE_ATTR,
} from "./draftMarkers.js";

export type DraftPayload =
  | { type: "move"; hfId: string; dx: number; dy: number }
  | { type: "resize"; hfId: string; w: number; h: number };

export type CommitPatch =
  | { type: "moveElement"; hfId: string; dx: number; dy: number }
  | { type: "resize"; hfId: string; width: number; height: number };

export interface PreviewAdapter {
  /**
   * @param atTime - Caller hint only. The adapter reads current computed styles;
   *   the caller must seek the GSAP timeline to `atTime` before invoking so that
   *   GSAP-driven inline styles reflect the desired playhead position.
   */
  elementAtPoint(x: number, y: number, opts?: { atTime?: number }): Element | null;
  applyDraft(payload: DraftPayload): void;
  revertDraft(): void;
  commitPreview(): CommitPatch | null;
  getElementTimings(): Record<string, { start?: number; end?: number }>;
}

interface GestureState {
  payload: DraftPayload;
  originalTranslate: string | undefined;
}

export function createPreviewAdapter(
  doc: Document,
  opts?: { resolvePoint?: (x: number, y: number) => Element | null },
): PreviewAdapter {
  let gesture: GestureState | null = null;

  function findById(hfId: string): HTMLElement | null {
    // CSS.escape is available in browsers; hf-ids are always hf-[a-z0-9]+ so
    // no escaping is strictly needed, but be safe in non-browser environments.
    const escaped =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(hfId)
        : hfId.replace(/([^\w-])/g, "\\$1");
    return doc.querySelector(`[data-hf-id="${escaped}"]`) as HTMLElement | null;
  }

  function isVisible(el: Element): boolean {
    const view = doc.defaultView;
    if (!view) return true;
    const style = view.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const op = parseFloat(style.opacity);
    // NaN (empty string from environments with no CSS cascade) → treat as visible.
    // 0.01 threshold: sub-1% opacity is not user-targetable in drag gestures.
    return Number.isNaN(op) || op >= 0.01;
  }

  function clearDraftProps(target: HTMLElement): void {
    target.style.removeProperty(STUDIO_OFFSET_X_PROP);
    target.style.removeProperty(STUDIO_OFFSET_Y_PROP);
    target.style.removeProperty(STUDIO_WIDTH_PROP);
    target.style.removeProperty(STUDIO_HEIGHT_PROP);
    target.removeAttribute(STUDIO_MANUAL_EDIT_GESTURE_ATTR);
  }

  function revertGesture(target: HTMLElement, state: GestureState): void {
    clearDraftProps(target);
    if (state.originalTranslate !== undefined) {
      target.style.setProperty("translate", state.originalTranslate);
    }
  }

  return {
    elementAtPoint(x, y, _perCallOpts) {
      const hit = opts?.resolvePoint?.(x, y) ?? null;
      if (!hit) return null;

      let el: Element | null = hit;
      while (el && el !== doc.body) {
        if (el.hasAttribute("data-hf-id")) {
          return isVisible(el) ? (el as HTMLElement) : null;
        }
        // data-hf-root without data-hf-id = outermost stage root — stop
        if (el.hasAttribute("data-hf-root")) return null;
        el = el.parentElement;
      }
      return null;
    },

    applyDraft(payload) {
      // Auto-revert any in-flight gesture before starting a new one so no
      // element is left with orphaned draft CSS props or the gesture marker.
      if (gesture) {
        const prev = findById(gesture.payload.hfId);
        if (prev) revertGesture(prev, gesture);
        gesture = null;
      }

      const target = findById(payload.hfId);
      if (!target) return;

      const originalTranslate = target.style.getPropertyValue("translate") || undefined;
      gesture = { payload, originalTranslate };
      target.setAttribute(STUDIO_MANUAL_EDIT_GESTURE_ATTR, "true");

      if (payload.type === "move") {
        target.style.setProperty(STUDIO_OFFSET_X_PROP, `${payload.dx}px`);
        target.style.setProperty(STUDIO_OFFSET_Y_PROP, `${payload.dy}px`);
      } else {
        target.style.setProperty(STUDIO_WIDTH_PROP, `${payload.w}px`);
        target.style.setProperty(STUDIO_HEIGHT_PROP, `${payload.h}px`);
      }
    },

    revertDraft() {
      if (!gesture) return;
      const target = findById(gesture.payload.hfId);
      if (target) revertGesture(target, gesture);
      gesture = null;
    },

    commitPreview() {
      if (!gesture) return null;
      const { payload } = gesture;

      const target = findById(payload.hfId);
      if (target) clearDraftProps(target);
      gesture = null;

      if (payload.type === "move") {
        return { type: "moveElement", hfId: payload.hfId, dx: payload.dx, dy: payload.dy };
      }
      return { type: "resize", hfId: payload.hfId, width: payload.w, height: payload.h };
    },

    getElementTimings() {
      const result: Record<string, { start?: number; end?: number }> = {};
      for (const el of doc.querySelectorAll("[data-hf-id]")) {
        const hfId = el.getAttribute("data-hf-id");
        if (!hfId) continue;
        const s = el.getAttribute("data-start");
        const e = el.getAttribute("data-end");
        const sv = s !== null ? parseFloat(s) : NaN;
        const ev = e !== null ? parseFloat(e) : NaN;
        result[hfId] = {
          start: Number.isFinite(sv) ? sv : undefined,
          end: Number.isFinite(ev) ? ev : undefined,
        };
      }
      return result;
    },
  };
}
