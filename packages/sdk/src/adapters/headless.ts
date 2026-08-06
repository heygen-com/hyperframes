import type {
  PreviewAdapter,
  ElementAtPointResult,
  DraftProps,
  PaintQueryOptions,
} from "./types.js";
import type { Composition } from "../types.js";

/** Null PreviewAdapter for headless use (agents, CI, server-side rendering). */
class HeadlessPreviewAdapter implements PreviewAdapter {
  elementAtPoint(_x: number, _y: number, _opts?: { atTime?: number }): ElementAtPointResult | null {
    return null;
  }

  /**
   * Never provably empty: an adapter with no surface cannot establish that a point is
   * free of ink, and claiming otherwise would tell a host it is safe to click through a
   * composition nobody can see.
   */
  isProvablyEmptyAt(_x: number, _y: number, _opts?: PaintQueryOptions): boolean {
    return false;
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
