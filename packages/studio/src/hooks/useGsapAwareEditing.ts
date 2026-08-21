/**
 * GSAP-aware move/resize/rotation wrappers that intercept geometry commits
 * for animated elements and route them through script mutation instead of
 * CSS patching. Also exposes the animated-property commit, arc-path ops,
 * and the thin `commitMutation` facade.
 *
 * Extracted from useDomEditSession to isolate the GSAP intercept routing
 * from the rest of the editing orchestration.
 */
import { useCallback } from "react";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import {
  POSITION_CHANNELS,
  tryGsapDragIntercept,
  tryGsapRotationIntercept,
} from "./gsapRuntimeBridge";
import { tryGsapResizeIntercept } from "./gsapResizeIntercept";
import { computeDraggedGsapPosition } from "./draggedGsapPosition";
import { readGsapPositionFromIframe } from "./gsapPositionDetection";
import { selectorFromSelection } from "./gsapShared";
import { useAnimatedPropertyCommit } from "./useAnimatedPropertyCommit";
import {
  useGsapSaveFailureTelemetry,
  useSafeGsapCommitMutation,
} from "./useSafeGsapCommitMutation";
import type {
  CommitMutation,
  CommitMutationCall,
  CommitMutationOptions,
} from "./gsapScriptCommitTypes";
import { setElementGsapPosition } from "../utils/elementGsap";
import { logResize, logResizeSettle } from "../utils/resizeDebug";
import type { DomEditGroupPathOffsetCommit } from "../components/editor/DomEditOverlay";
import { runGestureTransaction } from "./gestureTransaction";
import { hasNonHoldTweenForElement } from "./gsapRuntimeKeyframes";
import { assertGsapEditPersisted } from "./gsapEditOutcome";
import type { GsapAnimationFetchOptions } from "./useGsapAnimationFetchFallback";

// Distinct coalesceKey per group drag so consecutive group drags don't fold
// into one another's undo entry (module-local counter, not Date.now()).
let groupDragCommitCounter = 0;

function firstPreflightFailure(
  results: PromiseSettledResult<void>[],
  updates: DomEditGroupPathOffsetCommit[],
): { error: unknown; selection: DomEditSelection } | null {
  for (const [index, result] of results.entries()) {
    if (result.status !== "rejected") continue;
    const selection = updates[index]?.selection;
    if (selection) return { error: result.reason, selection };
  }
  return null;
}

export interface UseGsapAwareEditingParams {
  domEditSelection: DomEditSelection | null;
  selectedGsapAnimations: GsapAnimation[];
  gsapCommitMutation: CommitMutation | null;
  previewIframeRef: React.RefObject<HTMLIFrameElement | null>;
  showToast: (message: string, tone?: "error" | "info") => void;
  bumpGsapCache: () => void;
  makeFetchFallback: (
    selection: DomEditSelection,
    options?: GsapAnimationFetchOptions,
  ) => () => Promise<GsapAnimation[]>;
  trackGsapInteractionFailure: (
    error: unknown,
    selection: DomEditSelection | null,
    mutationType: string,
    label: string,
  ) => void;
  // DOM fallbacks (from useDomEditCommits)
  handleDomBoxSizeCommit: (
    selection: DomEditSelection,
    next: { width: number; height: number },
    offset?: { x: number; y: number },
  ) => Promise<void>;
  // GSAP script commit ops (from useGsapScriptCommits)
  addGsapAnimation: (
    sel: DomEditSelection,
    method: "to" | "from" | "set" | "fromTo",
    time?: number,
  ) => Promise<void>;
  convertToKeyframes: (sel: DomEditSelection, animId: string) => void;
  setArcPath: (
    sel: DomEditSelection,
    animId: string,
    config: {
      enabled: boolean;
      autoRotate?: boolean | number;
      segments?: Array<{
        curviness: number;
        cp1?: { x: number; y: number };
        cp2?: { x: number; y: number };
      }>;
    },
  ) => void;
  updateArcSegment: (
    sel: DomEditSelection,
    animId: string,
    segmentIndex: number,
    update: {
      curviness?: number;
      cp1?: { x: number; y: number };
      cp2?: { x: number; y: number };
    },
  ) => void;
}

export function useGsapAwareEditing({
  domEditSelection,
  selectedGsapAnimations,
  gsapCommitMutation,
  previewIframeRef,
  showToast,
  bumpGsapCache,
  makeFetchFallback,
  trackGsapInteractionFailure,
  handleDomBoxSizeCommit,
  addGsapAnimation,
  convertToKeyframes,
  setArcPath,
  updateArcSegment,
}: UseGsapAwareEditingParams) {
  // ── GSAP-aware geometry commits ──

  const handleGsapAwarePathOffsetCommit = useCallback(
    async (
      selection: DomEditSelection,
      next: { x: number; y: number },
      modifiers?: { altKey?: boolean },
    ) => {
      if (gsapCommitMutation) {
        try {
          const outcome = await tryGsapDragIntercept(
            selection,
            next,
            selectedGsapAnimations,
            previewIframeRef.current,
            gsapCommitMutation,
            makeFetchFallback(selection),
            modifiers,
          );
          assertGsapEditPersisted(outcome);
        } catch (error) {
          trackGsapInteractionFailure(error, selection, "drag", "Move animated layer");
          throw error;
        }
      }
    },
    [
      selectedGsapAnimations,
      gsapCommitMutation,
      previewIframeRef,
      makeFetchFallback,
      trackGsapInteractionFailure,
    ],
  );

  // Multi-select (group) drag: route EACH element through the SAME GSAP intercept as
  // a single drag, so every position is written as GSAP code (tl.set / keyframes /
  // gsap.set) — NEVER the deprecated `--hf-studio-offset` CSS var, and GSAP-animated
  // elements are no longer blocked in a group. No CSS fallback: with no GSAP
  // composition there's nothing to write (a no-op, exactly like the single-drag path).
  const handleGsapAwareGroupPathOffsetCommit = useCallback(
    async (updates: DomEditGroupPathOffsetCommit[]) => {
      if (!gsapCommitMutation || updates.length === 0) return;
      // A group drag is ONE user action: fold every member's position write into
      // a single undo entry by forcing a shared coalesceKey (infinite window, so
      // it survives the N sequential server round-trips) onto each commit —
      // otherwise each member records its own entry and it takes N presses to undo.
      const coalesceKey = `group-drag:${++groupDragCommitCounter}`;
      // Members are written one at a time, and a write that re-renders the preview
      // re-runs the whole script — which still holds the OLD position of every
      // member not yet written. Those members snap back to where they started and
      // stay there until their own write lands, which is the single element seen
      // jumping mid-commit while the rest of the group sat still. The drafted
      // positions are already on screen, so holding the render until the last
      // member has been written costs nothing and never shows a half-moved group.
      let renderOnCommit = false;
      const previewFallbackLatch = { pending: false };
      const withGroupOptions = (options: CommitMutationOptions): CommitMutationOptions => ({
        ...options,
        coalesceKey,
        coalesceMs: Number.POSITIVE_INFINITY,
        deferPreviewSync: !renderOnCommit,
        previewFallbackLatch,
      });
      // Every member writes the same file. Queue their mutations and send them as
      // ONE request instead of one round trip per member: the server reads, parses
      // and writes the composition once, and the preview patches once.
      const queued: CommitMutationCall[] = [];
      const flushQueued = async () => {
        if (queued.length === 0) return;
        const calls = queued.splice(0, queued.length);
        if (!gsapCommitMutation.batch) {
          for (const call of calls) {
            await gsapCommitMutation(call.selection, call.mutation, call.options);
          }
          return;
        }
        await gsapCommitMutation.batch(calls, {
          ...(calls.at(-1)?.options ?? { label: "Move animated layer (group)" }),
          label: "Move animated layer (group)",
        });
      };
      const coalescedCommit: typeof gsapCommitMutation = (selection, mutation, options) => {
        queued.push({ selection, mutation, options: withGroupOptions(options) });
        return Promise.resolve();
      };
      const preflightAnimations = new Map<DomEditSelection, GsapAnimation[]>();
      // Editability is user-atomic: prove every member can be written before
      // the first source mutation. Network failures after this point retain the
      // existing multi-request semantics, but a blocked member can never leave
      // earlier siblings partially moved.
      // Every member reads the same file, and a preflight writes nothing — so run
      // them together. The parse layer shares one in-flight request per file, which
      // turns N sequential round trips into one.
      const preflightResults = await Promise.allSettled(
        updates.map(async ({ selection }) => {
          const animations = await makeFetchFallback(selection, { failOnFetchError: true })();
          preflightAnimations.set(selection, animations);
          const outcome = await tryGsapDragIntercept(
            selection,
            { x: 0, y: 0 },
            animations,
            previewIframeRef.current,
            coalescedCommit,
            undefined,
            { preflightOnly: true },
          );
          assertGsapEditPersisted(outcome);
        }),
      );
      const preflightFailure = firstPreflightFailure(preflightResults, updates);
      if (preflightFailure) {
        trackGsapInteractionFailure(
          preflightFailure.error,
          preflightFailure.selection,
          "drag",
          "Move animated layer (group)",
        );
        throw preflightFailure.error;
      }
      for (const [index, { selection, next }] of updates.entries()) {
        renderOnCommit = index === updates.length - 1;
        try {
          const outcome = await tryGsapDragIntercept(
            selection,
            next,
            preflightAnimations.get(selection) ?? [],
            previewIframeRef.current,
            coalescedCommit,
            // The intercept re-reads the file to resolve a stale or shared tween.
            // Anything already queued has to be on disk before that read, or it
            // resolves against a file missing writes it is about to build on.
            async () => {
              await flushQueued();
              return makeFetchFallback(selection, { fresh: true })();
            },
            { preflightPassed: true },
          );
          assertGsapEditPersisted(outcome);
        } catch (error) {
          trackGsapInteractionFailure(error, selection, "drag", "Move animated layer (group)");
          throw error;
        }
      }
      try {
        await flushQueued();
      } catch (error) {
        // The aggregate write has no uniquely failing member; do not misattribute
        // its telemetry to whichever member happened to be last in the array.
        trackGsapInteractionFailure(error, null, "drag", "Move animated layer (group)");
        throw error;
      }
    },
    [gsapCommitMutation, previewIframeRef, makeFetchFallback, trackGsapInteractionFailure],
  );

  const handleGsapAwareBoxSizeCommit = useCallback(
    async (
      selection: DomEditSelection,
      next: { width: number; height: number },
      offset?: { x: number; y: number },
      restore: () => void = () => undefined,
    ) => {
      const scaleRoute = selectedGsapAnimations.some((anim) => anim.propertyGroup === "scale");
      const selector = selectorFromSelection(selection);
      const hasLivePositionTween = selector
        ? hasNonHoldTweenForElement(
            previewIframeRef.current,
            selector,
            undefined,
            POSITION_CHANNELS,
          )
        : false;
      logResize("commit-route", {
        next,
        offset: offset ?? null,
        scaleRoute,
        animCount: selectedGsapAnimations.length,
        animGroups: selectedGsapAnimations.map((a) => `${a.propertyGroup}:${a.method}`),
      });
      return runGestureTransaction({
        element: selection.element,
        label: "Resize layer",
        settle: () => {
          // Scale resize settles its center-scale residual after the scale commit
          // renders. Width/height can settle its anchored position immediately.
          if (!offset || scaleRoute || !selector) return;
          const gsapPos = readGsapPositionFromIframe(previewIframeRef.current, selector) ?? {
            x: 0,
            y: 0,
          };
          const { newX, newY } = computeDraggedGsapPosition(selection.element, offset, gsapPos);
          logResize("sync-settle", { gsapPos, offset, newX, newY });
          setElementGsapPosition(selection.element, newX, newY);
        },
        persist: async (commit) => {
          if (gsapCommitMutation) {
            const commitMutation = commit(gsapCommitMutation);
            try {
              const outcome = await tryGsapResizeIntercept(
                selection,
                next,
                selectedGsapAnimations,
                previewIframeRef.current,
                commitMutation,
                makeFetchFallback(selection),
              );
              assertGsapEditPersisted(outcome);
              // What the resize actually did, not what its animations suggest
              // it would do. An element whose scale is an instant hold has a
              // scale-group tween and still commits width/height, so guessing
              // from the tweens withheld an offset nobody had written and the
              // element snapped back to its authored position on every drag.
              const ownsDragOffset =
                outcome.status === "persisted" && outcome.ownsDragOffset === true;
              logResize("intercept-handled", {
                scaleRoute,
                ownsDragOffset,
                willForwardOffset: !!(offset && !ownsDragOffset),
              });
              // A resize that moved the element itself has already written
              // where it landed. Everything else leaves the anchor to the drag.
              if (offset && !ownsDragOffset) {
                const dragOutcome = await tryGsapDragIntercept(
                  selection,
                  offset,
                  selectedGsapAnimations,
                  previewIframeRef.current,
                  commitMutation,
                  makeFetchFallback(selection),
                );
                assertGsapEditPersisted(dragOutcome);
              }
              logResizeSettle(selection.element, ownsDragOffset ? "gsap-scale" : "gsap-size");
              return;
            } catch (error) {
              trackGsapInteractionFailure(error, selection, "resize", "Resize animated layer");
              throw error;
            }
          }
          logResize("dom-route", {
            next,
            offset: offset ?? null,
            hadGsapMutation: !!gsapCommitMutation,
          });
          logResizeSettle(selection.element, "dom-route");
          await handleDomBoxSizeCommit(selection, next, offset);
        },
        restore,
        skipPixelAssert: hasLivePositionTween,
      });
    },
    [
      handleDomBoxSizeCommit,
      selectedGsapAnimations,
      gsapCommitMutation,
      previewIframeRef,
      makeFetchFallback,
      trackGsapInteractionFailure,
    ],
  );

  const handleGsapAwareRotationCommit = useCallback(
    async (selection: DomEditSelection, next: { angle: number }) => {
      if (gsapCommitMutation) {
        try {
          // Single source of truth for rotation too: tryGsapRotationIntercept handles
          // tweened elements (keyframes) and static ones (a tl.set), so there's no
          // CSS-var fallback. Selectorless/computed source rejects so the gesture
          // transaction can restore its draft instead of reporting a false success.
          const outcome = await tryGsapRotationIntercept(
            selection,
            next.angle,
            selectedGsapAnimations,
            previewIframeRef.current,
            gsapCommitMutation,
            makeFetchFallback(selection),
          );
          assertGsapEditPersisted(outcome);
        } catch (error) {
          trackGsapInteractionFailure(error, selection, "rotation", "Rotate animated layer");
          throw error;
        }
      }
    },
    [
      selectedGsapAnimations,
      gsapCommitMutation,
      previewIframeRef,
      makeFetchFallback,
      trackGsapInteractionFailure,
    ],
  );

  // ── Animated property commit ──

  const {
    commitAnimatedProperty: commitAnimatedPropertyRaw,
    commitAnimatedProperties: commitAnimatedPropertiesRaw,
  } = useAnimatedPropertyCommit({
    selectedGsapAnimations,
    gsapCommitMutation,
    addGsapAnimation: (sel, method, time) => addGsapAnimation(sel, method, time),
    convertToKeyframes: (sel, animId) => convertToKeyframes(sel, animId),
    previewIframeRef,
    bumpGsapCache,
  });

  const commitAnimatedProperties = useCallback(
    async (selection: DomEditSelection, properties: Record<string, number | string>) => {
      try {
        await commitAnimatedPropertiesRaw(selection, properties);
      } catch (error) {
        trackGsapInteractionFailure(error, selection, "property", "Edit animated property");
        throw error;
      }
    },
    [commitAnimatedPropertiesRaw, trackGsapInteractionFailure],
  );

  const commitAnimatedProperty = useCallback(
    async (selection: DomEditSelection, property: string, value: number | string) => {
      try {
        await commitAnimatedPropertyRaw(selection, property, value);
      } catch (error) {
        trackGsapInteractionFailure(error, selection, "property", "Edit animated property");
        throw error;
      }
    },
    [commitAnimatedPropertyRaw, trackGsapInteractionFailure],
  );

  // ── Arc path wrappers ──

  const handleSetArcPath = useCallback(
    (animId: string, config: Parameters<typeof setArcPath>[2]) => {
      if (!domEditSelection) return;
      setArcPath(domEditSelection, animId, config);
    },
    [domEditSelection, setArcPath],
  );

  const handleUpdateArcSegment = useCallback(
    (animId: string, segmentIndex: number, update: Parameters<typeof updateArcSegment>[3]) => {
      if (!domEditSelection) return;
      updateArcSegment(domEditSelection, animId, segmentIndex, update);
    },
    [domEditSelection, updateArcSegment],
  );

  // ── Thin commitMutation facade ──
  // Routes through the canonical safe wrapper so a server-save failure surfaces a
  // toast + save telemetry instead of silently reverting — parity with the
  // arc/keyframe/animation ops that all go through useSafeGsapCommitMutation.

  const noopCommit = useCallback<CommitMutation>(async () => {}, []);
  const trackGsapSaveFailure = useGsapSaveFailureTelemetry(null);
  const safeGsapCommit = useSafeGsapCommitMutation(
    gsapCommitMutation ?? noopCommit,
    trackGsapSaveFailure,
    showToast,
  );

  const commitMutation = useCallback(
    async (mutation: Record<string, unknown>, options: { label: string; softReload?: boolean }) => {
      if (!domEditSelection) return;
      // Return (await) the safe-commit chain so consumers that `await
      // session.commitMutation(...)` (gesture recording, enable-keyframes) run
      // their post-actions only after the server save has settled.
      await safeGsapCommit(domEditSelection, mutation, options);
    },
    [domEditSelection, safeGsapCommit],
  );

  // Unroll all computed (helper/loop) tweens in the active timeline into literal
  // tweens, so the clicked keyframe becomes directly editable. Visual no-op.
  const handleUnroll = useCallback(() => {
    void commitMutation(
      { type: "unroll-timeline" },
      { label: "Unroll to literal tweens", softReload: true },
    );
  }, [commitMutation]);

  return {
    handleGsapAwarePathOffsetCommit,
    handleGsapAwareGroupPathOffsetCommit,
    handleGsapAwareBoxSizeCommit,
    handleGsapAwareRotationCommit,
    commitAnimatedProperty,
    commitAnimatedProperties,
    handleSetArcPath,
    handleUpdateArcSegment,
    handleUnroll,
    commitMutation,
  };
}
