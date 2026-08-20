import {
  clampFadeCurve,
  formatFadeCurve,
  HF_FADE_CURVE_ATTR,
  HF_FADE_IN_ATTR,
  HF_FADE_OUT_ATTR,
  parseClipFade,
} from "@hyperframes/core/clip-fade";
import { laneFor, withLane } from "./automationLaneGeometry";
import {
  clampClipFades,
  envelopeFadeSampler,
  fadeSampler,
  NO_FADE_CURVES,
  readClipFades,
  writeClipFades,
  type ClipFadeCurves,
  type ClipFades,
  type FadeSampler,
} from "./clipFades";
import type { AutomationLaneBinding } from "./useAutomationLanes";
import type { TimelineElement } from "../store/playerStore";
import { isAudioTimelineElement } from "../../utils/timelineInspector";
import { roundToCenti } from "../../utils/rounding";

/**
 * Wiring the fade grips to whichever place the clip keeps its fade.
 *
 * One gesture, two storages, chosen by what the clip is:
 *
 * - **Audio** rides the volume envelope the automation lane already edits, so a
 *   fade drawn with the grip is there as breakpoints to refine by hand.
 * - **Everything else** carries `data-fade-in` / `data-fade-out`, which the
 *   runtime applies (see `@hyperframes/core/clip-fade`).
 *
 * Both are projections, not new state: each reads back exactly what it wrote.
 */

const VOLUME = "volume";
/** Fade edits of one gesture fold into a single history entry. */
const FADE_COALESCE_MS = 1200;

export interface ClipFadeBinding {
  fades: ClipFades;
  /** How far each ramp is bent; 0 is a straight one. */
  curves: ClipFadeCurves;
  /** How a ramp's level is drawn, read back from where it is stored. */
  sample(edge: "in" | "out"): FadeSampler;
  readOnly: boolean;
  onPreview(next: ClipFades): void;
  onCommit(next: ClipFades): void;
  /** Live while a fade line is dragged, then once more on release. */
  onBend(edge: "in" | "out", curve: number, persist: boolean): void;
}

/** The bend an audio fade's envelope curvature stands for; see clipFades.ts. */
export function readFadeCurve(curvature: number | undefined): number {
  return curvature ? clampFadeCurve(-curvature) : 0;
}

/** Replace one edge's bend, leaving the other exactly as it was. */
const withBend = (curves: ClipFadeCurves, edge: "in" | "out", curve: number): ClipFadeCurves =>
  edge === "in" ? { ...curves, in: curve } : { ...curves, out: curve };

/** Writes one of the clip's own attributes; only valid for the selected clip. */
export type FadeAttributeWriter = (
  attr: string,
  value: string | null,
  persist: boolean,
  coalesce: { key: string; ms: number },
) => void;

export interface ClipFadeDeps {
  /** The clip's automation binding — the audio path's read and write. */
  bindAutomation(element: TimelineElement): AutomationLaneBinding;
  /** The visual path's write. Absent outside an edit session (read-only player). */
  writeAttribute?: FadeAttributeWriter;
  /** True when dom-edit writes would land on THIS clip. */
  isSelected(element: TimelineElement): boolean;
  /**
   * Apply the new fade to the store as well as the file.
   *
   * The attribute write reaches the preview DOM and the file, but the timeline's
   * own element list is only re-derived on a refresh the quiet commit skips — so
   * without this the grip reads its own edit back as stale and the wedge
   * disappears the moment the drag ends.
   */
  updateElement(key: string, updates: Partial<TimelineElement>): void;
}

const keyOf = (element: TimelineElement): string => element.key ?? element.id;
const seconds = (value: number): string | null => (value > 0 ? String(roundToCenti(value)) : null);

/** Audio: the fade is the head and tail of the clip's volume envelope. */
function audioFadeBinding(
  element: TimelineElement,
  binding: AutomationLaneBinding,
): ClipFadeBinding {
  const lane = laneFor(binding.automation, VOLUME);
  const fades = readClipFades(lane.points, element.duration);
  // Each ramp's curvature already lives on the point it leaves, so the envelope
  // has carried two bends all along; only the reader was collapsing them.
  const curves: ClipFadeCurves = {
    in: readFadeCurve(lane.points[0]?.curve),
    out: readFadeCurve(lane.points.at(-2)?.curve),
  };

  const apply = (next: ClipFades, shape: ClipFadeCurves, persist: boolean) => {
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
    curves,
    sample: (edge) => envelopeFadeSampler(edge === "in" ? curves.in : curves.out),
    readOnly: binding.readOnly,
    onPreview: (next) => apply(next, curves, false),
    onCommit: (next) => apply(next, curves, true),
    onBend: (edge, bend, persist) => apply(fades, withBend(curves, edge, bend), persist),
  };
}

interface FadeState {
  fades: ClipFades;
  curves: ClipFadeCurves;
}

/**
 * The curve attribute a fade should carry, or null for none: only worth writing
 * while there is a fade to shape, and a straight ramp is the default, so
 * leaving it off keeps the markup quiet.
 */
const curveAttribute = ({ fades, curves }: FadeState): string | null => {
  const head = fades.fadeIn > 0 ? curves.in : null;
  const tail = fades.fadeOut > 0 ? curves.out : null;
  if (head === null && tail === null) return null;
  // A ramp that does not exist takes the other one's shape rather than a zero,
  // so the attribute collapses to a single value instead of describing a tail
  // that is not there. It is also the right value to inherit if that tail is
  // drawn later: one number has always meant "both ramps, like this".
  return formatFadeCurve(head ?? tail ?? 0, tail ?? head ?? 0);
};

/** The attribute writes moving from one fade state to another implies. */
function fadeAttributeWrites(from: FadeState, to: FadeState): Array<[string, string | null]> {
  const writes: Array<[string, string | null]> = [];
  if (to.fades.fadeIn !== from.fades.fadeIn) {
    writes.push([HF_FADE_IN_ATTR, seconds(to.fades.fadeIn)]);
  }
  if (to.fades.fadeOut !== from.fades.fadeOut) {
    writes.push([HF_FADE_OUT_ATTR, seconds(to.fades.fadeOut)]);
  }
  const next = curveAttribute(to);
  if (next !== curveAttribute(from)) writes.push([HF_FADE_CURVE_ATTR, next]);
  return writes;
}

/** Everything else: the fade is two attributes the runtime reads. */
function visualFadeBinding(
  element: TimelineElement,
  writeAttribute: FadeAttributeWriter | undefined,
  isSelected: boolean,
  updateElement: ClipFadeDeps["updateElement"],
): ClipFadeBinding {
  const declared = parseClipFade((name) => {
    if (name === HF_FADE_IN_ATTR) return element.fadeIn ?? null;
    if (name === HF_FADE_OUT_ATTR) return element.fadeOut ?? null;
    return element.fadeCurve ?? null;
  });
  const fades = clampClipFades(
    { fadeIn: declared?.fadeIn ?? 0, fadeOut: declared?.fadeOut ?? 0 },
    element.duration,
  );
  const curves: ClipFadeCurves = declared
    ? { in: declared.curveIn, out: declared.curveOut }
    : NO_FADE_CURVES;
  const readOnly = !writeAttribute || !isSelected;

  const apply = (next: ClipFades, shape: ClipFadeCurves, persist: boolean) => {
    if (!writeAttribute || readOnly) return;
    const to = { fades: clampClipFades(next, element.duration), curves: shape };
    const coalesce = { key: `clip-fade:${keyOf(element)}`, ms: FADE_COALESCE_MS };
    for (const [attr, value] of fadeAttributeWrites({ fades, curves }, to)) {
      writeAttribute(attr, value, persist, coalesce);
    }
    // On COMMIT only. Applying it during the drag would move the value each
    // write compares against, so by release "nothing changed" and the persisted
    // write never happens — the preview would fade and the file would not.
    if (persist) {
      updateElement(keyOf(element), {
        fadeIn: seconds(to.fades.fadeIn) ?? undefined,
        fadeOut: seconds(to.fades.fadeOut) ?? undefined,
        fadeCurve: curveAttribute(to) ?? undefined,
      });
    }
  };

  return {
    fades,
    curves,
    sample: (edge) => fadeSampler(edge === "in" ? curves.in : curves.out),
    readOnly,
    onPreview: (next) => apply(next, curves, false),
    onCommit: (next) => apply(next, curves, true),
    onBend: (edge, bend, persist) => apply(fades, withBend(curves, edge, bend), persist),
  };
}

/**
 * The fade binding for a clip. Every clip gets one — what differs is where the
 * fade is kept.
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
  if (isAudioTimelineElement(element)) {
    return audioFadeBinding(element, deps.bindAutomation(element));
  }
  return visualFadeBinding(
    element,
    deps.writeAttribute,
    deps.isSelected(element),
    deps.updateElement,
  );
}
