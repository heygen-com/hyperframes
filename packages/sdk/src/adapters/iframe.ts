/**
 * Same-origin iframe PreviewAdapter — WS-A1 (hit-test + selection) +
 * WS-A2 (applyDraft / commitPreview / cancelPreview → moveElement).
 *
 * Requirements:
 * - The iframe MUST be same-origin (srcdoc / blob URL). Cross-origin access to
 *   contentDocument throws a DOMException; this adapter does not guard that —
 *   the caller is responsible for ensuring same-origin.
 */

import type { PreviewAdapter, ElementAtPointResult, DraftProps } from "./types.js";
import type { EditOp } from "../types.js";

// ─── CSS var names written onto elements during drag ─────────────────────────

const VAR_DX = "--hf-studio-dx";
const VAR_DY = "--hf-studio-dy";

// ─── Pure resolver (testable without a browser) ───────────────────────────────

/**
 * Walk from `el` upward through parentElement, looking for the nearest node
 * that carries `[data-hf-id]` and is NOT `[data-hf-root]`.
 *
 * Returns null when:
 * - The walk exits the tree without finding `[data-hf-id]`
 * - The matching node is `[data-hf-root]` (transparent to hit-testing)
 * - `isVisible(node)` returns false for the matching node
 *
 * Keeping this a pure function (no elementFromPoint, no window access) makes
 * it unit-testable in a plain Node environment.
 */
export function resolveNearestHfElement(
  el: Element | null,
  isVisible: (el: Element) => boolean,
): ElementAtPointResult | null {
  let node = el;
  while (node !== null) {
    const id = node.getAttribute("data-hf-id");
    if (id !== null) {
      if (node.hasAttribute("data-hf-root")) return null;
      if (!isVisible(node)) return null;
      return { id, tag: node.tagName.toLowerCase() };
    }
    node = node.parentElement;
  }
  return null;
}

// ─── Draft position math (pure — testable without a browser) ─────────────────

/**
 * Compute the new absolute x/y for a moveElement op given:
 * - the element's current `data-x` / `data-y` string values (may be null)
 * - the accumulated drag delta (dx, dy) from applyDraft calls
 *
 * `data-x` / `data-y` default to 0 when absent or non-numeric.
 */
export function computeDraftPosition(
  dataX: string | null,
  dataY: string | null,
  dx: number,
  dy: number,
): { x: number; y: number } {
  const baseX = parseFloat(dataX ?? "0") || 0;
  const baseY = parseFloat(dataY ?? "0") || 0;
  return { x: baseX + dx, y: baseY + dy };
}

// ─── Visibility check ─────────────────────────────────────────────────────────

/**
 * Returns true when no element in the ancestor chain (inclusive) has
 * computed opacity === 0. Checks ancestors because a parent at opacity:0
 * makes the child invisible even if the child's own opacity is 1.
 *
 * This reflects the current GSAP timeline state (whatever the player has
 * seeked to). For atTime values matching the live playhead this is always
 * accurate. For speculative times this is NOT seeked — WS-A1 does not mutate
 * the timeline; accurate out-of-band opacity queries are WS-G follow-on.
 */
function isOpacityVisible(el: Element, win: Window & typeof globalThis): boolean {
  let node: Element | null = el;
  while (node !== null) {
    const style = win.getComputedStyle(node);
    if (parseFloat(style.opacity) === 0) return false;
    node = node.parentElement;
  }
  return true;
}

// ─── IframePreviewAdapter ─────────────────────────────────────────────────────

type SelectionHandler = (ids: string[]) => void;

class IframePreviewAdapter implements PreviewAdapter {
  private readonly iframe: HTMLIFrameElement;
  private readonly _dispatch: ((op: EditOp) => void) | undefined;

  private _selection: string[] = [];
  private _handlers: SelectionHandler[] = [];

  /** Tracked id and element for the in-progress drag. */
  private _draftId: string | null = null;
  private _draftEl: HTMLElement | null = null;

  constructor(iframe: HTMLIFrameElement, dispatch?: (op: EditOp) => void) {
    this.iframe = iframe;
    this._dispatch = dispatch;
  }

  /**
   * Synchronous hit-test. Returns the nearest `[data-hf-id]` element under
   * (x, y) in the iframe's coordinate space, or null for a transparent hit
   * (root, opacity-0, or nothing at all).
   *
   * atTime: reflects the GSAP state at the playhead when this is called.
   * Seeking to a different time to check visibility is WS-G scope.
   */
  elementAtPoint(x: number, y: number, _opts?: { atTime?: number }): ElementAtPointResult | null {
    const doc = this.iframe.contentDocument;
    if (!doc) return null;
    const win = this.iframe.contentWindow as (Window & typeof globalThis) | null;
    if (!win) return null;

    const hit = doc.elementFromPoint(x, y);
    return resolveNearestHfElement(hit, (el) => isOpacityVisible(el, win));
  }

  /**
   * Write draft CSS custom properties (`--hf-studio-dx`, `--hf-studio-dy`) onto
   * the target element inside the iframe at 60fps. The composition's CSS uses
   * these vars to visually translate the element without touching the model.
   *
   * Calling applyDraft with a new id replaces the tracked element (does not
   * cancel the prior draft — call cancelPreview first if switching targets).
   *
   * width/height in DraftProps are not yet wired (resize → setStyle, future op).
   */
  applyDraft(id: string, props: DraftProps): void {
    const doc = this.iframe.contentDocument;
    if (!doc) return;

    // Reuse the tracked element across the 60fps drag; only re-query when the id
    // changes or the cached node detached (e.g. an iframe reload mid-drag).
    const cached = id === this._draftId && this._draftEl?.isConnected ? this._draftEl : null;
    const el =
      cached ??
      doc.querySelector<HTMLElement>(
        `[data-hf-id="${id.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`,
      );
    if (!el) return;

    this._draftId = id;
    this._draftEl = el;

    if (props.dx !== undefined) el.style.setProperty(VAR_DX, String(props.dx));
    if (props.dy !== undefined) el.style.setProperty(VAR_DY, String(props.dy));
  }

  /**
   * Read the accumulated draft deltas, derive a moveElement op, dispatch it,
   * then clear the CSS vars and draft state.
   *
   * No-ops when:
   * - No applyDraft was called (nothing to commit)
   * - No dispatch callback was provided at construction
   */
  commitPreview(): void {
    if (!this._draftId || !this._draftEl || !this._dispatch) {
      this._clearDraft();
      return;
    }

    const el = this._draftEl;
    const dx = parseFloat(el.style.getPropertyValue(VAR_DX) || "0") || 0;
    const dy = parseFloat(el.style.getPropertyValue(VAR_DY) || "0") || 0;
    const dataX = el.getAttribute("data-x");
    const dataY = el.getAttribute("data-y");
    const { x, y } = computeDraftPosition(dataX, dataY, dx, dy);

    this._dispatch({ type: "moveElement", target: this._draftId, x, y });
    this._clearDraft();
  }

  /** Revert draft CSS vars without dispatching any op. */
  cancelPreview(): void {
    this._clearDraft();
  }

  private _clearDraft(): void {
    if (this._draftEl) {
      this._draftEl.style.removeProperty(VAR_DX);
      this._draftEl.style.removeProperty(VAR_DY);
    }
    this._draftId = null;
    this._draftEl = null;
  }

  // Selection -----------------------------------------------------------------

  select(ids: string[], opts?: { additive?: boolean }): void {
    if (opts?.additive) {
      const merged = new Set([...this._selection, ...ids]);
      this._selection = [...merged];
    } else {
      this._selection = [...ids];
    }
    this._emit();
  }

  on(event: "selection", handler: SelectionHandler): () => void {
    if (event !== "selection") return () => {};
    this._handlers.push(handler);
    return () => {
      this._handlers = this._handlers.filter((h) => h !== handler);
    };
  }

  private _emit(): void {
    const ids = [...this._selection];
    for (const h of this._handlers) h(ids);
  }
}

export function createIframePreviewAdapter(
  iframe: HTMLIFrameElement,
  dispatch?: (op: EditOp) => void,
): PreviewAdapter {
  return new IframePreviewAdapter(iframe, dispatch);
}
