/**
 * SDK resolver-parity tripwire (telemetry-only).
 *
 * Checks whether the SDK session resolves the same element id the server
 * patch path would target, then optionally verifies value parity after an
 * in-memory dispatch. Emits `sdk_resolver_shadow` on any divergence.
 *
 * Headline signal: `element_not_found` — the resolver divergence class that
 * caused the v0.6.110 regression. The writer-parity suite (#1533) cannot see
 * this class; this tripwire exists specifically to catch it.
 *
 * Decoupled from `STUDIO_SDK_CUTOVER_ENABLED`. Gated by its own flag
 * `STUDIO_SDK_RESOLVER_SHADOW_ENABLED` (default false). Telemetry-only —
 * never writes to disk, never affects the user-visible edit.
 */

import type { Composition } from "@hyperframes/sdk";
import type { PatchOperation } from "./sourcePatcher";
import { STUDIO_SDK_RESOLVER_SHADOW_ENABLED } from "../components/editor/manualEditingAvailability";
import { patchOpsToSdkEditOps } from "./sdkCutover";
import { trackStudioEvent } from "./studioTelemetry";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SdkResolverMismatch {
  kind: "element_not_found" | "value_mismatch" | "dispatch_error";
  hfId: string;
  property?: string;
  expected?: string | null;
  actual?: string | null | undefined;
  error?: string;
}

// ─── Op helpers ───────────────────────────────────────────────────────────────

// Drop studio-internal data-hf-* markers the SDK model doesn't represent.
function isShadowableOp(op: PatchOperation): boolean {
  const name =
    op.type === "attribute"
      ? op.property.startsWith("data-")
        ? op.property
        : `data-${op.property}`
      : op.type === "html-attribute"
        ? op.property
        : null;
  return name === null || !name.startsWith("data-hf-");
}

const MAPPED_OP_TYPES = new Set(["inline-style", "text-content", "attribute", "html-attribute"]);

// ─── Read-back helpers ────────────────────────────────────────────────────────

function kebabToCamel(prop: string): string {
  return prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function normalizeText(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

type FlatEl = NonNullable<ReturnType<Composition["getElement"]>>;
type AttrMap = Record<string, string | null>;

function checkStyleOp(
  op: PatchOperation,
  el: FlatEl,
): { expected: string | null; actual: string | null } {
  return {
    expected: op.value ?? null,
    actual: el.inlineStyles[kebabToCamel(op.property)] ?? el.inlineStyles[op.property] ?? null,
  };
}

function checkTextOp(
  op: PatchOperation,
  el: FlatEl,
): { expected: string | null; actual: string | null } {
  return { expected: normalizeText(op.value), actual: normalizeText(el.text) };
}

function checkAttrOp(
  op: PatchOperation,
  el: FlatEl,
): { property: string; expected: string | null; actual: string | null } {
  const property =
    op.type === "attribute"
      ? op.property.startsWith("data-")
        ? op.property
        : `data-${op.property}`
      : op.property;
  return {
    property,
    expected: op.value ?? null,
    actual: (el.attributes as AttrMap)[property] ?? null,
  };
}

function checkOpValue(op: PatchOperation, el: FlatEl, hfId: string): SdkResolverMismatch | null {
  let property: string;
  let expected: string | null;
  let actual: string | null;

  if (op.type === "inline-style") {
    property = op.property;
    ({ expected, actual } = checkStyleOp(op, el));
  } else if (op.type === "text-content") {
    property = "text";
    ({ expected, actual } = checkTextOp(op, el));
  } else if (op.type === "attribute" || op.type === "html-attribute") {
    ({ property, expected, actual } = checkAttrOp(op, el));
  } else {
    return null;
  }

  if (actual === expected) return null;
  return { kind: "value_mismatch", hfId, property, expected, actual };
}

// ─── Core check (pure — testable without flag) ────────────────────────────────

/**
 * Run the resolver shadow check against an already-open SDK session.
 *
 * Returns an array of mismatches (empty = parity). Mutates the session for
 * value-parity ops (dispatch + read-back), matching old shadow behaviour —
 * the server path remains authoritative for on-disk state.
 *
 * Exported for unit tests; call `runResolverShadow` at call sites.
 */
export function sdkResolverShadowCheck(
  session: Composition,
  hfId: string,
  ops: PatchOperation[],
): SdkResolverMismatch[] {
  if (!session.getElement(hfId)) {
    return [{ kind: "element_not_found", hfId }];
  }

  const shadowable = ops.filter(isShadowableOp);
  if (shadowable.length === 0) return [];

  // Silently skip op batches containing unmapped types — not a resolver bug.
  if (shadowable.some((op) => !MAPPED_OP_TYPES.has(op.type))) return [];

  try {
    const editOps = patchOpsToSdkEditOps(hfId, shadowable);
    session.batch(() => {
      for (const op of editOps) session.dispatch(op);
    });
  } catch (err) {
    return [{ kind: "dispatch_error", hfId, error: String(err) }];
  }

  const el = session.getElement(hfId);
  if (!el) return [{ kind: "element_not_found", hfId }];

  return shadowable
    .map((op) => checkOpValue(op, el, hfId))
    .filter((m): m is SdkResolverMismatch => m !== null);
}

// ─── Telemetry ────────────────────────────────────────────────────────────────

// Redact all user-content values before telemetry: style values and text both
// carry user data. Keep only the length so we can detect truncation without
// leaking the actual bytes.
function redactValue(value: string | null | undefined): string | null | undefined {
  if (value == null) return value;
  return `[redacted len=${value.length}]`;
}

function redactMismatches(mismatches: SdkResolverMismatch[]): SdkResolverMismatch[] {
  return mismatches.map((m) => ({
    ...m,
    expected: redactValue(m.expected),
    actual: redactValue(m.actual),
  }));
}

/**
 * Run the resolver shadow and emit `sdk_resolver_shadow` telemetry.
 * No-op when `STUDIO_SDK_RESOLVER_SHADOW_ENABLED` is false.
 * Never throws — any exception inside the shadow is swallowed.
 */
export function runResolverShadow(
  session: Composition,
  hfId: string | null | undefined,
  ops: PatchOperation[],
): void {
  if (!STUDIO_SDK_RESOLVER_SHADOW_ENABLED) return;
  if (!hfId) return;
  try {
    const mismatches = sdkResolverShadowCheck(session, hfId, ops);
    trackStudioEvent("sdk_resolver_shadow", {
      hfId,
      mismatchCount: mismatches.length,
      mismatches: JSON.stringify(redactMismatches(mismatches)),
    });
  } catch {
    // never propagate from the shadow path
  }
}

// ─── Soak gate ────────────────────────────────────────────────────────────────

/**
 * Evaluate the soak-gate exit criterion.
 *
 * A clean soak window has zero `element_not_found` divergences. When that
 * condition holds, resolver parity is proven and the flag can be retired.
 */
export function evaluateSoakGate(divergenceCount: number): "parity-proven" | "divergence-detected" {
  return divergenceCount === 0 ? "parity-proven" : "divergence-detected";
}
