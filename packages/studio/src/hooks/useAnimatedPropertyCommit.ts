/**
 * Unified helper for committing any GSAP property value from the design panel.
 *
 * Routing depends on whether the element is animated (has keyframes on any tween):
 * - Animated → write the value into a keyframe at the current playhead (convert a
 *   flat tween first if needed). An existing static `set` auto-converts to keyframes.
 * - Static (no keyframes anywhere) → persist as a `tl.set`, NEVER keyframes — same
 *   as manual drag / resize / rotate. Updates an existing set or creates one.
 */
import { useCallback } from "react";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { classifyPropertyGroup } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { usePlayerStore } from "../player/store/playerStore";
import { readAllAnimatedProperties, readGsapProperty } from "./gsapRuntimeBridge";
import type { SetPatchProps } from "./gsapRuntimePatch";
import { selectorFromSelection, computeElementPercentage } from "./gsapShared";
import { resolveTweenStart, resolveTweenDuration } from "../utils/globalTimeCompiler";
import { roundTo3 } from "../utils/rounding";
import { commitWholePropertyOffset } from "./gsapWholePropertyOffsetCommit";

interface CommitAnimatedPropertyDeps {
  selectedGsapAnimations: GsapAnimation[];
  gsapCommitMutation:
    | ((
        selection: DomEditSelection,
        mutation: Record<string, unknown>,
        options: {
          label: string;
          coalesceKey?: string;
          softReload?: boolean;
          skipReload?: boolean;
        },
      ) => Promise<void>)
    | null;
  addGsapAnimation: (
    selection: DomEditSelection,
    method: "to" | "from" | "set" | "fromTo",
    currentTime?: number,
  ) => void;
  convertToKeyframes: (selection: DomEditSelection, animId: string) => void;
  previewIframeRef: React.RefObject<HTMLIFrameElement | null>;
  bumpGsapCache: () => void;
}

function pickBestAnimation(
  animations: GsapAnimation[],
  selector: string | null,
  property?: string,
): GsapAnimation | undefined {
  const targetGroup = property ? classifyPropertyGroup(property) : undefined;
  // Group-aware: never hand back a tween from a DIFFERENT property group. The old
  // `animations.length <= 1` early return merged a rotation/3D edit into the element's
  // only tween even when that was a `position` tween — contaminating it and leaving the
  // new property with no clean keyframe baseline. When a target group is known, only
  // same-group tweens are candidates; if none exist we return undefined and the caller
  // creates a fresh same-group tween.
  const candidates =
    targetGroup !== undefined
      ? animations.filter((a) => a.propertyGroup === targetGroup)
      : animations;
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];
  const currentTime = usePlayerStore.getState().currentTime;
  const scored = candidates.map((a) => {
    let score = 0;
    if (a.keyframes) score += 10;
    if (selector && a.targetSelector === selector) score += 5;
    else if (a.targetSelector.includes(",")) score -= 3;
    const pos = a.resolvedStart ?? (typeof a.position === "number" ? a.position : 0);
    const dur = a.duration ?? 0;
    if (currentTime >= pos - 0.05 && currentTime <= pos + dur + 0.05) score += 8;
    return { anim: a, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.anim;
}

/**
 * Auto-keyframe a just-updated static `set`: if the element is already animated
 * (its clip carries keyframes on another tween), convert the set to keyframes so
 * subsequent edits at other playheads interpolate — matching the drag / resize /
 * rotate UX. Purely static elements (no other keyframes) are left as a set.
 */
async function maybeAutoKeyframeSet(
  selection: DomEditSelection,
  setAnim: GsapAnimation,
  animations: GsapAnimation[],
  commit: NonNullable<CommitAnimatedPropertyDeps["gsapCommitMutation"]>,
): Promise<void> {
  const animatedTween = animations.find((a) => a.keyframes && a.id !== setAnim.id);
  if (!animatedTween) return;
  await commit(
    selection,
    {
      type: "convert-to-keyframes",
      animationId: setAnim.id,
      duration: animatedTween.duration ?? 1,
    },
    { label: "Keyframe 3D transform", softReload: true },
  );
}

type Commit = NonNullable<CommitAnimatedPropertyDeps["gsapCommitMutation"]>;

/** Merge ALL props into the static `set` in ONE commit (value-only, instant), then
 *  auto-keyframe. One mutation — a per-property loop would shift the set's
 *  group-derived id mid-way (e.g. reset adding `scale` to a rotation set), 404-ing
 *  the next update. */
async function commitSetProps(
  selection: DomEditSelection,
  setAnim: GsapAnimation,
  propEntries: [string, number | string][],
  selector: string | null,
  animations: GsapAnimation[],
  commit: Commit,
): Promise<void> {
  const properties = Object.fromEntries(propEntries);
  const numericProps: SetPatchProps = {};
  for (const [k, v] of propEntries) {
    if (typeof v === "number") numericProps[k as keyof SetPatchProps] = v;
  }
  const instantPatch =
    selector && Object.keys(numericProps).length > 0
      ? {
          selector,
          change: {
            kind: (setAnim.global ? "global-set" : "set") as "set" | "global-set",
            props: numericProps,
          },
        }
      : undefined;
  await commit(
    selection,
    { type: "update-properties", animationId: setAnim.id, properties },
    { label: "Set 3D transform", softReload: true, ...(instantPatch ? { instantPatch } : {}) },
  );
  await maybeAutoKeyframeSet(selection, setAnim, animations, commit);
}

/**
 * Static element (no keyframes on ANY of its tweens): persist the 3D props as a
 * `tl.set` — NEVER keyframes. Mirrors manual drag / resize / rotate, which `tl.set`
 * a static element instead of animating it. Updates an existing `set` in place, or
 * creates a dedicated `set` at position 0 when the element has none.
 */
async function commitStaticSet(
  selection: DomEditSelection,
  propEntries: [string, number | string][],
  selector: string | null,
  animations: GsapAnimation[],
  commit: Commit,
): Promise<void> {
  if (!selector) return;
  // Update an existing `set` in ONE batched commit — NEVER a flat `to`/`from`. A
  // set's id is GROUP-derived, so a per-prop loop shifts it the instant a new-group
  // prop lands (e.g. `scale` onto a rotation set), 404-ing the next prop; commitSetProps
  // sends them together. A static element with no set gets a dedicated `set` carrying
  // ALL props in ONE `add`.
  const existingSet = animations.find((a) => a.method === "set" && a.targetSelector === selector);
  if (existingSet) {
    await commitSetProps(selection, existingSet, propEntries, selector, animations, commit);
    return;
  }
  // Base `gsap.set` (off-timeline) — a static hold with no 0% keyframe marker, so
  // adjusting a 3D transform on a non-keyframed element doesn't drop a keyframe on
  // the timeline (matches the manual-drag UX). The global-set instant patch applies
  // it straight to the element so the first edit shows with no soft-reload flash.
  const numericProps: SetPatchProps = {};
  for (const [k, v] of propEntries) {
    if (typeof v === "number") numericProps[k as keyof SetPatchProps] = v;
  }
  await commit(
    selection,
    {
      type: "add",
      targetSelector: selector,
      method: "set",
      position: 0,
      properties: Object.fromEntries(propEntries),
      global: true,
    },
    {
      label: "Set 3D transform",
      softReload: true,
      ...(Object.keys(numericProps).length > 0
        ? {
            instantPatch: {
              selector,
              change: { kind: "global-set" as const, props: numericProps },
            },
          }
        : {}),
    },
  );
}

/** Convert-if-flat, then write ALL props into ONE keyframe at the playhead. */
// fallow-ignore-next-line complexity
async function commitKeyframeProps(
  selection: DomEditSelection,
  anim: GsapAnimation,
  props: Record<string, number | string>,
  propEntries: [string, number | string][],
  primaryProp: string,
  selector: string | null,
  iframe: HTMLIFrameElement | null,
  commit: Commit,
): Promise<void> {
  const wasKeyframed = !!anim.keyframes;
  if (!wasKeyframed) {
    await commit(
      selection,
      { type: "convert-to-keyframes", animationId: anim.id },
      { label: "Convert to keyframes", skipReload: true },
    );
  }
  const ct = usePlayerStore.getState().currentTime;
  const runtimeProps = selector ? readAllAnimatedProperties(iframe, selector, anim) : {};
  const properties: Record<string, number | string> = { ...runtimeProps, ...props };

  const backfillDefaults: Record<string, number | string> = { ...runtimeProps };
  for (const [property, value] of propEntries) {
    if (!(property in runtimeProps) && selector) {
      const cssVal = readGsapProperty(iframe, selector, property);
      if (cssVal != null) backfillDefaults[property] = cssVal;
    }
    backfillDefaults[property] = value;
  }

  // Playhead OUTSIDE the keyframe tween's time range → EXTEND the tween to reach it
  // and add a keyframe there, exactly like manual drag's extendTweenAndAddKeyframe.
  // The add-keyframe below only writes WITHIN the existing range, so without this a
  // depth edit past the tween end just overwrites the last keyframe (the bug: no new
  // diamond appears at a playhead beyond the tween). Only for an already-keyframed
  // tween — a freshly-converted set has no prior range worth remapping.
  const kfs = anim.keyframes?.keyframes;
  const ts = resolveTweenStart(anim);
  const td = resolveTweenDuration(anim);
  const hasSelectedKeyframe = usePlayerStore.getState().activeKeyframePct != null;
  const playheadOutside = ts !== null && td > 0 && (ct < ts - 0.01 || ct > ts + td + 0.01);
  const willExtend = wasKeyframed && !!kfs && playheadOutside && !hasSelectedKeyframe;
  if (willExtend && kfs && ts !== null) {
    const newStart = Math.min(ct, ts);
    const newEnd = Math.max(ct, ts + td);
    const newDuration = Math.max(0.01, newEnd - newStart);
    const remapped = kfs.map((kf) => {
      const absTime = ts + (kf.percentage / 100) * td;
      const newPct = Math.round(((absTime - newStart) / newDuration) * 1000) / 10;
      const p: Record<string, number | string> = { ...kf.properties };
      for (const k of Object.keys(properties)) {
        if (!(k in p) && backfillDefaults[k] != null) p[k] = backfillDefaults[k];
      }
      return { percentage: newPct, properties: p };
    });
    remapped.push({
      percentage: Math.round(((ct - newStart) / newDuration) * 1000) / 10,
      properties,
    });
    remapped.sort((a, b) => a.percentage - b.percentage);
    await commit(
      selection,
      {
        type: "replace-with-keyframes",
        animationId: anim.id,
        targetSelector: anim.targetSelector,
        position: roundTo3(newStart),
        duration: roundTo3(newDuration),
        keyframes: remapped,
      },
      { label: `Edit ${primaryProp} (extended keyframe)`, softReload: true },
    );
    return;
  }

  const pct = computeElementPercentage(ct, selection, anim);
  const existingKf = anim.keyframes?.keyframes.some((kf) => Math.abs(kf.percentage - pct) < 0.05);
  // Rebuild the live keyframe tween in place so the edit shows instantly (no flash);
  // rebuildKeyframeTween declines → soft reload if the tween can't be safely rebuilt.
  const numericProps: Record<string, number> = {};
  for (const [k, v] of Object.entries(properties)) {
    if (typeof v === "number") numericProps[k] = v;
  }
  const instantPatch =
    selector && Object.keys(numericProps).length > 0
      ? { selector, change: { kind: "keyframe-rebuild" as const, pct, props: numericProps } }
      : undefined;
  await commit(
    selection,
    existingKf
      ? { type: "update-keyframe", animationId: anim.id, percentage: pct, properties }
      : {
          type: "add-keyframe",
          animationId: anim.id,
          percentage: pct,
          properties,
          backfillDefaults,
        },
    {
      label: `Edit ${primaryProp} (keyframe ${pct}%)`,
      softReload: true,
      ...(instantPatch ? { instantPatch } : {}),
    },
  );
}

export function useAnimatedPropertyCommit(deps: CommitAnimatedPropertyDeps) {
  const { selectedGsapAnimations, gsapCommitMutation, previewIframeRef, bumpGsapCache } = deps;

  const commitAnimatedProperties = useCallback(
    async (selection: DomEditSelection, props: Record<string, number | string>): Promise<void> => {
      if (!gsapCommitMutation) return;
      const propEntries = Object.entries(props);
      if (propEntries.length === 0) return;
      const primaryProp = propEntries[0]![0];

      const iframe = previewIframeRef.current;
      const selector = selectorFromSelection(selection);

      const anim: GsapAnimation | undefined = pickBestAnimation(
        selectedGsapAnimations,
        selector,
        primaryProp,
      );
      // Whether the element is animated at all. A 3D edit only creates/edits
      // keyframes when it IS — a static element (no keyframes on any of its tweens)
      // gets a `tl.set`, never new keyframes (matches manual drag / resize / rotate).
      const elementHasKeyframes = selectedGsapAnimations.some((a) => !!a.keyframes);

      // The picked anim comes from the (possibly stale) panel cache: if keyframes
      // were just removed or the script changed underneath us, its id is gone
      // server-side and the commit 404s. The raw commit already toasts; we catch
      // so the rejection doesn't escape as an uncaught promise, and bump the cache
      // so selectedGsapAnimations re-syncs and the user's next edit self-heals.
      try {
        // Animated element → keyframe at the playhead, EXACTLY like manual drag /
        // resize / rotate: if the picked anim is still a static `set`,
        // commitKeyframeProps converts it to keyframes first, then writes the new
        // value as a keyframe at the current time — so the 3D animates instead of
        // holding a flat constant. This MUST come before the `set`-update path below,
        // or a 3D `set` would short-circuit to an in-place update and the playhead
        // keyframe would never land (the bug: scrolling depth on a keyframed element
        // just changed the constant instead of dropping a keyframe).
        if (elementHasKeyframes && anim) {
          // With auto-keyframe off (#1808), nudge the whole tween instead of
          // adding/updating a keyframe at the playhead.
          if (!usePlayerStore.getState().autoKeyframeEnabled) {
            const pct = computeElementPercentage(
              usePlayerStore.getState().currentTime,
              selection,
              anim,
            );
            await commitWholePropertyOffset(
              selection,
              anim,
              Object.fromEntries(
                propEntries.filter((e): e is [string, number] => typeof e[1] === "number"),
              ),
              pct,
              iframe,
              { commitMutation: gsapCommitMutation },
              `Edit ${primaryProp} (whole animation)`,
            );
            return;
          }
          await commitKeyframeProps(
            selection,
            anim,
            props,
            propEntries,
            primaryProp,
            selector,
            iframe,
            gsapCommitMutation,
          );
          return;
        }

        // Existing static hold on a NON-animated element — merge the props into the
        // `set` in place (maybeAutoKeyframeSet no-ops when nothing else is keyframed).
        if (anim?.method === "set") {
          await commitSetProps(
            selection,
            anim,
            propEntries,
            selector,
            selectedGsapAnimations,
            gsapCommitMutation,
          );
          return;
        }

        // Static element (no keyframes anywhere) — persist as a `tl.set`, never
        // keyframes (incl. the no-animation case, which creates a fresh set).
        if (!elementHasKeyframes) {
          await commitStaticSet(
            selection,
            propEntries,
            selector,
            selectedGsapAnimations,
            gsapCommitMutation,
          );
          return;
        }

        // Animated element but NO same-group tween exists (e.g. the FIRST rotation/3D
        // keyframe on an element that only has a position tween). Create a fresh
        // same-group keyframed tween WITH a 0% baseline at the playhead, instead of
        // contaminating a foreign-group tween. Mirror an existing keyframed tween's
        // time range so the new group animates over the same span. The 0% baseline is
        // an `_auto` endpoint so it tracks the nearest keyframe as you add more.
        if (selector) {
          const template = selectedGsapAnimations.find((a) => !!a.keyframes);
          const tStart = template ? (resolveTweenStart(template) ?? 0) : 0;
          const tDur = template ? resolveTweenDuration(template) || 1 : 1;
          const ct = usePlayerStore.getState().currentTime;
          const pct =
            tDur > 0
              ? Math.max(0, Math.min(100, Math.round(((ct - tStart) / tDur) * 1000) / 10))
              : 0;
          const newProps = Object.fromEntries(propEntries);
          const keyframes =
            pct <= 0.05
              ? [{ percentage: 0, properties: newProps }]
              : [
                  { percentage: 0, properties: { ...newProps, _auto: 1 } },
                  { percentage: pct, properties: newProps },
                ];
          await gsapCommitMutation(
            selection,
            {
              type: "add-with-keyframes",
              targetSelector: selector,
              position: roundTo3(tStart),
              duration: roundTo3(tDur),
              keyframes,
            },
            { label: `Add ${primaryProp} keyframe`, softReload: true },
          );
          return;
        }
        bumpGsapCache();
      } catch {
        bumpGsapCache();
      }
    },
    [selectedGsapAnimations, gsapCommitMutation, previewIframeRef, bumpGsapCache],
  );

  const commitAnimatedProperty = useCallback(
    (selection: DomEditSelection, property: string, value: number | string) =>
      commitAnimatedProperties(selection, { [property]: value }),
    [commitAnimatedProperties],
  );

  return { commitAnimatedProperty, commitAnimatedProperties };
}
