import type { PreviewAdapter, ElementAtPointResult, DraftProps } from "./types.js";

/** Null PreviewAdapter for headless use (agents, CI, server-side rendering). */
class HeadlessPreviewAdapter implements PreviewAdapter {
  elementAtPoint(_x: number, _y: number, _opts?: { atTime?: number }): ElementAtPointResult | null {
    return null;
  }

  applyDraft(_id: string, _props: DraftProps): void {}

  commitPreview(): void {}

  cancelPreview(): void {}

  select(_ids: string[], _opts?: { additive?: boolean }): void {}

  on(_event: "selection", _handler: (ids: string[]) => void): () => void {
    return () => {};
  }
}

export function createHeadlessAdapter(): PreviewAdapter {
  return new HeadlessPreviewAdapter();
}
