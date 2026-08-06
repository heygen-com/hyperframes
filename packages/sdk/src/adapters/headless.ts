import type { PreviewAdapter, ElementAtPointResult, DraftProps, PaintsAtOptions } from "./types.js";
import type { Composition } from "../types.js";

/** Null PreviewAdapter for headless use (agents, CI, server-side rendering). */
class HeadlessPreviewAdapter implements PreviewAdapter {
  elementAtPoint(_x: number, _y: number, _opts?: { atTime?: number }): ElementAtPointResult | null {
    return null;
  }

  /**
   * null, not false — the same value means different things on the two queries. For
   * elementAtPoint null is "nothing there"; for paintsAt it is "not knowable", which
   * is the honest answer from an adapter with no surface. Callers read it as painted.
   */
  paintsAt(_x: number, _y: number, _opts?: PaintsAtOptions): boolean | null {
    return null;
  }

  applyDraft(_id: string, _props: DraftProps): void {}

  commitPreview(): void {}

  cancelPreview(): void {}

  select(_ids: string[], _opts?: { additive?: boolean }): void {}

  on(_event: "selection", _handler: (ids: string[]) => void): () => void {
    return () => {};
  }

  attachSync(_comp: Composition): () => void {
    return () => {};
  }
}

export function createHeadlessAdapter(): PreviewAdapter {
  return new HeadlessPreviewAdapter();
}
