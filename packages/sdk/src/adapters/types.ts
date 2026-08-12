import type { PersistErrorEvent, Composition } from "../types.js";

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

export interface PaintQueryOptions {
  /**
   * A hit whose smallest painting box covers at least this fraction of the composition
   * frame reads as background rather than ink. 0 (the default) counts every painting box.
   *
   * Host policy, not a fact about the composition: an editor that treats "you clicked a
   * full-bleed layer" as "you clicked nothing" wants ~0.9, while a caller asking the
   * literal ink question wants 0.
   */
  fullBleedFraction?: number;

  /**
   * Consider only model-addressable elements (`[data-hf-id]`). Default true.
   *
   * False widens the walk to every element, which catches nodes created after the
   * document was stamped (split-text word spans, cloned nodes) at the cost of a larger
   * candidate set.
   */
  addressableOnly?: boolean;
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

  /**
   * Is (x, y) provably free of ink — is it safe to let a click pass through to whatever
   * sits beneath this composition? Same coordinate space as `elementAtPoint`.
   *
   * The question a host layering a transparent composition over other content has to
   * answer before it swallows a click: is the user pointing AT something, or through an
   * empty gap at whatever sits beneath? Geometry alone cannot tell — a composition is
   * mostly full-bleed wrapper `<div>`s with no visual presence, and those boxes cover
   * every pixel of the frame.
   *
   * True ONLY when the composition was readable and nothing painted there. Everything
   * else is false: ink present, a document still loading or unreadable, or an adapter
   * that does not implement this at all (`preview.isProvablyEmptyAt?.(x, y)` → undefined
   * → falsy). The polarity is the point — it puts the burden of proof on passing the
   * click through, so every way of failing keeps the composition clickable instead of
   * making it vanish from under the cursor. A "does it paint" reading would leave two of
   * those three bottom values doing the dangerous thing.
   *
   * Deliberately not derived from `elementsFromPoint`, which omits `pointer-events: none`
   * nodes — those still paint, and reporting no ink over visible artwork is exactly the
   * failure this polarity exists to prevent.
   */
  isProvablyEmptyAt?(x: number, y: number, opts?: PaintQueryOptions): boolean;

  /** Apply draft CSS markers to the preview element (60fps, SDK not involved) */
  applyDraft(id: string, props: DraftProps): void;

  /** Derive op from draft markers, dispatch it, emit patch event, clear markers */
  commitPreview(): void;

  /** Revert draft markers without committing. Model never changed. */
  cancelPreview(): void;

  /** Set preview selection; fires selectionchange on the session */
  select(ids: string[], opts?: { additive?: boolean }): void;

  // Stage 8 prep: fired when the preview host changes selection (e.g. user clicks an element).
  // Not wired up in stage 7 — callers listen to the session's own selectionchange event instead.
  on(event: "selection", handler: (ids: string[]) => void): () => void;

  /**
   * Mirror this composition's edits onto the adapter's own live document —
   * an immediate full sync of the composition's CURRENT overrides, then a
   * subscription that replays every future patch (including undo/redo).
   * `/script/gsap` patches are never mirrored (re-executing a live <script>
   * tag doesn't work and would conflict with running GSAP state).
   * Calling this again while already attached detaches the previous
   * subscription first. Returns an unsubscribe.
   */
  attachSync(comp: Composition): () => void;

  /**
   * Optional: apply composition-variable values to the preview so it renders
   * as `window.__hfVariables` injection would at render time (values must be
   * visible to the runtime BEFORE composition scripts run — typically a
   * preview reload with injection, not a live poke). Pass null to restore
   * declared defaults. Values are ephemeral preview state, never persisted.
   */
  setPreviewVariables?(values: Record<string, unknown> | null): void;
}
