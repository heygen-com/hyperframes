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
import { log3d } from "../utils/debug3d";
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

/** Which commit branch a property edit will take, for the debug log. */
function commitPathLabel(anim: GsapAnimation | undefined): string {
  if (!anim) return "create";
  if (anim.method === "set") return "static-set";
  return anim.keyframes ? "keyframe" : "convert+keyframe";
}

/** The in-place `set` patch for a value-only commit (no soft reload), or none. */
function setInstantPatch(
  selector: string | null,
  property: string,
  value: number | string,
): { selector: string; change: { kind: "set"; props: SetPatchProps } } | undefined {
  if (!selector || typeof value !== "number") return undefined;
  return { selector, change: { kind: "set", props: { [property]: value } as SetPatchProps } };
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
  log3d("auto-keyframe", { animationId: setAnim.id, duration: animatedTween.duration ?? 1 });
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

/** Merge each prop into the static `set` (value-only, instant), then auto-keyframe. */
async function commitSetProps(
  selection: DomEditSelection,
  setAnim: GsapAnimation,
  propEntries: [string, number | string][],
  selector: string | null,
  animations: GsapAnimation[],
  commit: Commit,
): Promise<void> {
  for (const [property, value] of propEntries) {
    const instantPatch = setInstantPatch(selector, property, value);
    await commit(
      selection,
      { type: "update-property", animationId: setAnim.id, property, value },
      { label: `Set ${property}`, softReload: true, ...(instantPatch ? { instantPatch } : {}) },
    );
  }
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
  // Only ever update an existing `set` (its id is position-based, so it's stable as
  // properties are added) — NEVER a flat `to`/`from`, whose id is group-derived and
  // shifts the instant a new-group prop is added, 404-ing the next axis and
  // polluting an unrelated tween (e.g. a scale pop). A static element with no set
  // gets a dedicated `set` carrying ALL props in ONE `add` (no per-prop id race).
  const existingSet = animations.find((a) => a.method === "set" && a.targetSelector === selector);
  if (existingSet) {
    for (const [property, value] of propEntries) {
      const instantPatch = setInstantPatch(selector, property, value);
      await commit(
        selection,
        { type: "update-property", animationId: existingSet.id, property, value },
        { label: `Set ${property}`, softReload: true, ...(instantPatch ? { instantPatch } : {}) },
      );
    }
    return;
  }
  await commit(
    selection,
    {
      type: "add",
      targetSelector: selector,
      method: "set",
      position: 0,
      properties: Object.fromEntries(propEntries),
    },
    { label: "Set 3D transform", softReload: true },
  );
}

/** Convert-if-flat, then write ALL props into ONE keyframe at the playhead. */
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
    { label: `Edit ${primaryProp} (keyframe ${pct}%)`, softReload: true },
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
      log3d("commit-prop", {
        props,
        selector,
        pickedAnim: anim
          ? { id: anim.id, method: anim.method, hasKeyframes: !!anim.keyframes }
          : null,
        path: commitPathLabel(anim),
      });

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
      } catch (error) {
        log3d("commit-prop", { error: String(error), stale: anim?.id, action: "bump-cache" });
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
