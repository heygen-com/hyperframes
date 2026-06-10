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
import { buildDocument, flatElements } from "./document.js";
import type { PersistAdapter, PreviewAdapter } from "./adapters/types.js";
import type { SdkDocument } from "./types.js";
import { parseMutable } from "./engine/model.js";
import type { ParsedDocument } from "./engine/model.js";
import { applyOp, validateOp } from "./engine/mutate.js";
import { serializeDocument } from "./engine/serialize.js";
import { applyPatchesToDocument } from "./engine/apply-patches.js";
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

  private currentSelection: string[] = [];

  private changeHandlers: Array<() => void> = [];
  private selectionHandlers: Array<(ids: string[]) => void> = [];
  private patchHandlers: Array<(e: PatchEvent) => void> = [];
  private errorHandlers: Array<(e: PersistErrorEvent) => void> = [];

  /** Attached by openComposition() for standalone mode. */
  private historyModule: HistoryModule | null = null;
  private persistQueueModule: PersistQueueModule | null = null;

  /** Batching state: accumulates patches from multiple dispatches. */
  private batchDepth = 0;
  private batchForward: JsonPatchOp[] = [];
  private batchInverse: JsonPatchOp[] = [];
  private batchOpTypes: string[] = [];
  private batchOrigin: unknown = ORIGIN_LOCAL;

  constructor(_doc: SdkDocument, parsed: ParsedDocument, opts: OpenCompositionOptions) {
    this.parsed = parsed;
    this.persist = opts.persist;
    this.preview = opts.preview;
    this.overrides = { ...(opts.overrides ?? {}) };
  }

  attachHistory(module: HistoryModule): void {
    this.historyModule = module;
  }

  attachPersistQueue(module: PersistQueueModule): void {
    this.persistQueueModule = module;
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
    // Phase 3b: AST splice. For now, mint id and pass through.
    const tweenId = `tw-${crypto.randomUUID().slice(0, 8)}`;
    this.dispatch({ type: "addGsapTween", target, id: tweenId, tween });
    return tweenId;
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

  // ── Query API (F1) ───────────────────────────────────────────────────────────

  getElements(): ElementSnapshot[] {
    return flatElements(buildDocument(serializeDocument(this.parsed)).roots);
  }

  getElement(id: HfId): ElementSnapshot | null {
    return this.getElements().find((el) => el.id === id) ?? null;
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
          return true;
        })
        .map((el) => el.id)
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

  // ── Dispatch / batch ─────────────────────────────────────────────────────────

  // fallow-ignore-next-line complexity
  dispatch(op: EditOp, opts?: { origin?: unknown }): void {
    const origin = opts?.origin ?? ORIGIN_LOCAL;
    const { forward, inverse } = applyOp(this.parsed, op);

    if (forward.length === 0 && inverse.length === 0) {
      // No-op (e.g. Phase 3b op with no implementation yet): still fire change
      if (this.batchDepth === 0) this.changeHandlers.forEach((h) => h());
      return;
    }

    // Update override-set from forward patches
    for (const p of forward) {
      const key = pathToKey(p.path);
      if (key !== null) {
        this.overrides[key] =
          p.op === "remove" ? null : (p.value as string | number | boolean | null);
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
  }

  // fallow-ignore-next-line complexity
  batch(fn: () => void, opts?: { origin?: unknown }): void {
    const origin = opts?.origin ?? ORIGIN_LOCAL;
    this.batchDepth++;
    if (this.batchDepth === 1) this.batchOrigin = origin; // only set on outermost entry
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
          this.batchForward = [];
          this.batchInverse = [];
          this.batchOpTypes = [];
          this.batchOrigin = ORIGIN_LOCAL;
          this.patchHandlers.forEach((h) => h(event));
          this.changeHandlers.forEach((h) => h());
        } else {
          // threw OR empty: always reset; fire changeHandlers for no-op (parity with dispatch)
          this.batchForward = [];
          this.batchInverse = [];
          this.batchOpTypes = [];
          this.batchOrigin = ORIGIN_LOCAL;
          if (!threw) this.changeHandlers.forEach((h) => h());
        }
      }
    }
  }

  can(op: EditOp): boolean {
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

    // Compute inverse of the incoming patches (apply-then-revert = restore)
    // For applyPatches the "inverse" is the current state before application.
    // Emit a patch event so history and subscribers stay in sync.
    applyPatchesToDocument(this.parsed, patches);

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

  dispose(): void {
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
  const doc = buildDocument(html);
  const parsed = parseMutable(html);
  const session = new CompositionImpl(doc, parsed, opts ?? {});

  const isEmbedded = opts?.overrides !== undefined;

  if (!isEmbedded) {
    const history = createHistory(session, {
      coalesceMs: opts?.coalesceMs ?? 300,
      trackedOrigins: opts?.trackedOrigins,
    });
    session.attachHistory(history);

    if (opts?.persist) {
      const pq = createPersistQueue(session, opts.persist);
      session.attachPersistQueue(pq);
    }
  }

  return session;
}
