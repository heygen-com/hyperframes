import type { PersistErrorEvent } from "../types.js";

// ─── PersistAdapter ───────────────────────────────────────────────────────────

export interface PersistVersionEntry {
  /** Opaque key identifying this version (adapter-defined format) */
  key: string;
  /** Full HTML content — may be omitted by adapters that load content lazily via loadFrom() */
  content?: string;
  timestamp?: number;
}

/**
 * Injectable storage adapter — decouples the SDK from the underlying persistence mechanism.
 * Implementations: memory (tests/demos), fs (local dev), S3 (cloud), HTTP (Pacific).
 *
 * Contract:
 * - read() returns undefined for a path never written
 * - write() is idempotent (second write overwrites)
 * - flush() resolves when any queued writes are committed
 * - listVersions() returns entries newest-first
 * - loadFrom() returns content for the given version key (undefined if not found)
 * - on('persist:error') fires when a write fails; the error must not propagate as a thrown exception
 */
export interface PersistAdapter {
  read(path: string): Promise<string | undefined>;
  write(path: string, content: string): Promise<void>;
  /** Force all pending writes to commit before returning */
  flush(): Promise<void>;
  listVersions(path: string): Promise<PersistVersionEntry[]>;
  loadFrom(path: string, versionKey: string): Promise<string | undefined>;
  on(event: "persist:error", handler: (event: PersistErrorEvent) => void): () => void;
}

// ─── PreviewAdapter ───────────────────────────────────────────────────────────

export interface ElementAtPointResult {
  id: string;
  tag: string;
}

export interface DraftProps {
  dx?: number;
  dy?: number;
  width?: number;
  height?: number;
}

/**
 * Injectable preview adapter — decouples the SDK from the host preview surface.
 * The null/headless adapter stubs all methods (no browser needed).
 *
 * The SDK is NOT in the 60fps draft loop — consumers call applyDraft() directly on
 * the preview at 60fps; commitPreview() fires once on pointer-up to derive and
 * dispatch the resulting op.
 */
export interface PreviewAdapter {
  /** Sync hit-test at composition coordinates. Requires same-origin iframe. */
  elementAtPoint(x: number, y: number, opts?: { atTime?: number }): ElementAtPointResult | null;

  /** Apply draft CSS markers to the preview element (60fps, SDK not involved) */
  applyDraft(id: string, props: DraftProps): void;

  /** Derive op from draft markers, dispatch it, emit patch event, clear markers */
  commitPreview(): void;

  /** Revert draft markers without committing. Model never changed. */
  cancelPreview(): void;

  /** Set preview selection; fires selectionchange on the session */
  select(ids: string[], opts?: { additive?: boolean }): void;

  on(event: "selection", handler: (ids: string[]) => void): () => void;
}
