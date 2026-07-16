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
  ElementTimingSnapshot,
  FindQuery,
  FontValue,
  GsapTweenSpec,
  ElasticHold,
  KeyframeSpec,
  HfId,
  ImageValue,
  JsonPatchOp,
  OverrideSet,
  PatchEvent,
  PersistErrorEvent,
  SelectionProxy,
  ElementHandle,
  VariableUsageReport,
} from "./types.js";
import { ORIGIN_APPLY_PATCHES, ORIGIN_LOCAL } from "./types.js";
import { buildRoots, flatElements, parsedAnimationIds } from "./document.js";
import type { PersistAdapter, PreviewAdapter } from "./adapters/types.js";
import { parseMutable } from "./engine/model.js";
import type { ParsedDocument } from "./engine/model.js";
import { applyOp, validateOp, type MutationResult } from "./engine/mutate.js";
import { getGsapScripts, resolveScoped, declarationElement } from "./engine/model.js";
import { extractGsapLabels } from "@hyperframes/core/gsap-parser-acorn";
import { stripEmbeddedRuntimeScripts } from "@hyperframes/core/compiler/html-document";
import { parseStartExpression } from "@hyperframes/core/runtime/start-expression";
import {
  readDeclaredDefaults,
  validateVariables,
  scanVariableUsage,
} from "@hyperframes/core/variables";
import type { CompositionVariable, VariableValidationIssue } from "@hyperframes/core/variables";
import { readVariableDeclarations } from "./engine/variableModel.js";
import { serializeDocument } from "./engine/serialize.js";
import { applyPatchesToDocument, applyOverrideSet } from "./engine/apply-patches.js";
import { buildPatchEvent, pathToKey } from "./engine/patches.js";
import { createHistory } from "./history.js";
import type { HistoryModule } from "./history.js";
import { createPersistQueue } from "./persist-queue.js";
import type { PersistQueueModule } from "./persist-queue.js";

export interface OpenCompositionOptions {
  persist?: PersistAdapter;
  /** Adapter path the persist queue writes to. Default: "composition.html". Immutable for the session lifetime. */
  persistPath?: string;
  preview?: PreviewAdapter;
  /** T3 embedded mode: override-set applied on top of the base template. */
  overrides?: OverrideSet;
  /** Origins whose mutations enter the undo stack. Default: all non-applyPatches. */
  trackedOrigins?: unknown[];
  /** Auto-coalesce window for history entries (ms). Default: 300. */
  coalesceMs?: number;
  /**
   * Pass `false` to skip attaching the history module (undo/redo).
   * Default: history is attached in standalone (non-embedded) mode.
   * Use when the host owns the undo stack and SDK undo is dead weight.
   */
  history?: false;
}

// ─── Implementation ───────────────────────────────────────────────────────────

/** Escape a string for literal use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

class CompositionImpl implements Composition {
  private readonly parsed: ParsedDocument;
  private readonly persist: PersistAdapter | undefined;
  readonly preview: PreviewAdapter | undefined;

  /** Accumulated override-set — T3 embedded mode fold contract. */
  private overrides: OverrideSet;

  /**
   * Declared variable defaults as authored at open — captured BEFORE the
   * T3 override-set (and any later setVariableValue) folded into the
   * declarations. Serves getVariableValue({ base: true }).
   */
  private readonly baseVariableDefaults: Record<string, unknown>;

  /** Lazily-built element snapshot, invalidated on every mutation. */
  private elementsCache: ElementSnapshot[] | null = null;
  /** Lazily-built root snapshot (getRootElements), invalidated alongside elementsCache. */
  private rootsCache: ElementSnapshot[] | null = null;

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

  constructor(
    parsed: ParsedDocument,
    opts: OpenCompositionOptions,
    baseVariableDefaults: Record<string, unknown> = {},
  ) {
    this.parsed = parsed;
    this.persist = opts.persist;
    this.preview = opts.preview;
    this.overrides = { ...(opts.overrides ?? {}) };
    this.baseVariableDefaults = baseVariableDefaults;
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

  addElement(parent: HfId | null, index: number, html: string): HfId {
    const result = this._dispatch({ type: "addElement", parent, index, html }, ORIGIN_LOCAL);
    return result.meta?.newId ?? "";
  }

  setVariableValue(id: string, value: string | number | boolean | FontValue | ImageValue): void {
    this.dispatch({ type: "setVariableValue", id, value });
  }

  // ── #2098 CRUD conveniences — thin aliases over the canonical surface below.
  // They delegate so the per-file declaration-element scope (template/fragment
  // sub-comps included) is resolved in exactly one place.
  getVariableValue(
    id: string,
    opts?: { base?: boolean },
  ): string | number | boolean | FontValue | ImageValue | undefined {
    // { base: true } reads the declaration default as authored at open —
    // BEFORE the override-set / any setVariableValue folded into it. This
    // is the value an undo-to-base must restore; the live default IS the
    // override after a fold. Ids unseen at open (declared mid-session) fall
    // through to the live default — their declaration is their base.
    const source =
      opts?.base && id in this.baseVariableDefaults
        ? this.baseVariableDefaults
        : this.getVariableValues();
    return source[id] as string | number | boolean | FontValue | ImageValue | undefined;
  }

  listVariables(): CompositionVariable[] {
    return this.getVariableDeclarations();
  }

  removeVariable(id: string): void {
    this.dispatch({ type: "removeVariable", id });
  }

  // ── Canonical declaration edit ops (this stack) ──
  // declareVariable unified onto the {declaration} op payload (#2098 used
  // {decl}); the method signature is identical, so #2098 callers are unaffected.
  declareVariable(declaration: CompositionVariable): void {
    this.dispatch({ type: "declareVariable", declaration });
  }

  updateVariableDeclaration(id: string, declaration: CompositionVariable): void {
    this.dispatch({ type: "updateVariableDeclaration", id, declaration });
  }

  removeVariableDeclaration(id: string): void {
    this.dispatch({ type: "removeVariableDeclaration", id });
  }

  getVariableDeclarations(): CompositionVariable[] {
    return readVariableDeclarations(declarationElement(this.parsed.document, this.parsed.wrapped));
  }

  getVariableValues(overrides?: Record<string, unknown>): Record<string, unknown> {
    // THIS composition's own declared defaults (loose extraction: any entry with
    // a string id + a `default` key, even ones the strict declaration parser
    // drops) spread under the overrides. Scope note: this reads the composition's
    // single declaration element only — NOT a union of every `[data-composition-
    // variables]` in the document. The runtime's getVariables()
    // (core/runtime/getVariables.ts) additionally walks inlined sub-composition
    // declarers because it operates on the bundled multi-composition document;
    // the SDK models one composition file, so per-file scope is intended.
    const defaults = readDeclaredDefaults(
      declarationElement(this.parsed.document, this.parsed.wrapped),
    );
    return { ...defaults, ...(overrides ?? {}) };
  }

  validateVariableValues(values: Record<string, unknown>): VariableValidationIssue[] {
    return validateVariables(values, this.getVariableDeclarations());
  }

  /**
   * Script scans are content-keyed (same rationale as _gsapLabelCache): the
   * panel recomputes usage on every preview reload, and unchanged script text
   * is the common case — never pay a second acorn parse for identical input.
   */
  private _variableUsageScanCache = new Map<string, ReturnType<typeof scanVariableUsage>>();

  // Scan/merge dispatcher — same complexity class as the suppressed
  // variableUsage.ts classifiers it drives.
  // fallow-ignore-next-line complexity
  getVariableUsage(): VariableUsageReport {
    const usedIds: string[] = [];
    const seen = new Set<string>();
    let scanIncomplete = false;
    const freshCache = new Map<string, ReturnType<typeof scanVariableUsage>>();
    // Inline scripts only — external src scripts aren't part of the document model.
    for (const script of Array.from(this.parsed.document.querySelectorAll("script"))) {
      if (script.getAttribute("src")) continue;
      const text = script.textContent ?? "";
      // Direct global reads (window.__hfVariables / __hfVariablesByComp) are
      // invisible to the getVariables() scanner — the report must degrade to
      // a lower bound instead of confidently claiming declarations unused.
      if (text.includes("__hfVariables")) scanIncomplete = true;
      if (!text.includes("getVariables")) continue; // cheap pre-filter before an acorn parse
      const scan = this._variableUsageScanCache.get(text) ?? scanVariableUsage(text);
      freshCache.set(text, scan);
      scanIncomplete = scanIncomplete || scan.scanIncomplete;
      for (const id of scan.usedIds) {
        if (!seen.has(id)) {
          seen.add(id);
          usedIds.push(id);
        }
      }
    }
    // Declarative bindings (data-var-src / data-var-text) are direct reads.
    for (const el of Array.from(
      this.parsed.document.querySelectorAll("[data-var-src], [data-var-text]"),
    )) {
      for (const attr of ["data-var-src", "data-var-text"]) {
        const id = el.getAttribute(attr)?.trim();
        if (id && !seen.has(id)) {
          seen.add(id);
          usedIds.push(id);
        }
      }
    }
    this._variableUsageScanCache = freshCache;
    const declaredIds = this.getVariableDeclarations().map((d) => d.id);
    // The CSS compat channel counts as usage: a variable consumed only via
    // var(--id) in stylesheets or inline styles must not be badged unused
    // (removing it also removes the --{id} root prop and breaks the binding).
    const cssText = this._collectCssText();
    // Match var(--id) only at a custom-property-name boundary: the id must be
    // followed by whitespace, a comma (fallback), or the closing paren — so id
    // "foo" is NOT counted as used by an unrelated var(--foo-header). Ids are
    // regex-escaped because a value read from disk may predate can()'s
    // /^[A-Za-z_][A-Za-z0-9_-]*$/ enforcement and carry metacharacters.
    const cssUsed = (id: string) =>
      new RegExp(`var\\(\\s*--${escapeRegExp(id)}[\\s,)]`).test(cssText);
    const declaredSet = new Set(declaredIds);
    return {
      usedIds,
      unusedDeclarations: declaredIds.filter((id) => !seen.has(id) && !cssUsed(id)),
      undeclaredReads: usedIds.filter((id) => !declaredSet.has(id)),
      scanIncomplete,
    };
  }

  /** All stylesheet + inline-style text, for var(--id) consumption checks. */
  private _collectCssText(): string {
    const cssParts: string[] = [];
    for (const styleEl of Array.from(this.parsed.document.querySelectorAll("style"))) {
      cssParts.push(styleEl.textContent ?? "");
    }
    for (const el of Array.from(this.parsed.document.querySelectorAll("[style]"))) {
      cssParts.push(el.getAttribute("style") ?? "");
    }
    return cssParts.join("\n");
  }

  setPreviewVariables(values: Record<string, unknown> | null): boolean {
    if (!this.preview?.setPreviewVariables) return false;
    this.preview.setPreviewVariables(values);
    return true;
  }

  // ── WS-C: timing accessors + typed setHold ───────────────────────────────────

  /**
   * Cache of parsed GSAP labels keyed by the ordered list of EXACT script texts.
   * extractGsapLabels does a full acorn parse; caching avoids re-parsing on repeated
   * getElementTimings reads when the scripts are unchanged.
   */
  private _gsapLabelCache: {
    scripts: string[];
    labels: ReturnType<typeof extractGsapLabels>;
  } | null = null;

  // fallow-ignore-next-line complexity
  getElementTimings(): Record<HfId, ElementTimingSnapshot> {
    const scripts = getGsapScripts(this.parsed.document);

    // Extract all addLabel("name", position) calls from every GSAP script.
    let allLabels: ReturnType<typeof extractGsapLabels>;
    const cachedScripts = this._gsapLabelCache?.scripts;
    const cacheMatches =
      cachedScripts?.length === scripts.length &&
      cachedScripts.every((script, index) => script === scripts[index]);
    if (cacheMatches) {
      allLabels = this._gsapLabelCache?.labels ?? [];
    } else {
      allLabels = scripts.flatMap((script) => extractGsapLabels(script));
      this._gsapLabelCache = scripts.length ? { scripts: [...scripts], labels: allLabels } : null;
    }

    // Resolve a `data-start` that's a relative-timing REFERENCE ("intro", "intro + 2" —
    // parseStartExpression's grammar) into an absolute second, recursively against the
    // referenced element's own resolved start + duration. A plain numeric data-start keeps
    // the old parseFloat path unchanged — this only touches the case that used to silently
    // resolve to 0 (parseFloat("intro + 2") is NaN). Node-safe static counterpart of the
    // runtime's own resolver (runtime/startResolver.ts): no live GSAP timeline to fall back
    // on, so an unauthored sub-composition duration still resolves to 0, same as before.
    //
    // refId is always a BARE id (the reference grammar has no scope syntax), resolved via
    // resolveScoped's bare-id rule: prefer the canonical top-level match, else document
    // order. An element inside a sub-composition referencing a bare id that also exists at
    // the top level resolves to the TOP-LEVEL one, not a same-scope sibling — this matches
    // the runtime's own resolver (also a global, not scope-aware, lookup), so the two stay
    // consistent, but it means a bare-id collision across scopes is a real footgun for
    // authored content.
    const startCache = new Map<Element, number>();
    const visiting = new Set<Element>();
    // Split out of resolveStart so its own branching stays low — this is the ONE
    // path that recurses + calls resolveDuration, kept here so that's visible at a
    // glance rather than buried inside resolveStart's try block.
    const resolveReferenceStart = (refId: string, offset: number): number => {
      const target = resolveScoped(this.parsed.document, refId);
      if (!target) return 0;
      return Math.max(0, resolveStart(target) + (resolveDuration(target) ?? 0) + offset);
    };
    const resolveStart = (el: Element): number => {
      const cached = startCache.get(el);
      if (cached !== undefined) return cached;
      if (visiting.has(el)) return 0; // reference cycle — fail safe, don't loop
      visiting.add(el);
      let resolved: number;
      try {
        const startStr = el.getAttribute("data-start");
        const expr = parseStartExpression(startStr);
        if (expr?.kind === "reference") {
          resolved = resolveReferenceStart(expr.refId, expr.offset);
        } else if (expr?.kind === "absolute") {
          resolved = expr.value;
        } else {
          resolved = startStr !== null ? parseFloat(startStr) : 0;
        }
      } finally {
        visiting.delete(el);
      }
      const finite = Number.isFinite(resolved) ? resolved : 0;
      startCache.set(el, finite);
      return finite;
    };
    // Same preference as handleSetTiming: prefer data-duration, fall back to end - start.
    const resolveDuration = (el: Element): number | null => {
      const durationStr = el.getAttribute("data-duration");
      const durationAttr = durationStr !== null ? parseFloat(durationStr) : null;
      if (durationAttr !== null && Number.isFinite(durationAttr)) return durationAttr;
      const endStr = el.getAttribute("data-end");
      const endAttr = endStr !== null ? parseFloat(endStr) : null;
      if (endAttr !== null && Number.isFinite(endAttr)) return endAttr - resolveStart(el);
      return null;
    };

    const result: Record<HfId, ElementTimingSnapshot> = {};
    const elements = this.getElements();
    for (const el of elements) {
      const domEl = resolveScoped(this.parsed.document, el.scopedId);
      if (!domEl) continue;

      const enterAt = resolveStart(domEl);
      const duration = resolveDuration(domEl);
      if (duration === null) continue; // no timing info — skip non-timed elements

      const exitAt = enterAt + duration;

      // Labels whose position falls within [enterAt, exitAt] (end-inclusive: a
      // label exactly at exitAt is treated as within the element's window).
      const labels = allLabels
        .filter(({ position }) => position >= enterAt && position <= exitAt)
        .map(({ name }) => name);

      result[el.scopedId] = { enterAt, exitAt, labels };
    }

    return result;
  }

  setElementTiming(
    map: Record<HfId, { start?: number; duration?: number; trackIndex?: number }>,
  ): void {
    const entries = Object.entries(map);
    if (entries.length === 0) return;

    this.batch(() => {
      for (const [id, timing] of entries) {
        this.dispatch({ type: "setTiming", target: id, ...timing });
      }
    });
  }

  setHold(id: HfId, hold: ElasticHold): void {
    this.dispatch({ type: "setHold", target: id, hold });
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

  addWithKeyframes(
    targetSelector: string,
    position: number,
    duration: number,
    keyframes: KeyframeSpec[],
    ease?: string,
  ): string {
    const result = this._dispatch(
      { type: "addWithKeyframes", targetSelector, position, duration, keyframes, ease },
      ORIGIN_LOCAL,
    );
    return result.meta?.animationId ?? "";
  }

  replaceWithKeyframes(
    animationId: string,
    targetSelector: string,
    position: number,
    duration: number,
    keyframes: KeyframeSpec[],
    ease?: string,
  ): string {
    const result = this._dispatch(
      {
        type: "replaceWithKeyframes",
        animationId,
        targetSelector,
        position,
        duration,
        keyframes,
        ease,
      },
      ORIGIN_LOCAL,
    );
    // Position-derived IDs renumber after the remove — this is the NEW id, which
    // may differ from the input animationId.
    return result.meta?.animationId ?? "";
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

  /**
   * Top-level elements only (each still carrying its full descendant subtree via
   * `.children`) — unlike `getElements()`, no element appears twice. Consumers building a
   * tree view (a layer panel) want this, not `getElements()`: that method's flat list
   * includes every descendant a second time as its own top-level entry, since each
   * snapshot in it still carries its children. `buildRoots` already computes true roots
   * internally for `getElements()` to flatten — this just returns them unflattened.
   * Cached like elementsCache — a layer panel calling this every render tick shouldn't
   * repay the DOM walk each time.
   */
  getRootElements(): ElementSnapshot[] {
    this.rootsCache ??= buildRoots(this.parsed.document);
    return [...this.rootsCache];
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

  getAllAnimationIds(): Set<string> {
    const ids = new Set<string>();
    for (const script of getGsapScripts(this.parsed.document)) {
      for (const id of parsedAnimationIds(script)) ids.add(id);
    }
    return ids;
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
    this.rootsCache = null;

    // Update override-set from forward patches
    for (const p of forward) {
      const key = pathToKey(p.path);
      if (key !== null) {
        this.overrides[key] =
          p.op === "remove"
            ? null
            : (p.value as string | number | boolean | Record<string, unknown> | null);
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
      // Reverse the inverse list (parity with batch() below): an op that emits
      // multiple patches whose undo order matters — same path (reorderElements
      // with a duplicate target), an aliased multi-target, or a nested
      // parent+child removeElement — must undo in reverse application order, or
      // undo lands on an intermediate value / drops a subtree. Harmless for the
      // common single-patch / independent-path case.
      const event = buildPatchEvent(forward, [...inverse].reverse(), origin, [op.type]);
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
            this.rootsCache = null;
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

  serialize(opts?: { stripRuntime?: boolean }): string {
    const html = serializeDocument(this.parsed);
    // Newer agent-generated compositions embed hyperframe.runtime.iife.js in their own
    // HTML. Any host driving its own clock (not just an editing iframe — anything that
    // owns seeking/playback itself) must not let that runtime self-init: it races the
    // host's first seek and resets the timeline to t=0. Opt-in (default false) since a
    // host playing the composition normally wants the runtime.
    return opts?.stripRuntime ? stripEmbeddedRuntimeScripts(html) : html;
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
    this.rootsCache = null;

    // Update override-set
    for (const p of patches) {
      const key = pathToKey(p.path);
      if (key !== null) {
        this.overrides[key] =
          p.op === "remove"
            ? null
            : (p.value as string | number | boolean | Record<string, unknown> | null);
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

  // Pre-override declared defaults — applyOverrideSet below folds `var.<id>`
  // overrides destructively into the declarations, so this is the last moment
  // the authored base values are readable. getVariableValue({ base: true })
  // serves them for the rest of the session (undo-to-base restores).
  const baseVariableDefaults = readDeclaredDefaults(
    declarationElement(parsed.document, parsed.wrapped),
  );

  // T3 embedded: replay the stored override-set onto the base in one pass,
  // so the session exposes the user's exact edited state — not the template.
  if (opts?.overrides) applyOverrideSet(parsed, opts.overrides);

  const session = new CompositionImpl(parsed, opts ?? {}, baseVariableDefaults);

  const isEmbedded = opts?.overrides !== undefined;

  if (!isEmbedded) {
    // history:false opts out of the SDK undo stack ONLY. Persist (auto-save) is
    // independent — gating it on the history flag too would silently drop every
    // disk write for a caller that just wanted to disable undo (data loss).
    if (opts?.history !== false) {
      const history = createHistory(session, {
        coalesceMs: opts?.coalesceMs ?? 300,
        trackedOrigins: opts?.trackedOrigins,
      });
      session.attachHistory(history);
    }

    if (opts?.persist) {
      const pq = createPersistQueue(session, opts.persist, {
        path: opts.persistPath,
        onError: (e) => session._fireError(e),
      });
      session.attachPersistQueue(pq);
    }
  }

  return session;
}
