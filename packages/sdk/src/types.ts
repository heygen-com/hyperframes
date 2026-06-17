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
  /** Direct text node content (not descendant text) */
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
 */
export type OverrideSet = Record<string, string | number | boolean | null>;

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
  | { type: "setClassStyle"; selector: string; styles: Record<string, string | null> }
  | { type: "setCompositionMetadata"; width?: number; height?: number; duration?: number }
  | { type: "setVariableValue"; id: string; value: string | number | boolean }
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
    };

export interface ElasticHold {
  start: number;
  end: number;
  fill: "freeze" | "loop";
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
  setVariableValue(id: string, value: string | number | boolean): void;
  /** Returns the newly-assigned tween ID */
  addGsapTween(target: HfId, tween: GsapTweenSpec): string;
  setGsapTween(animationId: string, properties: Partial<GsapTweenSpec>): void;
  removeGsapTween(animationId: string): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;

  // ── Query API (F1) ─────────────────────────────────────────────────────────
  getElements(): ElementSnapshot[];
  getElement(id: HfId): ElementSnapshot | null;
  find(query: FindQuery): string[];

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
  serialize(): string;

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
