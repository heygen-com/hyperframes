/**
 * Phase 3a — real editing session.
 *
 * CompositionImpl: live linkedom document, real dispatch, RFC 6902 patch emission,
 * override-set accumulation, batch, can(), serialize(), applyPatches().
 *
 * openComposition() wires history + persist queue for standalone (T1/T2) mode.
 * T3 (embedded) callers supply overrides; SDK emits patches only — host owns state.
 */

import type {
  CanResult,
  Composition,
  EditOp,
  ElementSnapshot,
  FindQuery,
  GsapTweenSpec,
  HfId,
  JsonPatchOp,
  OverrideSet,
  PatchEvent,
  PersistErrorEvent,
  SelectionProxy,
  ElementHandle,
} from "./types.js";
import { ORIGIN_APPLY_PATCHES, ORIGIN_LOCAL } from "./types.js";
import { buildRoots, flatElements } from "./document.js";
import type { PersistAdapter, PreviewAdapter } from "./adapters/types.js";
import { parseMutable } from "./engine/model.js";
import type { ParsedDocument } from "./engine/model.js";
import { applyOp, validateOp, type MutationResult } from "./engine/mutate.js";
import { serializeDocument } from "./engine/serialize.js";
import { applyPatchesToDocument, applyOverrideSet } from "./engine/apply-patches.js";
import { buildPatchEvent, pathToKey } from "./engine/patches.js";
import { createHistory } from "./history.js";
import type { HistoryModule } from "./history.js";
import { createPersistQueue } from "./persist-queue.js";
import type { PersistQueueModule } from "./persist-queue.js";

export interface OpenCompositionOptions {
  persist?: PersistAdapter;
  preview?: PreviewAdapter;
  /** T3 embedded mode: override-set applied on top of the base template. */
  overrides?: OverrideSet;
  /** Origins whose mutations enter the undo stack. Default: all non-applyPatches. */
  trackedOrigins?: unknown[];
  /** Auto-coalesce window for history entries (ms). Default: 300. */
  coalesceMs?: number;
}

// ─── Implementation ───────────────────────────────────────────────────────────

class CompositionImpl implements Composition {
  private readonly parsed: ParsedDocument;
  private readonly persist: PersistAdapter | undefined;
  readonly preview: PreviewAdapter | undefined;

  /** Accumulated override-set — T3 embedded mode fold contract. */
  private overrides: OverrideSet;

  /** Lazily-built element snapshot, invalidated on every mutation. */
  private elementsCache: ElementSnapshot[] | null = null;

  private currentSelection: string[] = [];

  private changeHandlers: Array<() => void> = [];
  private selectionHandlers: Array<(ids: string[]) => void> = [];
  private patchHandlers: Array<(e: PatchEvent) => void> = [];
  private errorHandlers: Array<(e: PersistErrorEvent) => void> = [];
  private previewSelectionUnsubscribe: (() => void) | null = null;

  /** Attached by openComposition() for standalone mode. */
  private historyModule: HistoryModule | null = null;
  private persistQueueModule: PersistQueueModule | null = null;

  /** Batching state: accumulates patches from multiple dispatches. */
  private batchDepth = 0;
  private batchForward: JsonPatchOp[] = [];
  private batchInverse: JsonPatchOp[] = [];
  private batchOpTypes: string[] = [];
  private batchOrigin: unknown = ORIGIN_LOCAL;
  /** Override-set state at outermost batch entry — restored if the batch throws. */
  private batchOverridesSnapshot: OverrideSet = {};

  constructor(parsed: ParsedDocument, opts: OpenCompositionOptions) {
    this.parsed = parsed;
    this.persist = opts.persist;
    this.preview = opts.preview;
    this.overrides = { ...(opts.overrides ?? {}) };
    this.previewSelectionUnsubscribe =
      this.preview?.on("selection", (ids) => this.updateSelection(ids)) ?? null;
  }

  attachHistory(module: HistoryModule): void {
    this.historyModule = module;
  }

  attachPersistQueue(module: PersistQueueModule): void {
    this.persistQueueModule = module;
  }

  _fireError(e: PersistErrorEvent): void {
    this.errorHandlers.forEach((h) => h(e));
  }

  // ── Typed methods (F10 layer 1) ─────────────────────────────────────────────

  setStyle(id: HfId, styles: Record<string, string | null>): void {
    this.dispatch({ type: "setStyle", target: id, styles });
  }

  setText(id: HfId, value: string): void {
    this.dispatch({ type: "setText", target: id, value });
  }

  setAttribute(id: HfId, name: string, value: string | null): void {
    this.dispatch({ type: "setAttribute", target: id, name, value });
  }

  setTiming(id: HfId, timing: { start?: number; duration?: number; trackIndex?: number }): void {
    this.dispatch({ type: "setTiming", target: id, ...timing });
  }

  removeElement(id: HfId): void {
    this.dispatch({ type: "removeElement", target: id });
  }

  setVariableValue(id: string, value: string | number | boolean): void {
    this.dispatch({ type: "setVariableValue", id, value });
  }

  addGsapTween(target: HfId, tween: GsapTweenSpec): string {
    const result = this._dispatch({ type: "addGsapTween", target, tween }, ORIGIN_LOCAL);
    return result.meta?.animationId ?? "";
  }

  setGsapTween(animationId: string, properties: Partial<GsapTweenSpec>): void {
    this.dispatch({ type: "setGsapTween", animationId, properties });
  }

  removeGsapTween(animationId: string): void {
    this.dispatch({ type: "removeGsapTween", animationId });
  }

  undo(): void {
    this.historyModule?.undo();
  }

  redo(): void {
    this.historyModule?.redo();
  }

  canUndo(): boolean {
    return this.historyModule?.canUndo() ?? false;
  }

  canRedo(): boolean {
    return this.historyModule?.canRedo() ?? false;
  }

  // ── Query API (F1) ───────────────────────────────────────────────────────────

  getElements(): ElementSnapshot[] {
    // Walk the live linkedom DOM directly — no serialize/re-parse round trip.
    this.elementsCache ??= flatElements(buildRoots(this.parsed.document));
    return [...this.elementsCache];
  }

  getElement(id: HfId): ElementSnapshot | null {
    // Accept both bare ids (top-level) and scoped ids (sub-composition elements).
    // Match by scopedId first (canonical); bare-id fallback keeps top-level compat
    // for callers that don't yet use scoped ids.
    return (
      this.getElements().find((el) => el.scopedId === id) ??
      this.getElements().find((el) => el.id === id && el.scopedId === el.id) ??
      null
    );
  }

  find(query: FindQuery): string[] {
    return (
      this.getElements()
        // fallow-ignore-next-line complexity
        .filter((el) => {
          if (query.tag && el.tag !== query.tag) return false;
          if (query.text && !el.text?.includes(query.text)) return false;
          if (query.name && el.attributes["data-name"] !== query.name) return false;
          if (query.track !== undefined && el.trackIndex !== query.track) return false;
          if (query.composition && !el.scopedId.startsWith(`${query.composition}/`)) return false;
          return true;
        })
        .map((el) => el.scopedId)
    );
  }

  // ── Selection API ────────────────────────────────────────────────────────────

  selection(): SelectionProxy {
    const ids = [...this.currentSelection];
    return {
      ids,
      setStyle: (styles) => this.dispatch({ type: "setStyle", target: ids, styles }),
      setText: (value) => this.dispatch({ type: "setText", target: ids, value }),
      setAttribute: (name, value) =>
        this.dispatch({ type: "setAttribute", target: ids, name, value }),
      setTiming: (timing) => this.dispatch({ type: "setTiming", target: ids, ...timing }),
      removeElement: () => this.dispatch({ type: "removeElement", target: ids }),
    };
  }

  element(id: HfId): ElementHandle {
    return {
      id,
      setStyle: (styles) => this.dispatch({ type: "setStyle", target: id, styles }),
      setText: (value) => this.dispatch({ type: "setText", target: id, value }),
      setAttribute: (name, value) =>
        this.dispatch({ type: "setAttribute", target: id, name, value }),
      setTiming: (timing) => this.dispatch({ type: "setTiming", target: id, ...timing }),
      removeElement: () => this.dispatch({ type: "removeElement", target: id }),
    };
  }

  getSelection(): string[] {
    return [...this.currentSelection];
  }

  setSelection(ids: string[]): void {
    const deduped = Array.from(new Set(ids));
    if (
      deduped.length === this.currentSelection.length &&
      deduped.every((id, i) => id === this.currentSelection[i])
    ) {
      return;
    }
    this.updateSelection(deduped);
  }

  private updateSelection(ids: readonly string[]): void {
    this.currentSelection = [...ids];
    for (const handler of this.selectionHandlers) {
      handler([...this.currentSelection]);
    }
  }

  // ── Dispatch / batch ─────────────────────────────────────────────────────────

  // fallow-ignore-next-line complexity
  private _dispatch(op: EditOp, origin: unknown): MutationResult {
    const result = applyOp(this.parsed, op);
    const { forward, inverse } = result;

    if (forward.length === 0 && inverse.length === 0) {
      if (this.batchDepth === 0) this.changeHandlers.forEach((h) => h());
      return result;
    }

    this.elementsCache = null;

    // Update override-set from forward patches
    for (const p of forward) {
      const key = pathToKey(p.path);
      if (key !== null) {
        this.overrides[key] =
          p.op === "remove" ? null : (p.value as string | number | boolean | null);
      }
    }

    // Purge orphan property keys for removed elements so the override-set stays
    // compact and a future T3 session doesn't replay stale properties onto a
    // non-existent element. Override-set keys use decoded scoped ids ("hf-host/hf-leaf")
    // while path segments use RFC 6902 encoding ("hf-host~1hf-leaf") — decode before compare.
    for (const p of forward) {
      const elemMatch = /^\/elements\/([^/]+)$/.exec(p.path);
      if (p.op === "remove" && elemMatch) {
        // Decode RFC 6902 escaping: ~1 → /, ~0 → ~
        const id = elemMatch[1]!.replace(/~1/g, "/").replace(/~0/g, "~");
        for (const key of Object.keys(this.overrides)) {
          // Purge property sub-keys (e.g. "hf-x.style.color") but preserve
          // the removal marker itself (key === id, set to null in the loop above).
          if (key.startsWith(`${id}.`) || key.startsWith(`${id}/`)) {
            delete this.overrides[key];
          }
        }
      }
    }

    if (this.batchDepth > 0) {
      this.batchForward.push(...forward);
      this.batchInverse.push(...inverse);
      if (!this.batchOpTypes.includes(op.type)) this.batchOpTypes.push(op.type);
    } else {
      const event = buildPatchEvent(forward, inverse, origin, [op.type]);
      this.patchHandlers.forEach((h) => h(event));
      this.changeHandlers.forEach((h) => h());
    }

    return result;
  }

  dispatch(op: EditOp, opts?: { origin?: unknown }): void {
    this._dispatch(op, opts?.origin ?? ORIGIN_LOCAL);
  }

  /**
   * Coalesce multiple dispatches into one undo entry / one patch event.
   *
   * Transactional: if the callback throws, all DOM mutations applied so far
   * are reverted (accumulated inverse patches replayed in reverse) and the
   * override-set is restored — the model is exactly as it was at batch entry.
   *
   * Note: a batch that produces no effective mutations still fires 'change'
   * handlers (parity with no-op dispatch) — subscribers must not assume
   * silence when wrapping speculative operations.
   */
  // fallow-ignore-next-line complexity
  batch(fn: () => void, opts?: { origin?: unknown }): void {
    const origin = opts?.origin ?? ORIGIN_LOCAL;
    this.batchDepth++;
    if (this.batchDepth === 1) {
      this.batchOrigin = origin; // only set on outermost entry
      this.batchOverridesSnapshot = { ...this.overrides };
    }
    let threw = false;
    try {
      fn();
    } catch (err) {
      threw = true;
      throw err;
    } finally {
      this.batchDepth--;
      if (this.batchDepth === 0) {
        if (!threw && this.batchForward.length > 0) {
          const event = buildPatchEvent(
            this.batchForward,
            [...this.batchInverse].reverse(),
            this.batchOrigin,
            this.batchOpTypes,
          );
          // Fire handlers before resetting batch state so that if a handler
          // throws the patch data (batchForward/batchInverse) is still intact
          // for callers that inspect it on error. The event was already built
          // from a snapshot so handler re-entrancy does not corrupt the event.
          this.patchHandlers.forEach((h) => h(event));
          this.changeHandlers.forEach((h) => h());
          this.resetBatchState();
        } else {
          if (threw && this.batchInverse.length > 0) {
            // Roll back: the dispatches inside the batch already mutated the
            // DOM. Without this, a throwing batch would leave the model in a
            // partial state with no patch trail to undo it.
            applyPatchesToDocument(this.parsed, [...this.batchInverse].reverse());
            this.overrides = { ...this.batchOverridesSnapshot };
            this.elementsCache = null;
          }
          this.resetBatchState();
          // Empty no-op batch: fire changeHandlers (parity with dispatch)
          if (!threw) this.changeHandlers.forEach((h) => h());
        }
      }
    }
  }

  private resetBatchState(): void {
    this.batchForward = [];
    this.batchInverse = [];
    this.batchOpTypes = [];
    this.batchOrigin = ORIGIN_LOCAL;
    this.batchOverridesSnapshot = {};
  }

  can(op: EditOp): CanResult {
    return validateOp(this.parsed, op);
  }

  // ── Events ───────────────────────────────────────────────────────────────────

  on(event: "change", handler: () => void): () => void;
  on(event: "selectionchange", handler: (ids: string[]) => void): () => void;
  on(event: "patch", handler: (event: PatchEvent) => void): () => void;
  on(event: "persist:error", handler: (event: PersistErrorEvent) => void): () => void;
  // fallow-ignore-next-line complexity
  on(event: string, handler: unknown): () => void {
    const h = handler as (...args: unknown[]) => void;
    if (event === "change") {
      this.changeHandlers.push(h as () => void);
      return () => {
        this.changeHandlers = this.changeHandlers.filter((x) => x !== h);
      };
    }
    if (event === "selectionchange") {
      this.selectionHandlers.push(h as (ids: string[]) => void);
      return () => {
        this.selectionHandlers = this.selectionHandlers.filter((x) => x !== h);
      };
    }
    if (event === "patch") {
      this.patchHandlers.push(h as (e: PatchEvent) => void);
      return () => {
        this.patchHandlers = this.patchHandlers.filter((x) => x !== h);
      };
    }
    if (event === "persist:error") {
      const typedH = h as (e: PersistErrorEvent) => void;
      this.errorHandlers.push(typedH);
      const offPersist = this.persist?.on("persist:error", typedH);
      return () => {
        this.errorHandlers = this.errorHandlers.filter((x) => x !== typedH);
        offPersist?.();
      };
    }
    return () => {};
  }

  // ── Serialization ────────────────────────────────────────────────────────────

  serialize(): string {
    return serializeDocument(this.parsed);
  }

  // ── T3 embedded-mode extras ──────────────────────────────────────────────────

  getOverrides(): OverrideSet {
    return { ...this.overrides };
  }

  // fallow-ignore-next-line complexity
  applyPatches(patches: readonly JsonPatchOp[], opts?: { origin?: unknown }): void {
    const origin = opts?.origin ?? ORIGIN_APPLY_PATCHES;

    // The emitted PatchEvent carries an EMPTY inversePatches array — hosts
    // maintaining an external inverse log must compute inverses from their own
    // state; applyPatches events never enter history (origin-guarded).
    // Emit a patch event so subscribers stay in sync.
    applyPatchesToDocument(this.parsed, patches);
    this.elementsCache = null;

    // Update override-set
    for (const p of patches) {
      const key = pathToKey(p.path);
      if (key !== null) {
        this.overrides[key] =
          p.op === "remove" ? null : (p.value as string | number | boolean | null);
      }
    }

    const opTypes = ["applyPatches"];
    const event = buildPatchEvent(patches, [], origin, opTypes);
    this.patchHandlers.forEach((h) => h(event));
    this.changeHandlers.forEach((h) => h());
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  async flush(): Promise<void> {
    await this.persistQueueModule?.flush();
  }

  dispose(): void {
    this.previewSelectionUnsubscribe?.();
    this.previewSelectionUnsubscribe = null;
    this.persistQueueModule?.dispose();
    this.historyModule?.dispose();
    this.changeHandlers = [];
    this.selectionHandlers = [];
    this.patchHandlers = [];
    this.errorHandlers = [];
  }
}

// ─── Public factory ───────────────────────────────────────────────────────────

/**
 * Open a composition for editing.
 *
 * Standalone (T1/T2): supply persist adapter — SDK owns history + auto-save.
 * Embedded (T3): supply overrides — SDK emits patches; host owns history + persistence.
 * Headless (agents): omit both — SDK is a stateless transform + serializer.
 */
// fallow-ignore-next-line complexity
export async function openComposition(
  html: string,
  opts?: OpenCompositionOptions,
): Promise<Composition> {
  // Single parse: parseMutable stamps hf-ids + builds the live linkedom DOM;
  // the query API derives element snapshots from it lazily.
  const parsed = parseMutable(html);

  // T3 embedded: replay the stored override-set onto the base in one pass,
  // so the session exposes the user's exact edited state — not the template.
  if (opts?.overrides) applyOverrideSet(parsed, opts.overrides);

  const session = new CompositionImpl(parsed, opts ?? {});

  const isEmbedded = opts?.overrides !== undefined;

  if (!isEmbedded) {
    const history = createHistory(session, {
      coalesceMs: opts?.coalesceMs ?? 300,
      trackedOrigins: opts?.trackedOrigins,
    });
    session.attachHistory(history);

    if (opts?.persist) {
      const pq = createPersistQueue(session, opts.persist, {
        onError: (e) => session._fireError(e),
      });
      session.attachPersistQueue(pq);
    }
  }

  return session;
}
