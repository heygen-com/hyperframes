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
import { openComposition } from "@hyperframes/sdk";
import { parseGsapScriptAcorn } from "@hyperframes/core/gsap-parser-acorn";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
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
        name: `data-${op.property}`,
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

const OP_FIELD_RESOLVERS: Record<string, OpFieldResolver> = {
  "inline-style": (op, flat) => ({
    property: op.property,
    expected: op.value,
    actual: flat.styles[op.property] ?? null,
  }),
  "text-content": (op, flat) => ({ property: "text", expected: op.value ?? "", actual: flat.text }),
  attribute: (op, flat) => ({
    property: `data-${op.property}`,
    expected: op.value ?? null,
    actual: flat.attrs[`data-${op.property}`] ?? null,
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
  try {
    const sdkOps = patchOpsToSdkEditOps(hfId, ops);
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
  const mismatches = ops
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
      if (expected !== undefined && actual !== expected) {
        mismatches.push({
          kind: "value_mismatch",
          hfId,
          property: key,
          expected: String(expected),
          actual: actual == null ? null : String(actual),
        });
      }
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

// ─── GSAP value fidelity (serialize round-trip diff) ──────────────────────────
//
// Existence parity (above) confirms a tween was created/removed, but not that
// its VALUES (duration / ease / position / properties) match the server. The
// SDK exposes no per-tween property reader, so we compare the two writers'
// output: apply the same op to a fresh SDK doc opened from the server's
// pre-op file, then structurally diff the SDK's GSAP script against the
// server's resulting script. Both are re-parsed, so formatting/whitespace
// differences never produce false positives — only real value drift does.

// Marker set must match document.ts extractGsapScript so both pick the same
// <script> from any given composition.
function isGsapScriptBody(body: string): boolean {
  return body.includes("gsap") || body.includes("__timelines") || body.includes("ScrollTrigger");
}

function extractGsapScript(html: string): string | null {
  const scripts = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi);
  if (!scripts) return null;
  for (const block of scripts) {
    const body = block.replace(/^<script\b[^>]*>/i, "").replace(/<\/script>$/i, "");
    if (isGsapScriptBody(body)) return body;
  }
  return null;
}

function animById(script: string): Map<string, GsapAnimation> {
  const map = new Map<string, GsapAnimation>();
  const parsed = parseGsapScriptAcorn(script);
  for (const anim of parsed.animations) map.set(anim.id, anim);
  return map;
}

// The server (addAnimationToScript) and SDK (gsapWriterAcorn) are DIFFERENT
// writers, so the same tween can serialize with different property key order or
// number-vs-string forms. Compare canonically — sort keys, coerce numeric
// strings — so only real value drift registers, not formatting differences.

function numericEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const na = typeof a === "string" ? Number(a) : a;
  const nb = typeof b === "string" ? Number(b) : b;
  return (
    typeof na === "number" &&
    typeof nb === "number" &&
    !Number.isNaN(na) &&
    !Number.isNaN(nb) &&
    na === nb
  );
}

function canonicalProps(obj: Record<string, unknown> | undefined): string {
  if (!obj) return "{}";
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    const v = obj[key];
    // normalize "0.5" → 0.5 so a number/string writer difference isn't drift
    out[key] = typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : v;
  }
  return JSON.stringify(out);
}

/**
 * Structurally diff two GSAP scripts by tween id. Reports a tween present in
 * one but not the other, and per-field value drift (method, position, duration,
 * ease, properties, fromProperties). Comparison is canonical (see above) so
 * writer formatting differences do not produce false mismatches.
 */
// fallow-ignore-next-line complexity
export function gsapFidelityMismatches(
  sdkScript: string,
  serverScript: string,
): SdkShadowMismatch[] {
  const sdk = animById(sdkScript);
  const server = animById(serverScript);
  const mismatches: SdkShadowMismatch[] = [];
  const ids = new Set([...sdk.keys(), ...server.keys()]);
  for (const id of ids) {
    const a = sdk.get(id);
    const b = server.get(id);
    if (!a || !b) {
      mismatches.push({
        kind: "value_mismatch",
        hfId: id,
        property: "tween",
        expected: b ? "present" : "absent",
        actual: a ? "present" : "absent",
      });
      continue;
    }
    // [property, sdk-value, server-value, equal?]
    const fields: Array<[string, unknown, unknown, boolean]> = [
      ["method", a.method, b.method, a.method === b.method],
      ["position", a.position, b.position, numericEqual(a.position, b.position)],
      ["duration", a.duration, b.duration, numericEqual(a.duration, b.duration)],
      ["ease", a.ease, b.ease, a.ease === b.ease],
      [
        "properties",
        a.properties,
        b.properties,
        canonicalProps(a.properties) === canonicalProps(b.properties),
      ],
      [
        "fromProperties",
        a.fromProperties,
        b.fromProperties,
        canonicalProps(a.fromProperties) === canonicalProps(b.fromProperties),
      ],
    ];
    for (const [property, av, bv, equal] of fields) {
      if (!equal) {
        mismatches.push({
          kind: "value_mismatch",
          hfId: id,
          property,
          expected: bv == null ? null : JSON.stringify(bv),
          actual: av == null ? null : JSON.stringify(av),
        });
      }
    }
  }
  return mismatches;
}

/**
 * Shadow GSAP value fidelity: open a fresh SDK doc from the server's pre-op
 * file, apply the same tween op, serialize, and diff the SDK's GSAP script
 * against the server's resulting script. Emits sdk_shadow_dispatch op:
 * "gsap_fidelity". Async, fire-and-forget; server stays authoritative.
 */
export async function runShadowGsapFidelity(
  beforeHtml: string,
  gsapOp: ShadowGsapOp,
  serverScript: string,
): Promise<void> {
  if (!STUDIO_SDK_SHADOW_ENABLED) return;
  // No server script to diff against → skip the (costly) openComposition.
  if (!serverScript || !beforeHtml) return;
  try {
    const session = await openComposition(beforeHtml);
    session.batch(() => {
      if (gsapOp.kind === "add") session.addGsapTween(gsapOp.target, gsapOp.tween);
      else if (gsapOp.kind === "set") session.setGsapTween(gsapOp.animationId, gsapOp.properties);
      else session.removeGsapTween(gsapOp.animationId);
    });
    const sdkScript = extractGsapScript(session.serialize());
    if (sdkScript == null) {
      trackStudioEvent("sdk_shadow_dispatch", {
        op: "gsap_fidelity",
        dispatched: false,
        reason: "no_sdk_script",
        mismatchCount: 0,
      });
      return;
    }
    const mismatches = gsapFidelityMismatches(sdkScript, serverScript);
    trackStudioEvent("sdk_shadow_dispatch", {
      op: "gsap_fidelity",
      dispatched: true,
      mismatchCount: mismatches.length,
      mismatches: JSON.stringify(mismatches),
    });
  } catch (err) {
    trackStudioEvent("sdk_shadow_dispatch", {
      op: "gsap_fidelity",
      dispatched: false,
      reason: "fidelity_error",
      error: String(err),
      mismatchCount: 0,
    });
  }
}
