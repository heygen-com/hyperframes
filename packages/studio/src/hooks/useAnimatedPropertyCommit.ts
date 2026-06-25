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
  if (animations.length <= 1) return animations[0];
  const currentTime = usePlayerStore.getState().currentTime;
  const targetGroup = property ? classifyPropertyGroup(property) : undefined;

  // fallow-ignore-next-line complexity
  const scored = animations.map((a) => {
    let score = 0;
    if (targetGroup && a.propertyGroup === targetGroup) score += 20;
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
  if (!anim.keyframes) {
    await commit(
      selection,
      { type: "convert-to-keyframes", animationId: anim.id },
      { label: "Convert to keyframes", skipReload: true },
    );
  }
  const pct = computeElementPercentage(usePlayerStore.getState().currentTime, selection, anim);
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
        // Existing static hold — merge the props into the `set`, then auto-keyframe
        // ONLY if the element is already animated (maybeAutoKeyframeSet no-ops if not).
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

        // Static element — persist as a `tl.set`, never keyframes (incl. the
        // no-animation case, which now creates a set instead of a keyframed tween).
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

        // Animated element — write ALL props into ONE keyframe so a multi-axis cube
        // edit doesn't race into adjacent duplicates.
        if (!anim) {
          bumpGsapCache();
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
