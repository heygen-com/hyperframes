/**
 * SDK shadow dispatch utilities for Stage 7 Step 3b.
 *
 * Shadow mode keeps the server patch path authoritative while also dispatching
 * the equivalent op to the SDK session, then compares the result to detect
 * addressing gaps (blocker E: no-hf-id elements) and serialization drift
 * (blocker B: linkedom whole-doc serialize). Results are reported as structured
 * mismatches for telemetry — no user-visible change.
 */

import type { Composition } from "@hyperframes/sdk";
import type { EditOp, GsapTweenSpec } from "@hyperframes/sdk";
import { STUDIO_SDK_SHADOW_ENABLED } from "../components/editor/manualEditingAvailability";
import { trackStudioEvent } from "./studioTelemetry";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import type { PatchOperation } from "./sourcePatcher";

// ─── Op mapping ──────────────────────────────────────────────────────────────

/**
 * Map Studio PatchOperations for a given hf-id to SDK EditOps.
 *
 * Multiple inline-style ops are coalesced into a single setStyle (SDK batches
 * style changes naturally). One SDK op is emitted per non-style op.
 */
// "attribute" PatchOperations carry the data- attribute NAME. Studio passes
// some already prefixed (e.g. "data-hf-studio-path-offset") and some bare
// (e.g. "name"); prefix only when needed, never double-prefix.
function attrName(property: string): string {
  return property.startsWith("data-") ? property : `data-${property}`;
}

// The SDK element model excludes data-hf-* attributes (document.ts skips them),
// so shadowing studio-internal markers (data-hf-studio-path-offset, etc.) can
// never match — drop those ops from the shadow instead of false-mismatching.
function isShadowableOp(op: PatchOperation): boolean {
  if (op.type === "attribute") return !attrName(op.property).startsWith("data-hf-");
  if (op.type === "html-attribute") return !op.property.startsWith("data-hf-");
  return true;
}

// PatchOperation types patchOpsToSdkEditOps knows how to map. Used by
// runShadowDispatch to flag any unmapped type as visible telemetry rather than
// silently dropping it (see the unmapped_type guard there).
const MAPPED_PATCH_OP_TYPES: ReadonlySet<string> = new Set([
  "inline-style",
  "text-content",
  "attribute",
  "html-attribute",
]);

export function patchOpsToSdkEditOps(hfId: string, ops: PatchOperation[]): EditOp[] {
  const result: EditOp[] = [];
  const styles: Record<string, string | null> = {};
  let hasStyles = false;

  for (const op of ops) {
    if (op.type === "inline-style") {
      styles[op.property] = op.value;
      hasStyles = true;
    } else if (op.type === "text-content") {
      result.push({ type: "setText", target: hfId, value: op.value ?? "" });
    } else if (op.type === "attribute") {
      result.push({
        type: "setAttribute",
        target: hfId,
        name: attrName(op.property),
        value: op.value,
      });
    } else if (op.type === "html-attribute") {
      result.push({ type: "setAttribute", target: hfId, name: op.property, value: op.value });
    }
    // unknown op types produce no SDK op
  }

  if (hasStyles) {
    result.unshift({ type: "setStyle", target: hfId, styles });
  }

  return result;
}

// ─── Shadow result types ──────────────────────────────────────────────────────

export interface SdkShadowMismatch {
  kind: "element_not_found" | "value_mismatch" | "dispatch_error";
  hfId: string;
  property?: string;
  expected?: string | null;
  actual?: string | null | undefined;
  error?: string;
}

export interface SdkShadowResult {
  /** False if the element was not found in the SDK session. */
  dispatched: boolean;
  mismatches: SdkShadowMismatch[];
}

// ─── Shadow dispatch ──────────────────────────────────────────────────────────

type ElementSnapshot = ReturnType<Composition["getElement"]>;
type OpFields = {
  property: string;
  expected: string | null | undefined;
  actual: string | null | undefined;
};

type FlatSnapshot = {
  styles: Record<string, string | null>;
  attrs: Record<string, string | null>;
  text: string | null;
};

function flattenSnapshot(snap: ElementSnapshot): FlatSnapshot {
  return {
    styles: snap?.inlineStyles ?? {},
    attrs: Object.fromEntries(
      Object.entries(snap?.attributes ?? {}).map(([k, v]) => [k, v ?? null]),
    ),
    text: snap?.text ?? null,
  };
}

type OpFieldResolver = (op: PatchOperation, flat: FlatSnapshot) => OpFields;

// Snapshot inlineStyles are camelCase (CSSStyleDeclaration convention); PatchOperation
// style properties are kebab-case ("background-color"). Convert for read-back, else
// every hyphenated property false-mismatches against a null actual.
function kebabToCamel(prop: string): string {
  return prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

// Text parity: the SDK snapshot.text is trimmed, so trim the op value too.
// An empty string and absent text (null) are treated as equivalent (collapsed
// to null) so "" vs null does not flag — both mean "no text content".
function normalizeText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

const OP_FIELD_RESOLVERS: Record<string, OpFieldResolver> = {
  "inline-style": (op, flat) => ({
    property: op.property,
    expected: op.value,
    actual: flat.styles[kebabToCamel(op.property)] ?? flat.styles[op.property] ?? null,
  }),
  // snapshot.text is already TRIMMED; trim the expected op value to match, so
  // trailing-whitespace differences don't flag. Empty-vs-absent ("" vs null) is
  // collapsed in checkOpParity. A genuinely different text value still flags.
  "text-content": (op, flat) => ({
    property: "text",
    expected: normalizeText(op.value),
    actual: normalizeText(flat.text),
  }),
  attribute: (op, flat) => ({
    property: attrName(op.property),
    expected: op.value ?? null,
    actual: flat.attrs[attrName(op.property)] ?? null,
  }),
  "html-attribute": (op, flat) => ({
    property: op.property,
    expected: op.value ?? null,
    actual: flat.attrs[op.property] ?? null,
  }),
};

function resolveOpFields(op: PatchOperation, flat: FlatSnapshot): OpFields | null {
  return OP_FIELD_RESOLVERS[op.type]?.(op, flat) ?? null;
}

function checkOpParity(
  op: PatchOperation,
  flat: FlatSnapshot,
  hfId: string,
): SdkShadowMismatch | null {
  const fields = resolveOpFields(op, flat);
  if (!fields || fields.actual === fields.expected) return null;
  return { kind: "value_mismatch", hfId, ...fields };
}

/**
 * Dispatch PatchOperations to the SDK session and return a parity report.
 *
 * If the element is not found by hfId, returns dispatched:false with a
 * element_not_found mismatch (signals blocker E — element has no hf-id or
 * SDK can't address it).
 *
 * On success, verifies that the SDK element snapshot reflects the applied
 * values. Value mismatches indicate serialization or normalization drift.
 *
 * **persist:error drift risk**: the HTTP adapter fires persist:error on
 * network failure but the SDK session is already mutated at that point. If
 * the server file was not updated (e.g. 503), subsequent shadow parity
 * comparisons here will see a diverged SDK session and produce false
 * positives. Before flipping STUDIO_SDK_DISPATCH_ENABLED, verify the shadow
 * window is clear of persist:error events.
 */

export function sdkShadowDispatch(
  session: Composition,
  hfId: string,
  ops: PatchOperation[],
): SdkShadowResult {
  if (!session.getElement(hfId)) {
    return { dispatched: false, mismatches: [{ kind: "element_not_found", hfId }] };
  }
  // Drop studio-internal markers the SDK model can't represent (data-hf-*), so
  // canvas-drag/path-offset edits don't false-mismatch on bookkeeping attrs.
  const shadowable = ops.filter(isShadowableOp);
  try {
    const sdkOps = patchOpsToSdkEditOps(hfId, shadowable);
    session.batch(() => {
      for (const op of sdkOps) session.dispatch(op);
    });
  } catch (err) {
    return {
      dispatched: false,
      mismatches: [{ kind: "dispatch_error", hfId, error: String(err) }],
    };
  }
  const flat = flattenSnapshot(session.getElement(hfId));
  const mismatches = shadowable
    .map((op) => checkOpParity(op, flat, hfId))
    .filter((m): m is SdkShadowMismatch => m !== null);
  return { dispatched: true, mismatches };
}

// ─── Telemetry reporting ──────────────────────────────────────────────────────

/**
 * Shadow-dispatch ops to the SDK session and emit sdk_shadow_dispatch telemetry.
 * Despite the telemetry focus, this function does mutate the SDK session — it
 * is not read-only. No-op when STUDIO_SDK_SHADOW_ENABLED is false.
 */
// Property-path mismatches carry user content (inline-style values, edited
// text) in expected/actual. Scrub before telemetry: fully redact text-content
// values, length-cap the rest. The in-memory parity result keeps raw values.
function redactValueForTelemetry(
  property: string | undefined,
  value: string | null | undefined,
): string | null | undefined {
  if (value == null) return value;
  if (property === "text") return `[redacted len=${value.length}]`;
  return value.length > 64 ? `${value.slice(0, 64)}…` : value;
}

function redactMismatchesForTelemetry(mismatches: SdkShadowMismatch[]): SdkShadowMismatch[] {
  return mismatches.map((m) => ({
    ...m,
    expected: redactValueForTelemetry(m.property, m.expected),
    actual: redactValueForTelemetry(m.property, m.actual),
  }));
}

export function runShadowDispatch(
  session: Composition,
  selection: DomEditSelection,
  ops: PatchOperation[],
): void {
  if (!STUDIO_SDK_SHADOW_ENABLED) return;
  const hfId = selection.hfId;
  if (!hfId) {
    trackStudioEvent("sdk_shadow_dispatch", {
      op: "property",
      dispatched: false,
      reason: "no_hf_id",
      mismatchCount: 0,
    });
    return;
  }
  // Defensive: patchOpsToSdkEditOps silently drops PatchOperation types it
  // doesn't map. PatchOperation.type is a closed union today, but emit a visible
  // unmapped_type event if a future type ever slips through, so the gap surfaces
  // in telemetry instead of vanishing.
  // Map to the type string before find, so a future unmapped type is read as a
  // plain string (no object cast; find on the closed union narrows to never).
  const unmappedType = ops.map((op) => op.type).find((t) => !MAPPED_PATCH_OP_TYPES.has(t));
  if (unmappedType !== undefined) {
    trackStudioEvent("sdk_shadow_dispatch", {
      op: "property",
      dispatched: false,
      reason: "unmapped_type",
      type: unmappedType,
      mismatchCount: 0,
    });
    return;
  }
  const result = sdkShadowDispatch(session, hfId, ops);
  trackStudioEvent("sdk_shadow_dispatch", {
    op: "property",
    dispatched: result.dispatched,
    mismatchCount: result.mismatches.length,
    mismatches: JSON.stringify(redactMismatchesForTelemetry(result.mismatches)),
  });
}

// ─── Shadow for non-PatchOperation ops (delete / timing / GSAP) ───────────────
//
// These ops never flow through persistDomEditOperations, so the property-path
// shadow above never sees them. Each runner keeps the server authoritative and
// only observes the SDK: can() pre-checks addressing/validity (pure, no
// mutation — works even for GSAP, which has no element-snapshot value), then a
// dispatch into the live session with a snapshot-based parity check.
//
// Parity coverage by op:
//   delete  → getElement(id) === null               (full)
//   timing  → snapshot.start/duration/trackIndex     (full)
//   gsap    → tween id present/absent in animationIds (existence only — the
//             tween's property values are script-level, not in the snapshot)

/**
 * can()-gated shadow dispatch. Emits sdk_shadow_dispatch tagged with `opLabel`.
 * Mutates the SDK session (not read-only); server stays authoritative.
 * No-op when STUDIO_SDK_SHADOW_ENABLED is false.
 */
function runShadowEditOp(
  session: Composition,
  op: EditOp,
  opLabel: string,
  dispatchAndCheck: () => SdkShadowMismatch[],
): void {
  const verdict = session.can(op);
  if (!verdict.ok) {
    trackStudioEvent("sdk_shadow_dispatch", {
      op: opLabel,
      dispatched: false,
      reason: "cannot_dispatch",
      code: verdict.code,
      mismatchCount: 0,
    });
    return;
  }
  let mismatches: SdkShadowMismatch[];
  try {
    mismatches = dispatchAndCheck();
  } catch (err) {
    trackStudioEvent("sdk_shadow_dispatch", {
      op: opLabel,
      dispatched: false,
      reason: "dispatch_error",
      error: String(err),
      mismatchCount: 0,
    });
    return;
  }
  trackStudioEvent("sdk_shadow_dispatch", {
    op: opLabel,
    dispatched: true,
    mismatchCount: mismatches.length,
    mismatches: JSON.stringify(mismatches),
  });
}

/** Shadow an element delete. Parity: the element is gone from the SDK session. */
export function runShadowDelete(session: Composition, hfId: string | null | undefined): void {
  if (!STUDIO_SDK_SHADOW_ENABLED) return;
  if (!hfId) {
    trackStudioEvent("sdk_shadow_dispatch", {
      op: "delete",
      dispatched: false,
      reason: "no_hf_id",
      mismatchCount: 0,
    });
    return;
  }
  const op: EditOp = { type: "removeElement", target: hfId };
  runShadowEditOp(session, op, "delete", () => {
    session.batch(() => session.dispatch(op));
    return session.getElement(hfId)
      ? [
          {
            kind: "value_mismatch",
            hfId,
            property: "exists",
            expected: "removed",
            actual: "present",
          },
        ]
      : [];
  });
}

export interface ShadowTiming {
  start?: number;
  duration?: number;
  trackIndex?: number;
}

// Timing start/duration are computed arithmetically by the SDK (e.g. 21.36 -
// 0 + drag delta) but stored as a rounded literal server-side, so exact compare
// flags float-precision noise like 3.1 vs 3.0999999999999996 (~1e-16). Compare
// with a relative epsilon; a genuinely different value (3.1 vs 3.5) still flags.
// trackIndex is an integer track slot — compared exactly by the caller.
function timingValuesEqual(a: number, b: number): boolean {
  if (a === b) return true;
  return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
}

// start/duration tolerate float-precision drift; trackIndex (integer slot) is exact.
function timingFieldEqual(
  key: keyof ShadowTiming,
  actual: number | null | undefined,
  expected: number,
): boolean {
  if (typeof actual === "number" && key !== "trackIndex") {
    return timingValuesEqual(actual, expected);
  }
  return actual === expected;
}

/** Shadow a timing edit. Parity: snapshot start/duration/trackIndex match. */
export function runShadowTiming(
  session: Composition,
  hfId: string | null | undefined,
  timing: ShadowTiming,
): void {
  if (!STUDIO_SDK_SHADOW_ENABLED) return;
  if (!hfId) {
    trackStudioEvent("sdk_shadow_dispatch", {
      op: "timing",
      dispatched: false,
      reason: "no_hf_id",
      mismatchCount: 0,
    });
    return;
  }
  const op: EditOp = { type: "setTiming", target: hfId, ...timing };
  runShadowEditOp(session, op, "timing", () => {
    session.batch(() => session.dispatch(op));
    const el = session.getElement(hfId);
    const mismatches: SdkShadowMismatch[] = [];
    const fields: Array<[keyof ShadowTiming, number | null | undefined]> = [
      ["start", el?.start],
      ["duration", el?.duration],
      ["trackIndex", el?.trackIndex],
    ];
    for (const [key, actual] of fields) {
      const expected = timing[key];
      if (expected === undefined || timingFieldEqual(key, actual, expected)) continue;
      mismatches.push({
        kind: "value_mismatch",
        hfId,
        property: key,
        expected: String(expected),
        actual: actual == null ? null : String(actual),
      });
    }
    return mismatches;
  });
}

export type ShadowGsapOp =
  | { kind: "add"; target: string; tween: GsapTweenSpec }
  | { kind: "set"; animationId: string; properties: Partial<GsapTweenSpec> }
  | { kind: "remove"; animationId: string };

/**
 * Shadow a GSAP tween mutation (add / set / remove). The server's animationId
 * shares the SDK's id-space (both derive `targetSelector-method-position` from
 * the same acorn parser — see sdk assignStableIds), so it is dispatchable as-is.
 *
 * Parity via the now-populated ElementSnapshot.animationIds:
 *   add    → the returned tween id is present on the target element
 *   remove → the id is gone from every element
 *   set    → existence only (the SDK exposes no per-tween property reader; value
 *            fidelity would need serialize()-script round-trip diffing).
 */
export function runShadowGsapTween(session: Composition, gsapOp: ShadowGsapOp): void {
  if (!STUDIO_SDK_SHADOW_ENABLED) return;
  const op: EditOp =
    gsapOp.kind === "add"
      ? { type: "addGsapTween", target: gsapOp.target, tween: gsapOp.tween }
      : gsapOp.kind === "set"
        ? { type: "setGsapTween", animationId: gsapOp.animationId, properties: gsapOp.properties }
        : { type: "removeGsapTween", animationId: gsapOp.animationId };
  // fallow-ignore-next-line complexity
  runShadowEditOp(session, op, "gsap", () => {
    let newId: string | undefined;
    session.batch(() => {
      if (gsapOp.kind === "add") newId = session.addGsapTween(gsapOp.target, gsapOp.tween);
      else session.dispatch(op);
    });
    if (gsapOp.kind === "add") {
      const onTarget = session.getElement(gsapOp.target)?.animationIds ?? [];
      if (!newId || !onTarget.includes(newId)) {
        return [
          {
            kind: "value_mismatch",
            hfId: gsapOp.target,
            property: "animationIds",
            expected: newId ?? "non-empty",
            actual: onTarget.join(",") || null,
          },
        ];
      }
    } else if (gsapOp.kind === "remove") {
      const stillPresent = session
        .getElements()
        .some((el) => el.animationIds.includes(gsapOp.animationId));
      if (stillPresent) {
        return [
          {
            kind: "value_mismatch",
            hfId: gsapOp.animationId,
            property: "animationIds",
            expected: "removed",
            actual: "present",
          },
        ];
      }
    }
    return [];
  });
}

// GSAP value-fidelity diff lives in its own module to keep this file under the
// 600-line studio cap; re-exported here so the shadow surface stays in one place.
export {
  gsapFidelityMismatches,
  resolveGsapFidelityArgs,
  runShadowGsapFidelity,
} from "./sdkShadowGsapFidelity";
