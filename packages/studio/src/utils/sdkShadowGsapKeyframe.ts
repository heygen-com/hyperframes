/**
 * GSAP keyframe-op shadow (serialize round-trip diff). New module for the Stage 7
 * shadow-parity push — kept out of sdkShadow.ts / sdkShadowGsapFidelity.ts so the
 * shared files stay untouched (only additive imports) and the studio 600-line cap
 * holds.
 *
 * Unlike tweens, the SDK exposes NO keyframe reader on ElementSnapshot, so there
 * is no existence-parity path here. Instead we compare the two writers' output:
 * open a fresh SDK doc from the server's pre-op file, dispatch the equivalent
 * keyframe op, serialize, and diff the SDK's GSAP script against the server's
 * resulting script.
 *
 * gsapFidelityMismatches (reused) matches tweens by resolved target element +
 * method + position and diffs tween-level fields — but it does NOT look inside a
 * tween's `keyframes` array. Keyframe drift therefore needs a dedicated diff,
 * layered on top of the reused tween-level diff, matched by the GSAP animation id.
 *
 * SDK mapping (main, pre PR #1498 percentage-variant):
 *   add    → addGsapKeyframe{animationId, position: percentage, value: properties}
 *   remove → removeGsapKeyframe{animationId, keyframeIndex} — the studio op is
 *            percentage-based, so we resolve percentage → index against the pre-op
 *            script (KF_PERCENT_TOLERANCE, aligned with the writer ~0.001) and
 *            no-op on ambiguity (duplicate-percentage keyframes can't be told
 *            apart by percentage — landmine from PR #1498).
 */

import { openComposition } from "@hyperframes/sdk";
import type { EditOp } from "@hyperframes/sdk";
import { parseGsapScriptAcorn } from "@hyperframes/core/gsap-parser-acorn";
import type { GsapPercentageKeyframe } from "@hyperframes/core/gsap-parser";
import { STUDIO_SDK_SHADOW_ENABLED } from "../components/editor/manualEditingAvailability";
import { trackStudioEvent } from "./studioTelemetry";
import type { SdkShadowMismatch } from "./sdkShadow";
import { gsapFidelityMismatches, makeSelectorResolver } from "./sdkShadowGsapFidelity";

// Match the GSAP writer's percentage equality tolerance so a remove resolves to
// the same keyframe the server would pick (writer rounds to ~3 decimals).
const KF_PERCENT_TOLERANCE = 0.001;

export type ShadowKeyframeOp =
  | {
      kind: "add";
      animationId: string;
      percentage: number;
      properties: Record<string, number | string>;
    }
  | { kind: "remove"; animationId: string; percentage: number };

// ─── Script helpers (mirror sdkShadowGsapFidelity's extraction) ───────────────

function isGsapScriptBody(body: string): boolean {
  return body.includes("gsap") || body.includes("__timelines") || body.includes("ScrollTrigger");
}

function extractGsapScript(html: string): string | null {
  // Close tag is `</script[^>]*>` (HTML5 ignores junk before `>`).
  const scripts = html.match(/<script\b[^>]*>([\s\S]*?)<\/script[^>]*>/gi);
  if (!scripts) return null;
  for (const block of scripts) {
    const body = block.replace(/^<script\b[^>]*>/i, "").replace(/<\/script[^>]*>$/i, "");
    if (isGsapScriptBody(body)) return body;
  }
  return null;
}

// ─── percentage → SDK op mapping ──────────────────────────────────────────────

function findAnimationKeyframes(
  script: string,
  animationId: string,
): GsapPercentageKeyframe[] | null {
  const parsed = parseGsapScriptAcorn(script);
  // Match the writer's locateAnimationWithFallback (gsapParser.ts): a from/fromTo
  // tween's derived id may be normalized to "-to-" on write, so fall back to the
  // converted id when the exact one isn't found — otherwise the keyframe diff
  // goes blind (both scripts resolve null → falsely "clean") on converted tweens.
  const convertedId = animationId.replace(/-from-|-fromTo-/, "-to-");
  const anim =
    parsed.animations.find((a) => a.id === animationId) ??
    parsed.animations.find((a) => a.id === convertedId);
  return anim?.keyframes?.keyframes ?? null;
}

export interface KeyframeRemoveResolution {
  /** Resolved 0-based index, or null when it can't be safely resolved. */
  keyframeIndex: number | null;
  /** Why no index — for telemetry when keyframeIndex is null. */
  reason?: "no_keyframes" | "not_found" | "ambiguous";
}

/**
 * Resolve a percentage-based remove to a keyframe index against the pre-op
 * script. Returns null index (with a reason) when there are no keyframes, the
 * percentage matches none, or — per the PR #1498 landmine — more than one
 * keyframe shares the percentage (can't be disambiguated by percentage alone).
 * Pure + exported so the mapping is unit-testable without an SDK session.
 */
export function resolveKeyframeIndexByPercentage(
  script: string | null | undefined,
  animationId: string,
  percentage: number,
): KeyframeRemoveResolution {
  if (!script) return { keyframeIndex: null, reason: "no_keyframes" };
  const kfs = findAnimationKeyframes(script, animationId);
  if (!kfs || kfs.length === 0) return { keyframeIndex: null, reason: "no_keyframes" };
  const matches: number[] = [];
  for (let i = 0; i < kfs.length; i++) {
    if (Math.abs(kfs[i]?.percentage - percentage) <= KF_PERCENT_TOLERANCE) matches.push(i);
  }
  if (matches.length === 0) return { keyframeIndex: null, reason: "not_found" };
  if (matches.length > 1) return { keyframeIndex: null, reason: "ambiguous" };
  return { keyframeIndex: matches[0] };
}

/**
 * Map a studio keyframe op to the SDK EditOp. For a remove this needs the pre-op
 * script to resolve percentage → index; returns null (with a reason) when the
 * index can't be safely resolved so the caller can emit a no-op-with-reason
 * event instead of dispatching the wrong keyframe.
 */
export function keyframeOpToEditOp(
  op: ShadowKeyframeOp,
  beforeScript: string | null | undefined,
): { op: EditOp } | { op: null; reason: string } {
  if (op.kind === "add") {
    return {
      op: {
        type: "addGsapKeyframe",
        animationId: op.animationId,
        position: op.percentage,
        value: op.properties,
      },
    };
  }
  const resolved = resolveKeyframeIndexByPercentage(beforeScript, op.animationId, op.percentage);
  if (resolved.keyframeIndex === null) {
    return { op: null, reason: resolved.reason ?? "unresolved" };
  }
  return {
    op: {
      type: "removeGsapKeyframe",
      animationId: op.animationId,
      keyframeIndex: resolved.keyframeIndex,
    },
  };
}

// ─── Keyframe-aware fidelity diff ─────────────────────────────────────────────

function canonicalKeyframe(kf: GsapPercentageKeyframe): string {
  const props: Record<string, unknown> = {};
  for (const key of Object.keys(kf.properties).sort()) {
    const v = kf.properties[key];
    props[key] =
      typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : v;
  }
  return JSON.stringify({ pct: Math.round(kf.percentage * 1000) / 1000, ease: kf.ease, props });
}

function canonicalKeyframes(kfs: GsapPercentageKeyframe[] | null): string {
  if (!kfs) return "[]";
  return JSON.stringify(
    [...kfs].sort((a, b) => a.percentage - b.percentage).map(canonicalKeyframe),
  );
}

/**
 * Diff two GSAP scripts for a keyframe op: the reused tween-level diff PLUS a
 * keyframe-array comparison for the targeted animation (which the tween-level
 * diff doesn't inspect). Reports a `keyframes` value_mismatch when the SDK and
 * server keyframe arrays diverge canonically.
 */
export function gsapKeyframeFidelityMismatches(
  sdkScript: string,
  serverScript: string,
  animationId: string,
  resolveSelector?: (sel: string) => string,
): SdkShadowMismatch[] {
  const mismatches = gsapFidelityMismatches(sdkScript, serverScript, resolveSelector);
  const sdkKfs = findAnimationKeyframes(sdkScript, animationId);
  const serverKfs = findAnimationKeyframes(serverScript, animationId);
  const sdkCanon = canonicalKeyframes(sdkKfs);
  const serverCanon = canonicalKeyframes(serverKfs);
  if (sdkCanon !== serverCanon) {
    mismatches.push({
      kind: "value_mismatch",
      hfId: animationId,
      property: "keyframes",
      expected: serverCanon,
      actual: sdkCanon,
    });
  }
  return mismatches;
}

// ─── Telemetry runner ─────────────────────────────────────────────────────────

/**
 * Shadow a GSAP keyframe op: open a fresh SDK doc from the server's pre-op file,
 * apply the equivalent keyframe op, serialize, and diff against the server's
 * resulting script. Emits sdk_shadow_dispatch op: "gsap_keyframe". Async,
 * fire-and-forget; server stays authoritative. No-op when shadow is disabled.
 */
export async function runShadowGsapKeyframeFidelity(
  beforeHtml: string | null | undefined,
  op: ShadowKeyframeOp,
  serverScript: string | null | undefined,
): Promise<void> {
  if (!STUDIO_SDK_SHADOW_ENABLED) return;
  // No server script to diff against → skip the (costly) openComposition.
  if (!serverScript || !beforeHtml) return;
  const beforeScript = extractGsapScript(beforeHtml);
  const mapped = keyframeOpToEditOp(op, beforeScript);
  if (mapped.op === null) {
    // Ambiguous / not-found percentage: don't dispatch the wrong keyframe.
    trackStudioEvent("sdk_shadow_dispatch", {
      op: "gsap_keyframe",
      dispatched: false,
      reason: mapped.reason,
      mismatchCount: 0,
    });
    return;
  }
  const editOp = mapped.op;
  try {
    const session = await openComposition(beforeHtml);
    const verdict = session.can(editOp);
    if (!verdict.ok) {
      trackStudioEvent("sdk_shadow_dispatch", {
        op: "gsap_keyframe",
        dispatched: false,
        reason: "cannot_dispatch",
        code: verdict.code,
        mismatchCount: 0,
      });
      return;
    }
    session.batch(() => session.dispatch(editOp));
    const sdkScript = extractGsapScript(session.serialize());
    if (sdkScript == null) {
      trackStudioEvent("sdk_shadow_dispatch", {
        op: "gsap_keyframe",
        dispatched: false,
        reason: "no_sdk_script",
        mismatchCount: 0,
      });
      return;
    }
    const mismatches = gsapKeyframeFidelityMismatches(
      sdkScript,
      serverScript,
      op.animationId,
      makeSelectorResolver(beforeHtml),
    );
    trackStudioEvent("sdk_shadow_dispatch", {
      op: "gsap_keyframe",
      dispatched: true,
      mismatchCount: mismatches.length,
      mismatches: JSON.stringify(mismatches),
    });
  } catch (err) {
    trackStudioEvent("sdk_shadow_dispatch", {
      op: "gsap_keyframe",
      dispatched: false,
      reason: "fidelity_error",
      error: String(err),
      mismatchCount: 0,
    });
  }
}
