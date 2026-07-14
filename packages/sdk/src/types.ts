import type { CompositionVariable, VariableValidationIssue } from "@hyperframes/core/variables";

/**
 * Cross-referenced variable usage for a whole composition: the per-script
 * static scans merged and compared against the declared schema.
 */
export interface VariableUsageReport {
  /** Variable ids read by composition scripts (static analysis, first-seen order). */
  usedIds: string[];
  /** Declared ids never read by any script. */
  unusedDeclarations: string[];
  /** Ids read by scripts but missing from data-composition-variables. */
  undeclaredReads: string[];
  /**
   * True when any script accesses variables opaquely (computed keys, escaping
   * values object…) — usedIds is then a lower bound and unusedDeclarations
   * may be false positives.
   */
  scanIncomplete: boolean;
}

// ─── Document model ───────────────────────────────────────────────────────────

/** Full DOM-level view of one editable element. Built by the SDK adaptation layer. */
export interface HyperFramesElement {
  readonly id: string;
  /**
   * Fully-qualified scoped id — host-chain prefix + leaf, separated by "/".
   * For top-level elements: scopedId === id.
   * For elements inside inlined sub-compositions: "hf-HOST/hf-LEAF" (any depth).
   * This is the canonical identifier to use in dispatch targets, getElement(),
   * find(), and override-set keys when addressing sub-composition elements.
   */
  readonly scopedId: string;
  readonly tag: string;
  readonly children: readonly HyperFramesElement[];
  /** camelCase property names — mirrors CSSStyleDeclaration convention */
  readonly inlineStyles: Readonly<Record<string, string>>;
  readonly classNames: readonly string[];
  /** All attributes except style, class, and data-hf-* (those are model-level) */
  readonly attributes: Readonly<Record<string, string>>;
  /** Display text for the SDK setText target, not a full descendant-text snapshot. */
  readonly text: string | null;
  // Timing — null when element has no data-start
  readonly start: number | null;
  readonly duration: number | null;
  readonly trackIndex: number | null;
  /** Phase 2: GSAP tween IDs whose target is this element */
  readonly animationIds: readonly string[];
}

/** The SDK's in-memory document. Built from ensureHfIds + linkedom DOM walk. */
export interface SdkDocument {
  readonly roots: readonly HyperFramesElement[];
  readonly gsapScript: string | null;
  readonly styles: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly compositionDuration: number | null;
  /**
   * BUILD-TIME snapshot of the ensureHfIds-stamped HTML. Never updated after
   * mutations — use Composition.serialize() for the current document state.
   */
  readonly html: string;
}

// ─── Override-set (T3 embedded mode) ─────────────────────────────────────────

/**
 * Sparse map of `hfId.prop.path → value` overrides layered on top of the base template.
 * null value = removal marker (element or property deleted by user).
 * Examples: { "hf-x7k2.style.fontSize": "96px", "hf-y3a1.text": "Hello", "hf-z5k2": null }
 *
 * Font and image variable overrides store their object values under the var.{id} key:
 * { "var.brand-font": { name: "Roboto", source: "https://fonts.googleapis.com/…" } }
 */
/**
 * A set of variable overrides. The `Record<string, unknown>` member admits
 * object-valued variables (font/image). NOTE for SDK consumers: this widening
 * means code reading an OverrideSet value must narrow before assuming a scalar —
 * an object value will type-check anywhere `unknown` is accepted.
 */
export type OverrideSet = Record<
  string,
  string | number | boolean | Record<string, unknown> | null
>;

// ─── can() result ─────────────────────────────────────────────────────────────

/**
 * Structured result from can(op).
 *
 * `ok: true` — dispatch(op) will succeed.
 * `ok: false` — dispatch would be a no-op or error; `code` is stable for switch.
 *   Codes: E_TARGET_NOT_FOUND | E_NO_ROOT | E_NO_GSAP_TIMELINE | E_NO_GSAP_SCRIPT
 */
export type CanResult = { ok: true } | { ok: false; code: string; message: string; hint?: string };

// ─── Edit operations (F1: explicit target on every element op) ────────────────

export type HfId = string;

/** Every element op takes explicit target id(s). No selection-implicit mutation. */
export type EditOp =
  | { type: "setStyle"; target: HfId | HfId[]; styles: Record<string, string | null> }
  | { type: "setText"; target: HfId | HfId[]; value: string }
  | { type: "setAttribute"; target: HfId | HfId[]; name: string; value: string | null }
  | {
      type: "setTiming";
      target: HfId | HfId[];
      start?: number;
      duration?: number;
      trackIndex?: number;
    }
  | { type: "setHold"; target: HfId | HfId[]; hold: ElasticHold }
  | { type: "moveElement"; target: HfId | HfId[]; x: number; y: number }
  | { type: "removeElement"; target: HfId | HfId[] }
  | {
      type: "addElement";
      /** Id of the parent element, or null to insert at the document body root. */
      parent: HfId | null;
      /** Zero-based sibling index at which to insert (append if >= childCount). */
      index: number;
      /** Single-root HTML fragment. Must not contain <script>. */
      html: string;
    }
  | {
      type: "reorderElements";
      /** Each entry sets inline zIndex on one element. Positioning is unchanged — z-index only takes effect on non-static elements, so the caller must ensure the target is positioned. */
      entries: Array<{ target: HfId; zIndex: number }>;
    }
  | { type: "setClassStyle"; selector: string; styles: Record<string, string | null> }
  | { type: "setCompositionMetadata"; width?: number; height?: number; duration?: number }
  | { type: "declareVariable"; declaration: CompositionVariable }
  | { type: "updateVariableDeclaration"; id: string; declaration: CompositionVariable }
  | { type: "removeVariableDeclaration"; id: string }
  | {
      type: "setVariableValue";
      id: string;
      value: string | number | boolean | FontValue | ImageValue;
    }
  // #2098 alias op — remove-by-id, kept for its shipped session.removeVariable().
  | { type: "removeVariable"; id: string }
  | { type: "addGsapTween"; target: HfId; tween: GsapTweenSpec }
  | { type: "setGsapTween"; animationId: string; properties: Partial<GsapTweenSpec> }
  | {
      type: "setGsapKeyframe";
      animationId: string;
      keyframeIndex: number;
      position?: number;
      value?: Record<string, unknown>;
      ease?: string;
    }
  | {
      type: "addGsapKeyframe";
      animationId: string;
      position: number;
      value: Record<string, unknown>;
    }
  | { type: "removeGsapKeyframe"; animationId: string; percentage: number }
  | { type: "removeGsapProperty"; animationId: string; property: string; from?: boolean }
  | { type: "removeGsapTween"; animationId: string }
  | { type: "removeAllKeyframes"; animationId: string }
  | {
      type: "convertToKeyframes";
      animationId: string;
      resolvedFromValues?: Record<string, number | string>;
    }
  | { type: "deleteAllForSelector"; selector: string }
  | {
      type: "materializeKeyframes";
      animationId: string;
      keyframes: Array<{
        percentage: number;
        properties: Record<string, number | string>;
        ease?: string;
      }>;
      easeEach?: string;
      resolvedSelector?: string;
    }
  | { type: "splitIntoPropertyGroups"; animationId: string }
  | {
      type: "splitAnimations";
      originalId: string;
      newId: string;
      splitTime: number;
      elementStart: number;
      elementDuration: number;
    }
  | { type: "addLabel"; name: string; position: number }
  | { type: "removeLabel"; name: string }
  | {
      type: "setArcPath";
      animationId: string;
      config: {
        enabled: boolean;
        autoRotate: boolean | number;
        segments: Array<{
          curviness?: number;
          cp1?: { x: number; y: number };
          cp2?: { x: number; y: number };
        }>;
      };
    }
  | {
      type: "updateArcSegment";
      animationId: string;
      segmentIndex: number;
      update: {
        curviness?: number;
        cp1?: { x: number; y: number };
        cp2?: { x: number; y: number };
      };
    }
  | { type: "removeArcPath"; animationId: string }
  | {
      type: "unrollDynamicAnimations";
      animationId: string;
      elements: Array<{
        selector: string;
        keyframes: Array<{ percentage: number; properties: Record<string, number | string> }>;
        easeEach?: string;
      }>;
    }
  | {
      /** Insert a new keyframed tween for targetSelector at the given position/duration. */
      type: "addWithKeyframes";
      targetSelector: string;
      /** Timeline position in seconds. Number-only (unlike GsapTweenSpec.position, which also accepts label-relative strings). */
      position: number;
      duration: number;
      keyframes: KeyframeSpec[];
      ease?: string;
    }
  | {
      /**
       * Replace an existing tween (by animationId) with a new keyframed tween.
       * Equivalent to removeGsapTween + addWithKeyframes in one atomic op.
       * Position-derived tween IDs renumber after the remove; callers must
       * re-parse to discover the new ID.
       */
      type: "replaceWithKeyframes";
      animationId: string;
      targetSelector: string;
      /** Timeline position in seconds. Number-only (unlike GsapTweenSpec.position, which also accepts label-relative strings). */
      position: number;
      duration: number;
      keyframes: KeyframeSpec[];
      ease?: string;
    };

/**
 * A single keyframe entry for `addWithKeyframes` / `replaceWithKeyframes`.
 * Single source of truth — Studio-side mirrors (KeyframeEntry/KeyframeSpec) should
 * import this rather than redeclare the shape.
 */
export interface KeyframeSpec {
  percentage: number;
  properties: Record<string, number | string>;
  ease?: string;
  /** GSAP endpoint flag — emitted as numeric `_auto: 1`, not boolean. */
  auto?: boolean;
}

export interface ElasticHold {
  start: number;
  end: number;
  fill: "freeze" | "loop";
}

/**
 * Object value for a `font` variable (LOCKED §7 — object-valued, never a CSS string).
 * `name` is the CSS font-family value; `source` is the stylesheet URL to load.
 */
export interface FontValue {
  name: string;
  source: string;
}

/**
 * Object value for an `image` variable (LOCKED §7 — object-valued, never a CSS string).
 * `url` is the image src. Add explicit optional fields here as consumers need them —
 * an open `[key: string]: unknown` index signature was dropped because it let any
 * `{url}`-shaped object through and swallowed key typos.
 */
export interface ImageValue {
  url: string;
  alt?: string;
  fit?: "cover" | "contain" | "fill" | "none" | "scale-down";
}

export interface GsapTweenSpec {
  method: "from" | "to" | "fromTo" | "set";
  position?: number | string;
  duration?: number;
  ease?: string;
  fromProperties?: Record<string, unknown>;
  toProperties?: Record<string, unknown>;
  /** For 'to' tweens — the properties to animate toward */
  properties?: Record<string, unknown>;
  repeat?: number;
  yoyo?: boolean;
  stagger?: number | Record<string, unknown>;
}

// ─── Patch layer (F2: RFC 6902 frozen contract) ───────────────────────────────

/**
 * Emit-only subset of RFC 6902: the SDK never emits move/copy/test, and
 * applyPatches() ignores ops outside this subset. Hosts feeding patches back
 * must restrict themselves to add/remove/replace.
 */
export interface JsonPatchOp {
  op: "add" | "remove" | "replace";
  path: string;
  value?: unknown;
}

/**
 * Emitted by session.on('patch') after every committed change.
 * formatVersion bumps = breaking; hosts check once and reject unknown versions.
 */
export interface PatchEvent {
  readonly formatVersion: 1;
  readonly patches: readonly JsonPatchOp[];
  readonly inversePatches: readonly JsonPatchOp[];
  /** Re-emitted verbatim from the mutation entry. Use ORIGIN_APPLY_PATCHES to detect undo loops. */
  readonly origin: unknown;
  /** Semantic op names ('setStyle') — for analytics/history labels. Not versioned. */
  readonly opTypes: readonly string[];
}

// ─── Origin model (F4) ────────────────────────────────────────────────────────

/**
 * Reserved origin tag for applyPatches().
 * Host listeners MUST skip this origin to prevent undo loops:
 *   comp.on('patch', ({ origin }) => { if (origin === ORIGIN_APPLY_PATCHES) return; ... })
 *
 * A namespaced string (not a unique symbol) so the sentinel survives realm
 * boundaries — postMessage, structured clone, JSON — which T3 embedded hosts
 * may forward patch events across. The namespace prefix keeps collision risk
 * with host-chosen origins negligible.
 */
export const ORIGIN_APPLY_PATCHES = "@hyperframes/sdk:applyPatches" as const;

/** Default origin when none specified — UI-driven dispatch. */
export const ORIGIN_LOCAL = "local" as const;

// ─── Event types ─────────────────────────────────────────────────────────────

export interface PersistErrorEvent {
  error: { message: string; hint?: string; cause?: unknown };
}

// ─── Element query / snapshot (F1 query API) ─────────────────────────────────

/** Flat read-only snapshot returned by getElements() / getElement() */
export type ElementSnapshot = HyperFramesElement;

export interface FindQuery {
  tag?: string;
  text?: string;
  name?: string;
  track?: number;
  /** Filter to elements inside a specific sub-composition host (by host hf-id). */
  composition?: string;
}

// ─── Typed method sugar (F10) ─────────────────────────────────────────────────

/**
 * Proxy returned by comp.selection() — resolves getSelection() → explicit ops at call time.
 * Multi-select gets well-defined semantics: op applied per id within one batch.
 */
export interface SelectionProxy {
  readonly ids: readonly string[];
  setStyle(styles: Record<string, string | null>): void;
  setText(value: string): void;
  setAttribute(name: string, value: string | null): void;
  setTiming(timing: { start?: number; duration?: number; trackIndex?: number }): void;
  removeElement(): void;
}

/**
 * Curried element handle — holds only the id string, no stale-ref hazard.
 * comp.element('hf-x7k2').setStyle({ color: '#fff' })
 */
export interface ElementHandle {
  readonly id: string;
  setStyle(styles: Record<string, string | null>): void;
  setText(value: string): void;
  setAttribute(name: string, value: string | null): void;
  setTiming(timing: { start?: number; duration?: number; trackIndex?: number }): void;
  removeElement(): void;
}

// ─── Timing accessor types (WS-C) ─────────────────────────────────────────────

/**
 * Resolved timing snapshot for one element.
 * Labels are GSAP timeline label names whose numeric position falls within
 * [enterAt, exitAt] for this element. Parsed fresh on every call — never cached.
 */
export interface ElementTimingSnapshot {
  enterAt: number;
  exitAt: number;
  /** GSAP addLabel names active during this element's window. */
  labels: string[];
}

// ─── Composition (the main public surface, F10) ───────────────────────────────

/**
 * An open composition editing session.
 * Typed methods (docs page one) sugar over dispatch() — all validation in dispatch.
 * dispatch() is the advanced/agent layer (data-shaped ops, automation, replay).
 */
export interface Composition {
  // ── Typed methods (F10 layer 1) ────────────────────────────────────────────
  setStyle(id: HfId, styles: Record<string, string | null>): void;
  setText(id: HfId, value: string): void;
  setAttribute(id: HfId, name: string, value: string | null): void;
  setTiming(id: HfId, timing: { start?: number; duration?: number; trackIndex?: number }): void;
  removeElement(id: HfId): void;
  /**
   * Insert an HTML fragment as a child of `parent` at `index` (WS-D).
   * Mints a stable hf-id against the live document's existing id set.
   * Returns the minted id of the inserted root element.
   * Inverse = removeElement of the returned id.
   */
  addElement(parent: HfId | null, index: number, html: string): HfId;
  setVariableValue(id: string, value: string | number | boolean | FontValue | ImageValue): void;
  /**
   * Current `default` value for a declared variable, or undefined if
   * undeclared/unset. Convenience over getVariableValues() (kept from #2098).
   */
  getVariableValue(id: string): string | number | boolean | FontValue | ImageValue | undefined;
  /**
   * Every declared variable's full schema (id/type/label/default/…), or [] when
   * none. Alias of getVariableDeclarations() (kept from #2098's surface).
   */
  listVariables(): CompositionVariable[];
  /** Remove a variable's declaration — alias of removeVariableDeclaration(). */
  removeVariable(id: string): void;
  /**
   * Declare a new variable in `data-composition-variables`. No-ops when the
   * id is already declared (see can() for the E_DUPLICATE_VARIABLE check);
   * creates the attribute when the composition has none yet.
   */
  declareVariable(declaration: CompositionVariable): void;
  /**
   * Replace an existing declaration wholesale (label, type, constraints,
   * default — the id itself is immutable; rename = remove + declare). When
   * the default changes to/from a scalar, the `--{id}` CSS compat custom
   * property on the root is kept in sync, mirroring setVariableValue.
   */
  updateVariableDeclaration(id: string, declaration: CompositionVariable): void;
  /**
   * Remove a declaration (and the last one removes the whole attribute).
   * Also clears the `--{id}` CSS compat custom property if present.
   */
  removeVariableDeclaration(id: string): void;
  /**
   * Read the typed variable declarations from `data-composition-variables`
   * (the canonical schema — same filter the render pipeline uses; malformed
   * entries are dropped). Read-only — does not dispatch.
   */
  getVariableDeclarations(): CompositionVariable[];
  /**
   * Resolve this composition's variable values: its declared defaults merged
   * with `overrides` (overrides win, undeclared override keys pass through).
   * Read-only — does not dispatch.
   *
   * Scope: reads THIS composition file's own declaration element, not a union of
   * every `[data-composition-variables]` in a bundled document. The runtime's
   * `getVariables()` additionally walks inlined sub-composition declarers because
   * it runs on the fully-bundled document; the SDK models one composition file,
   * so per-file scope is intentional (and is what Studio needs to predict a
   * single file's `--variables` payload). For the common single-`<html>`
   * composition the two agree; they diverge only when sub-comp declarers are
   * inlined into one document.
   */
  getVariableValues(overrides?: Record<string, unknown>): Record<string, unknown>;
  /**
   * Validate a values map against the declared schema. Returns undeclared /
   * type-mismatch / enum-out-of-range issues (same checks as the CLI's
   * `--strict-variables`). Read-only — does not dispatch.
   */
  validateVariableValues(values: Record<string, unknown>): VariableValidationIssue[];
  /**
   * Cross-reference the declared schema against a static scan of every inline
   * composition script (getVariables() reads). Read-only — does not dispatch.
   */
  getVariableUsage(): VariableUsageReport;
  /**
   * Apply variable values to the preview surface (ephemeral — never written
   * to the document; use setVariableValue to persist a default). Pass null to
   * restore declared defaults. No-op when the preview adapter doesn't
   * implement setPreviewVariables; returns whether the adapter handled it.
   */
  setPreviewVariables(values: Record<string, unknown> | null): boolean;
  /**
   * Read enter/exit times and GSAP labels for every timed element (WS-C).
   * Derives enterAt/exitAt using the same data-duration vs data-end preference
   * as handleSetTiming (data-duration wins; data-end − data-start as fallback).
   * Labels are parsed fresh from the GSAP script each call.
   * Read-only — does not dispatch.
   */
  getElementTimings(): Record<HfId, ElementTimingSnapshot>;
  /**
   * Apply a sparse timing map in a single batch (WS-C).
   * Dispatches one setTiming op per entry inside a batch so the history sees
   * one undo step. Skips entries for unknown ids silently.
   */
  setElementTiming(
    map: Record<HfId, { start?: number; duration?: number; trackIndex?: number }>,
  ): void;
  /**
   * Set an elastic hold window on an element (WS-C).
   * Thin typed wrapper over the existing setHold op — mirrors setVariableValue pattern.
   */
  setHold(id: HfId, hold: ElasticHold): void;
  /** Returns the newly-assigned tween ID */
  addGsapTween(target: HfId, tween: GsapTweenSpec): string;
  setGsapTween(animationId: string, properties: Partial<GsapTweenSpec>): void;
  removeGsapTween(animationId: string): void;
  /**
   * Add a keyframed tween. Typed wrapper over the addWithKeyframes op (mirrors
   * addGsapTween). Returns the newly-minted animationId, or "" if rejected.
   */
  addWithKeyframes(
    targetSelector: string,
    position: number,
    duration: number,
    keyframes: KeyframeSpec[],
    ease?: string,
  ): string;
  /**
   * Replace an existing keyframed tween. Typed wrapper over replaceWithKeyframes.
   * Returns the replacement's animationId (treat as NEW — position-derived IDs
   * renumber after the remove), or "" if rejected.
   */
  replaceWithKeyframes(
    animationId: string,
    targetSelector: string,
    position: number,
    duration: number,
    keyframes: KeyframeSpec[],
    ease?: string,
  ): string;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;

  // ── Query API (F1) ─────────────────────────────────────────────────────────
  getElements(): ElementSnapshot[];
  /** Top-level elements only, each carrying its full subtree — no id appears twice. */
  getRootElements(): ElementSnapshot[];
  getElement(id: HfId): ElementSnapshot | null;
  find(query: FindQuery): string[];
  /**
   * Every GSAP tween id parsed from the composition's script, regardless of
   * whether its target selector currently matches a live DOM element. See
   * parsedAnimationIds in document.ts for why this differs from the
   * per-element animationIds on ElementSnapshot.
   */
  getAllAnimationIds(): Set<string>;

  // ── Selection API ──────────────────────────────────────────────────────────
  /** Sugar: resolves getSelection() → explicit ops at call time */
  selection(): SelectionProxy;
  /** Curried handle — holds only the id, no stale-ref hazard */
  element(id: HfId): ElementHandle;
  getSelection(): string[];
  /** Replace the current selection; fires selectionchange. Pass [] to clear. */
  setSelection(ids: string[]): void;

  // ── Advanced / agent layer (F10 layer 2) ──────────────────────────────────
  dispatch(op: EditOp, opts?: { origin?: unknown }): void;
  batch(fn: () => void, opts?: { origin?: unknown }): void;
  /**
   * Dry-run validation — would dispatch(op) succeed?
   * Returns {ok:true} when dispatch would mutate the document, {ok:false,code,message} otherwise.
   * Use as a feature-detection gate: `const r = comp.can(op); if (!r.ok) return;`
   * Phase 3b ops return {ok:false,code:'E_NO_GSAP_TIMELINE'} until parser engine ships.
   */
  can(op: EditOp): CanResult;

  // ── Events (one typed emitter — F10) ──────────────────────────────────────
  on(event: "change", handler: () => void): () => void;
  on(event: "selectionchange", handler: (ids: string[]) => void): () => void;
  on(event: "patch", handler: (event: PatchEvent) => void): () => void;
  on(event: "persist:error", handler: (event: PersistErrorEvent) => void): () => void;

  // ── Serialization ──────────────────────────────────────────────────────────
  /** stripRuntime removes an embedded preview-runtime script — for a host driving its own clock. */
  serialize(opts?: { stripRuntime?: boolean }): string;

  // ── T3 embedded-mode extras ────────────────────────────────────────────────
  /** Current override-set — serialize for host storage */
  getOverrides(): OverrideSet;
  /** Apply inverse patches from host undo stack; auto-tags origin: ORIGIN_APPLY_PATCHES */
  applyPatches(patches: readonly JsonPatchOp[], opts?: { origin?: unknown }): void;

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  /** Drain the persist queue — resolves when any queued write is committed. No-op if no adapter. */
  flush(): Promise<void>;
  dispose(): void;
}
