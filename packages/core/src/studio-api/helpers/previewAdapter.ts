/**
 * PreviewAdapter — stub for R7 (Task 3 implements this).
 * Exports the typed API contract so tests can import and fail on assertions
 * rather than module resolution.
 */

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

export function createPreviewAdapter(
  _document: Document,
  _opts?: { resolvePoint?: (x: number, y: number) => Element | null },
): PreviewAdapter {
  throw new Error("not implemented — Task 3");
}
