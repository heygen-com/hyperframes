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
import type { SdkShadowMismatch, ShadowGsapOp } from "./sdkShadow";

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
