import { useCallback } from "react";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import type { DomEditGroupPathOffsetCommit } from "../components/editor/DomEditOverlay";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { CommitMutationCall, CommitMutationOptions } from "./gsapScriptCommitTypes";
import type { UseGsapAwareEditingParams } from "./useGsapAwareEditing";
import { observeGsapGesture } from "./gsapGestureOutcome";
import { gsapWritesPosition } from "./gsapRuntimeKeyframes";
import { refuseGsapTakeover } from "./elementOffsetStager";
import { tryGsapDragIntercept } from "./gsapRuntimeBridge";
import { assertGsapEditPersisted } from "./gsapEditOutcome";

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

export function useGsapAwareGroupMove({
  gsapCommitMutation,
  previewIframeRef,
  makeFetchFallback,
  trackGsapInteractionFailure,
  stageElementPositionOffset,
  showToast,
}: Pick<
  UseGsapAwareEditingParams,
  | "gsapCommitMutation"
  | "previewIframeRef"
  | "makeFetchFallback"
  | "trackGsapInteractionFailure"
  | "stageElementPositionOffset"
  | "showToast"
>) {
  // Multi-select (group) drag: each member takes the single drag's writer, so a member GSAP
  // does not position is saved on itself and the rest go through the GSAP intercept.
  const handleGsapAwareGroupPathOffsetCommit = useCallback(
    async (
      updates: DomEditGroupPathOffsetCommit[],
    ): Promise<import("../utils/previewFeatureUsage").GeometryCommitResult> => {
      const writes = observeGsapGesture(gsapCommitMutation);
      const writer = writes.commit;
      if (!writer || updates.length === 0) return { ok: true, changed: false };
      let domChanged = false;
      // A group drag is ONE user action: fold every member's position write into
      // a single undo entry by forcing a shared coalesceKey (infinite window, so
      // it survives the N sequential server round-trips) onto each commit —
      // otherwise each member records its own entry and it takes N presses to undo.
      const coalesceKey = `group-drag:${++groupDragCommitCounter}`;
      // Members are written one at a time, and a re-render re-runs the script with the OLD
      // position of every member not yet written, so they snap back until their own write
      // lands. The drafts are already on screen: hold the render until the last member.
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
        if (!writer.batch) {
          for (const call of calls) {
            await writer(call.selection, call.mutation, call.options);
          }
          return;
        }
        await writer.batch(calls, {
          ...(calls.at(-1)?.options ?? { label: "Move animated layer (group)" }),
          label: "Move animated layer (group)",
        });
      };
      const coalescedCommit: typeof gsapCommitMutation = (selection, mutation, options) => {
        queued.push({ selection, mutation, options: withGroupOptions(options) });
        return Promise.resolve();
      };
      const preflightAnimations = new Map<DomEditSelection, GsapAnimation[]>();
      // Members saved on themselves, each with its route: true for its CSS translate.
      const offsetMembers = new Map<DomEditSelection, boolean>();
      // Editability is user-atomic: prove every member can be written before the first source
      // mutation, so a blocked member never leaves earlier siblings partially moved. Preflights
      // write nothing and share one in-flight parse per file, so they run together.
      const preflightResults = await Promise.allSettled(
        updates.map(async ({ selection, plainTranslate }) => {
          if (plainTranslate ?? !gsapWritesPosition(selection.element)) {
            refuseGsapTakeover(selection.element, showToast);
            return void offsetMembers.set(selection, true);
          }
          const animations = await makeFetchFallback(selection, { failOnFetchError: true })();
          preflightAnimations.set(selection, animations);
          const outcome = await tryGsapDragIntercept(
            selection,
            { x: 0, y: 0 },
            animations,
            previewIframeRef.current,
            coalescedCommit,
            undefined,
            { preflightOnly: true, group: true },
          );
          if (outcome.status === "element-offset") offsetMembers.set(selection, false);
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
      const lastScriptWrite = updates.findLastIndex(
        ({ selection }) => !offsetMembers.has(selection),
      );
      for (const [index, { selection, next }] of updates.entries()) {
        renderOnCommit = index === lastScriptWrite;
        const plain = offsetMembers.get(selection);
        if (plain !== undefined) {
          const result = await stageElementPositionOffset(
            selection,
            next,
            plain,
            coalesceKey,
          ).save();
          domChanged ||= result?.changed === true;
          continue;
        }
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
        return writes.finish(domChanged);
      } catch (error) {
        // The aggregate write has no uniquely failing member; do not misattribute
        // its telemetry to whichever member happened to be last in the array.
        trackGsapInteractionFailure(error, null, "drag", "Move animated layer (group)");
        throw error;
      }
    },
    [
      gsapCommitMutation,
      previewIframeRef,
      makeFetchFallback,
      trackGsapInteractionFailure,
      stageElementPositionOffset,
      showToast,
    ],
  );

  return handleGsapAwareGroupPathOffsetCommit;
}
