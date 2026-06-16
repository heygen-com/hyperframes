/**
 * GSAP value-fidelity shadow (serialize round-trip diff). Split out of
 * sdkShadow.ts to keep that file under the 600-line studio cap.
 *
 * Existence parity (sdkShadow.ts) confirms a tween was created/removed, but not
 * that its VALUES (duration / ease / position / properties) match the server.
 * The SDK exposes no per-tween property reader, so we compare the two writers'
 * output: apply the same op to a fresh SDK doc opened from the server's pre-op
 * file, then structurally diff the SDK's GSAP script against the server's
 * resulting script. Both are re-parsed, so formatting/whitespace differences
 * never produce false positives — only real value drift does.
 */

import { openComposition } from "@hyperframes/sdk";
import { parseGsapScriptAcorn } from "@hyperframes/core/gsap-parser-acorn";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { STUDIO_SDK_SHADOW_ENABLED } from "../components/editor/manualEditingAvailability";
import { trackStudioEvent } from "./studioTelemetry";
import { relEqual } from "./sdkShadowNumeric";
import type { SdkShadowMismatch, ShadowGsapOp } from "./sdkShadow";

// Marker set must match document.ts extractGsapScript so both pick the same
// <script> from any given composition.
function isGsapScriptBody(body: string): boolean {
  return body.includes("gsap") || body.includes("__timelines") || body.includes("ScrollTrigger");
}

export function extractGsapScript(html: string): string | null {
  // Close tag is `</script[^>]*>` (not just `</script>`) — HTML5 ignores junk
  // before the `>`, e.g. `</script >` or `</script foo>` (CodeQL js/bad-tag-filter).
  const scripts = html.match(/<script\b[^>]*>([\s\S]*?)<\/script[^>]*>/gi);
  if (!scripts) return null;
  for (const block of scripts) {
    const body = block.replace(/^<script\b[^>]*>/i, "").replace(/<\/script[^>]*>$/i, "");
    if (isGsapScriptBody(body)) return body;
  }
  return null;
}

function posKey(position: unknown): string {
  if (typeof position === "number") return String(position);
  const n = Number(position);
  return Number.isNaN(n) ? String(position) : String(n);
}

// Key a tween by its RESOLVED target element (not raw selector) + method +
// position. The SDK writer emits [data-hf-id="X"] selectors while the server
// emits class/other selectors for the SAME element; keying by resolved element
// matches them so the diff compares values instead of flagging present/absent.
//
// ponytail: one-tween-per-(element, method, position) assumption — coincident
// tweens (same element+method+position, different props) collapse, last wins,
// so the diff under-reports them. Props can't go in the key (a matched pair
// must share a key for the field-diff to run; raw props would split real value
// drift into present/absent). Not seen in studio-emitted templates; add a
// property-NAME hash to the key if coincident tweens show up in the wild.
function tweenKey(anim: GsapAnimation, resolveSelector?: (sel: string) => string): string {
  const sel = resolveSelector ? resolveSelector(anim.targetSelector) : anim.targetSelector;
  return `${sel}|${anim.method}|${posKey(anim.position)}`;
}

function animByKey(
  script: string,
  resolveSelector?: (sel: string) => string,
): Map<string, GsapAnimation> {
  const map = new Map<string, GsapAnimation>();
  const parsed = parseGsapScriptAcorn(script);
  for (const anim of parsed.animations) map.set(tweenKey(anim, resolveSelector), anim);
  return map;
}

// The server (addAnimationToScript) and SDK (gsapWriterAcorn) are DIFFERENT
// writers, so the same tween can serialize with different property key order or
// number-vs-string forms. Compare canonically — sort keys, coerce numeric
// strings — so only real value drift registers, not formatting differences.

// Coerce string operands to numbers, then compare with the shared relative
// epsilon (relEqual) so float-formatting noise (3.1 vs 3.0999999999999996)
// isn't flagged as drift while a real 2 vs 1 still is.
function numericEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const na = typeof a === "string" ? Number(a) : a;
  const nb = typeof b === "string" ? Number(b) : b;
  if (typeof na !== "number" || typeof nb !== "number" || Number.isNaN(na) || Number.isNaN(nb)) {
    return false;
  }
  return relEqual(na, nb);
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
 * Structurally diff two GSAP scripts. Tweens are matched by resolved target
 * element + method + position (see tweenKey), so the SDK's [data-hf-id]
 * selectors and the server's class selectors for the same element don't
 * false-flag present/absent. Reports a tween present in one but not the other,
 * and per-field value drift (duration, ease, properties, fromProperties).
 * Comparison is canonical so writer formatting differences don't register.
 *
 * Pass resolveSelector (selector → canonical element id) to enable the
 * element-based matching; without it, matching falls back to raw selector.
 */
// fallow-ignore-next-line complexity
export function gsapFidelityMismatches(
  sdkScript: string,
  serverScript: string,
  resolveSelector?: (sel: string) => string,
): SdkShadowMismatch[] {
  const sdk = animByKey(sdkScript, resolveSelector);
  const server = animByKey(serverScript, resolveSelector);
  const mismatches: SdkShadowMismatch[] = [];
  const keys = new Set([...sdk.keys(), ...server.keys()]);
  for (const key of keys) {
    const a = sdk.get(key);
    const b = server.get(key);
    if (!a || !b) {
      mismatches.push({
        kind: "value_mismatch",
        hfId: key,
        property: "tween",
        expected: b ? "present" : "absent",
        actual: a ? "present" : "absent",
      });
      continue;
    }
    // method + position are part of the key (already equal); compare values.
    const fields: Array<[string, unknown, unknown, boolean]> = [
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
          hfId: key,
          property,
          expected: bv == null ? null : JSON.stringify(bv),
          actual: av == null ? null : JSON.stringify(av),
        });
      }
    }
  }
  return mismatches;
}

export interface GsapFidelityArgs {
  before: string;
  op: ShadowGsapOp;
  serverScript: string;
}

/**
 * Wiring gate for the commitMutation chokepoint: return the narrowed fidelity
 * args only when there is a live session, a typed shadow op, and both the
 * pre-op file and the server's resulting script to diff against (scriptText is
 * null when the composition has no GSAP script). Returns null otherwise. Pure +
 * narrowing so the wiring decision is unit-testable without rendering the hook
 * and the caller needs no non-null assertions.
 */
export function resolveGsapFidelityArgs(
  sdkSession: unknown,
  shadowGsapOp: ShadowGsapOp | undefined,
  before: string | null | undefined,
  serverScript: string | null | undefined,
): GsapFidelityArgs | null {
  if (!sdkSession || !shadowGsapOp || before == null || serverScript == null) return null;
  return { before, op: shadowGsapOp, serverScript };
}

// Resolve a CSS selector to a canonical element key using the pre-op document,
// so tweens that target the same element via different selectors
// ([data-hf-id="X"] vs .X vs #X) collapse to one key in the fidelity diff.
//
// The SDK writer emits [data-hf-id="X"] while the server may emit a class/id
// selector for the SAME element. Keying both forms to the same node prevents a
// false present/absent mismatch. Resolution order, for whatever element the
// selector matches:
//   1. data-hf-id present  → "hfid:<id>"  (the common, stable case)
//   2. no data-hf-id       → "node:<n>"   (per-document node index; identical
//      regardless of which selector form found the node, so .x and [data-hf-id]
//      pointing at the same attribute-less node still collapse)
//   3. selector resolves to no node / parse error / no DOM → the raw selector
//      (last resort; only diverges when the two writers genuinely target
//      different — or unresolvable — nodes, which is real drift to surface)
// The "hfid:"/"node:" prefixes are namespaced so a canonical key can never
// collide with a raw-selector fallback.
//
// ponytail: first-match heuristic — querySelector returns the FIRST match, so an
// ambiguous selector (e.g. .x shared by two elements) may map to a different
// node than the SDK side's [data-hf-id] target and still flag present/absent.
// Safe for studio templates (one tween per element); upgrade to querySelectorAll
// + uniqueness check if ambiguous selectors appear.
export function makeSelectorResolver(html: string): (sel: string) => string {
  let doc: Document | null = null;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    doc = null;
  }
  // Stable per-node index so an attribute-less element keys identically no
  // matter which selector form (class vs id vs [data-hf-id]) resolved it.
  const nodeKeys = new WeakMap<Element, string>();
  let nextNode = 0;
  const keyForNode = (el: Element): string => {
    const hfId = el.getAttribute("data-hf-id");
    if (hfId != null && hfId !== "") return `hfid:${hfId}`;
    const existing = nodeKeys.get(el);
    if (existing != null) return existing;
    const key = `node:${nextNode++}`;
    nodeKeys.set(el, key);
    return key;
  };
  return (sel) => {
    if (!doc) return sel;
    try {
      const el = doc.querySelector(sel);
      return el ? keyForNode(el) : sel;
    } catch {
      return sel;
    }
  };
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
    const mismatches = gsapFidelityMismatches(
      sdkScript,
      serverScript,
      makeSelectorResolver(beforeHtml),
    );
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
