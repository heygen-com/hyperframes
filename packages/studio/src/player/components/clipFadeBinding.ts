import { OPACITY_TARGET, VOLUME_TARGET } from "@hyperframes/core/audio-automation";
import { laneFor, withLane } from "./automationLaneGeometry";
import {
  envelopeFadeSampler,
  readClipFadeCurves,
  readClipFades,
  writeClipFades,
  type ClipFadeCurves,
  type ClipFades,
  type FadeSampler,
} from "./clipFades";
import type { AutomationLaneBinding } from "./useAutomationLanes";
import type { TimelineElement } from "../store/playerStore";
import { isAudioTimelineElement } from "../../utils/timelineInspector";

/**
 * Wiring the fade grips to the clip's own envelope.
 *
 * There is one storage and one gesture. A fade is a value that moves across a
 * clip's life, which is what `data-automation` is for, so both media keep it
 * there and only the lane differs: sound rides `volume`, picture rides
 * `opacity`. Nothing here writes an attribute of its own.
 *
 * Two things fall out of that which are worth more than the tidiness:
 *
 * - A fade drawn with a grip is the same two breakpoints the automation lane
 *   edits, so it can be refined by hand afterwards, on a video as much as on
 *   music.
 * - A third point dragged into the middle stops it being a fade and makes it an
 *   envelope, with nothing to migrate and no second representation to reconcile.
 */

export interface ClipFadeBinding {
  fades: ClipFades;
  /** How far each ramp is bent; 0 is a straight one. */
  curves: ClipFadeCurves;
  /** How a ramp's level is drawn, read back from the envelope it lives in. */
  sample(edge: "in" | "out"): FadeSampler;
  readOnly: boolean;
  onPreview(next: ClipFades): void;
  onCommit(next: ClipFades): void;
  /** Live while a fade line is dragged, then once more on release. */
  onBend(edge: "in" | "out", curve: number, persist: boolean): void;
}

export interface ClipFadeDeps {
  /** The clip's automation binding, which is the whole read and write path. */
  bindAutomation(element: TimelineElement): AutomationLaneBinding;
}

/** Replace one edge's bend, leaving the other exactly as it was. */
const withBend = (curves: ClipFadeCurves, edge: "in" | "out", curve: number): ClipFadeCurves =>
  edge === "in" ? { ...curves, in: curve } : { ...curves, out: curve };

/**
 * The fade binding for a clip. Every clip gets one; what differs is the lane.
 *
 * Called for every clip the timeline draws, so it stays a read off already
 * parsed state plus a few closures.
 */
export function resolveClipFadeBinding(
  element: TimelineElement,
  deps: ClipFadeDeps,
): ClipFadeBinding | undefined {
  // A clip with no length has no window to fade across.
  if (!(element.duration > 0)) return undefined;

  const target = isAudioTimelineElement(element) ? VOLUME_TARGET : OPACITY_TARGET;
  const binding = deps.bindAutomation(element);
  const lane = laneFor(binding.automation, target);
  const fades = readClipFades(lane.points, element.duration);
  // Each ramp's curvature already lives on the point it leaves, so the envelope
  // has carried two bends all along.
  const curves: ClipFadeCurves = readClipFadeCurves(lane.points, fades);

  const apply = (next: ClipFades, shape: ClipFadeCurves, persist: boolean) => {
    if (binding.readOnly) return;
    const points = writeClipFades(lane.points, element.duration, next, shape);
    const automation = withLane(binding.automation, { target, points });
    // An envelope with no points left is no envelope: drop the lane so the clip
    // goes back to carrying no automation attribute at all.
    const lanes = automation.lanes.filter((l) => l.points.length > 0);
    const value = { ...automation, lanes };
    if (persist) binding.onCommit(value);
    else binding.onPreview(value);
  };

  return {
    fades,
    curves,
    sample: (edge) => envelopeFadeSampler(edge === "in" ? curves.in : curves.out),
    readOnly: binding.readOnly,
    onPreview: (next) => apply(next, curves, false),
    onCommit: (next) => apply(next, curves, true),
    onBend: (edge, bend, persist) => apply(fades, withBend(curves, edge, bend), persist),
  };
}
