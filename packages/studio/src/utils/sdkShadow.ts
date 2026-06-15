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
import type { EditOp } from "@hyperframes/sdk";
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
        name: op.property.startsWith("data-") ? op.property : `data-${op.property}`,
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
  kind: "element_not_found" | "value_mismatch";
  hfId: string;
  property?: string;
  expected?: string | null;
  actual?: string | null | undefined;
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

const OP_FIELD_RESOLVERS: Record<string, OpFieldResolver> = {
  "inline-style": (op, flat) => ({
    property: op.property,
    expected: op.value,
    actual: flat.styles[op.property] ?? null,
  }),
  "text-content": (op, flat) => ({ property: "text", expected: op.value ?? "", actual: flat.text }),
  attribute: (op, flat) => {
    const attrName = op.property.startsWith("data-") ? op.property : `data-${op.property}`;
    return {
      property: attrName,
      expected: op.value ?? null,
      actual: flat.attrs[attrName] ?? null,
    };
  },
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
 */

export function sdkShadowDispatch(
  session: Composition,
  hfId: string,
  ops: PatchOperation[],
): SdkShadowResult {
  if (!session.getElement(hfId)) {
    return { dispatched: false, mismatches: [{ kind: "element_not_found", hfId }] };
  }
  for (const op of patchOpsToSdkEditOps(hfId, ops)) {
    session.dispatch(op);
  }
  const flat = flattenSnapshot(session.getElement(hfId));
  const mismatches = ops
    .map((op) => checkOpParity(op, flat, hfId))
    .filter((m): m is SdkShadowMismatch => m !== null);
  return { dispatched: true, mismatches };
}

// ─── Telemetry reporting ──────────────────────────────────────────────────────

/**
 * Shadow-dispatch ops to the SDK session and emit sdk_shadow_dispatch telemetry.
 * No-op when STUDIO_SDK_SHADOW_ENABLED is false.
 */
export function reportShadowDispatch(
  session: Composition,
  selection: DomEditSelection,
  ops: PatchOperation[],
): void {
  if (!STUDIO_SDK_SHADOW_ENABLED) return;
  const hfId = selection.hfId;
  if (!hfId) {
    trackStudioEvent("sdk_shadow_dispatch", {
      dispatched: false,
      reason: "no_hf_id",
      mismatchCount: 0,
    });
    return;
  }
  const result = sdkShadowDispatch(session, hfId, ops);
  trackStudioEvent("sdk_shadow_dispatch", {
    dispatched: result.dispatched,
    mismatchCount: result.mismatches.length,
    mismatches: JSON.stringify(result.mismatches),
  });
}
