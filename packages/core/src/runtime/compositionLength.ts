import {
  resolveCompositionDuration,
  type CompositionDurationResult,
} from "@hyperframes/parsers/composition-duration";
import { findRootCompositionElement, parseCompositionDimension } from "./compositionDimension";
import { isMediaElement } from "./domRealm";
import { parseStrictFiniteTimingNumber, resolveMediaElementDurationSeconds } from "./playbackRate";
import { createRuntimeStartTimeResolver } from "./startResolver";
import { createRuntimeState } from "./state";

export { findRootCompositionElement };

export const LOOP_INFLATED_TIMELINE_SECONDS = 7200;

/** One frame at 60 fps: a timeline, floor or fallback this short or shorter is no length at all. */
export const MIN_VALID_TIMELINE_DURATION_SECONDS = 1 / 60;

type StartResolver = Pick<
  ReturnType<typeof createRuntimeStartTimeResolver>,
  "resolveStartForElement" | "resolveDurationForElement"
>;

const aboveOneFrame = (seconds: number | null): number | null =>
  seconds !== null && seconds > MIN_VALID_TIMELINE_DURATION_SECONDS ? seconds : null;

/** The size the runtime reports to its host. */
export function readCompositionSize(root: Element): {
  width: number | null;
  height: number | null;
} {
  return {
    width: parseCompositionDimension(root.getAttribute("data-width")),
    height: parseCompositionDimension(root.getAttribute("data-height")),
  };
}

/** The latest end among the document's timed video and audio, at their absolute starts. */
export function resolveMediaWindowDurationSeconds(
  doc: ParentNode,
  media: {
    mediaStart: (el: HTMLMediaElement) => number;
    mediaDuration: (el: HTMLMediaElement) => number | null;
  },
): number | null {
  const clipEnds: number[] = [];
  for (const node of doc.querySelectorAll<HTMLMediaElement>(
    "video[data-start], audio[data-start]",
  )) {
    const start = media.mediaStart(node);
    if (!Number.isFinite(start)) continue;
    const duration = media.mediaDuration(node);
    if (duration == null || duration <= MIN_VALID_TIMELINE_DURATION_SECONDS) continue;
    clipEnds.push(Math.max(0, start) + duration);
  }
  return aboveOneFrame(
    resolveCompositionDuration({ authoredDurationSeconds: null, clipEndsSeconds: clipEnds })
      .seconds,
  );
}

/** The latest of the root's declared length and its direct sub-compositions' ends. */
export function resolveAuthoredCompositionFloorSeconds(
  root: Element,
  startResolver: StartResolver,
): number | null {
  const subCompositionEnds: number[] = [];
  for (const node of root.querySelectorAll("[data-composition-id][data-start]")) {
    if (node.parentElement?.closest("[data-composition-id]") !== root) continue;
    const start = startResolver.resolveStartForElement(node, 0);
    const duration = startResolver.resolveDurationForElement(node);
    if (!Number.isFinite(start) || duration == null || duration <= 0) continue;
    subCompositionEnds.push(Math.max(0, start) + duration);
  }
  const declared = parseStrictFiniteTimingNumber(root.getAttribute("data-duration"));
  return aboveOneFrame(
    resolveCompositionDuration({
      authoredDurationSeconds: null,
      clipEndsSeconds: [declared, ...subCompositionEnds],
    }).seconds,
  );
}

const isCompositionHost = (node: Element): boolean =>
  node.hasAttribute("data-composition-id") || node.hasAttribute("data-composition-src");

/** The last-resort length: the latest end among the root's timed clips. Until every clip's length
 *  is known it is unresolved, so a renderer that reads it once cannot lock in a short one.
 *  `unregisteredLottie`: a Lottie library is loaded, so animations may still register. */
export function resolveContentDerivedDuration(
  root: Element,
  startResolver: StartResolver,
  { unregisteredLottie }: { unregisteredLottie: boolean },
): CompositionDurationResult {
  const clipEnds: Array<number | null> = [];
  for (const node of root.querySelectorAll("[data-start]")) {
    const start = startResolver.resolveStartForElement(node, 0);
    if (!Number.isFinite(start)) continue;
    const duration = startResolver.resolveDurationForElement(node);
    if (duration != null) clipEnds.push(Math.max(0, start) + duration);
    else if (isMediaElement(node) || isCompositionHost(node)) clipEnds.push(null);
  }
  if (unregisteredLottie || root.querySelector("[data-lottie-src]")) clipEnds.push(null);
  const result = resolveCompositionDuration({
    authoredDurationSeconds: null,
    clipEndsSeconds: clipEnds,
  });
  return result.pendingClips > 0
    ? { ...result, seconds: null, source: "unresolved", reason: "a clip's length is pending" }
    : result;
}

export type CompositionLengthInputs = {
  declared: number | null;
  // Read only when nothing is declared: they can run author or adapter code.
  timeline: () => number | null;
  floors: () => ReadonlyArray<number | null>;
  fallback: number;
  derived: () => number;
};

/** A declared root length is the length; else the longest of timeline, floors and fallback (a
 *  loop-inflated timeline yields to a floor or fallback); else the length derived from the clips. */
export function resolveCompositionLengthSeconds(input: CompositionLengthInputs): number {
  if (input.declared !== null && Number.isFinite(input.declared) && input.declared > 0) {
    return input.declared;
  }
  const rawTimeline = aboveOneFrame(input.timeline());
  const floor = Math.max(0, ...input.floors().map((seconds) => seconds ?? 0));
  const fallback =
    Number.isFinite(input.fallback) && input.fallback > MIN_VALID_TIMELINE_DURATION_SECONDS
      ? input.fallback
      : 0;
  const floorOrFallback = Math.max(floor, fallback);
  const loopInflated =
    rawTimeline !== null &&
    rawTimeline >= LOOP_INFLATED_TIMELINE_SECONDS &&
    aboveOneFrame(floorOrFallback) !== null;
  const timeline = loopInflated ? null : rawTimeline;
  let seconds: number;
  if (timeline !== null) seconds = Math.max(timeline, floorOrFallback);
  else if (aboveOneFrame(floor) !== null) seconds = floorOrFallback;
  else if (fallback > 0) seconds = fallback;
  else seconds = input.derived();
  return seconds > 0 ? seconds : 0;
}

/** Size, frame rate and length of a composition nothing is running (a server-parsed or detached
 *  document): no timelines, no adapters, and media without a known source length is pending. */
export function readStaticCompositionMeta(
  doc: Document,
): { width: number | null; height: number | null; fps: number; durationSeconds: number } | null {
  const root = findRootCompositionElement(doc);
  if (!root) return null;
  const resolver = createRuntimeStartTimeResolver({
    timelineRegistry: {},
    includeAuthoredTimingAttrs: true,
    documentRef: doc,
  });
  const durationSeconds = resolveCompositionLengthSeconds({
    declared: parseStrictFiniteTimingNumber(root.getAttribute("data-duration")),
    timeline: () => null,
    floors: () => [
      resolveMediaWindowDurationSeconds(doc, {
        mediaStart: resolver.resolveMediaStartForElement,
        mediaDuration: resolveMediaElementDurationSeconds,
      }),
      resolveAuthoredCompositionFloorSeconds(root, resolver),
    ],
    fallback: 0,
    derived: () =>
      resolveContentDerivedDuration(root, resolver, { unregisteredLottie: false }).seconds ?? 0,
  });
  return { ...readCompositionSize(root), fps: createRuntimeState().canonicalFps, durationSeconds };
}
