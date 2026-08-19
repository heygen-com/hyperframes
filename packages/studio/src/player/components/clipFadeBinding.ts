import { laneFor, withLane } from "./automationLaneGeometry";
import {
  FADE_CURVES,
  readClipFades,
  writeClipFades,
  type ClipFades,
  type FadeCurve,
} from "./clipFades";
import type { AutomationLaneBinding } from "./useAutomationLanes";
import type { TimelineElement } from "../store/playerStore";
import { isAudioTimelineElement } from "../../utils/timelineInspector";

/**
 * Wiring the fade grips to the clip's volume envelope.
 *
 * Fades ride the automation the lane UI already edits, so this is a projection
 * of it, not a second store: read the volume lane's head and tail as fades,
 * write them back through the same binding a dragged breakpoint uses. That is
 * what makes the two agree — draw a fade with the grip, open the lane, and the
 * points are there.
 *
 * Audio only for now. A visual clip fades on opacity, which lives in the
 * composition's animation rather than in this envelope.
 */

const VOLUME = "volume";

export interface ClipFadeBinding {
  fades: ClipFades;
  curve: FadeCurve;
  readOnly: boolean;
  onPreview(next: ClipFades): void;
  onCommit(next: ClipFades): void;
  onCycleCurve(): void;
}

/** Which named curve an envelope's fade was written with. */
export function readFadeCurve(curvature: number | undefined): FadeCurve {
  if (!curvature) return "linear";
  const named = (Object.keys(FADE_CURVES) as FadeCurve[]).find(
    (key) => Math.abs(FADE_CURVES[key] - curvature) < 0.05,
  );
  return named ?? "linear";
}

/** The next shape a double-click on the grip moves to. */
export function nextFadeCurve(curve: FadeCurve): FadeCurve {
  const order = Object.keys(FADE_CURVES) as FadeCurve[];
  return order[(order.indexOf(curve) + 1) % order.length]!;
}

/**
 * The fade binding for a clip, or undefined when fades do not apply to it.
 *
 * `bind` is called for every clip the timeline draws, so it must stay cheap:
 * everything here is a read off already-parsed automation plus two closures.
 */
export function resolveClipFadeBinding(
  element: TimelineElement,
  bind: (element: TimelineElement) => AutomationLaneBinding,
): ClipFadeBinding | undefined {
  if (!isAudioTimelineElement(element)) return undefined;
  const binding = bind(element);
  const lane = laneFor(binding.automation, VOLUME);
  const fades = readClipFades(lane.points, element.duration);
  const curve = readFadeCurve(lane.points[0]?.curve);

  const apply = (next: ClipFades, shape: FadeCurve, persist: boolean) => {
    if (binding.readOnly) return;
    const points = writeClipFades(lane.points, element.duration, next, shape);
    const automation = withLane(binding.automation, { target: VOLUME, points });
    // An envelope with no points left is no envelope: drop the lane so the clip
    // goes back to carrying no automation attribute at all.
    const lanes = automation.lanes.filter((l) => l.points.length > 0);
    const value = { ...automation, lanes };
    if (persist) binding.onCommit(value);
    else binding.onPreview(value);
  };

  return {
    fades,
    curve,
    readOnly: binding.readOnly,
    onPreview: (next) => apply(next, curve, false),
    onCommit: (next) => apply(next, curve, true),
    onCycleCurve: () => apply(fades, nextFadeCurve(curve), true),
  };
}
