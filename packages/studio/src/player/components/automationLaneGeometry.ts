/**
 * The maths behind an automation lane: which parameters it can offer, how a
 * value maps to a position in the lane, and how a lane is edited.
 *
 * Pure — no React, no DOM. Split from the lane component so the geometry can be
 * tested on its own, and so the component is left with the parts that genuinely
 * need a pointer and a render.
 */

import {
  fxAutomationTarget,
  resolveAutomationRange,
  VOLUME_RANGE,
  VOLUME_TARGET,
  type AutomationRange,
  type HfAutomation,
  type HfAutomationLane,
} from "@hyperframes/core/audio-automation";
import { getAudioFxDef, type HfAudioFxChain } from "@hyperframes/core/audio-fx";

/** Points nearer than this in clip seconds are the same point, not two. */
export const POINT_MERGE_SEC = 0.02;
/** Hit radius for grabbing a point, in px. */
export const GRAB_PX = 7;
/** Samples used to draw a segment the eye should see as curved. */
export const DRAW_SAMPLES = 64;
/**
 * Slack on each side of the envelope, so a point sitting exactly at the clip's
 * start or end is drawn whole instead of half outside the lane. Wide enough for
 * the grab circle plus its stroke.
 */
export const PAD_X = GRAB_PX + 2;

export interface AutomationTargetOption {
  target: string;
  label: string;
  range: AutomationRange;
}

/**
 * Everything this clip could automate: its fader, then each automatable knob of
 * each effect in its chain. Effects with no chain node id are skipped — a lane
 * has nothing stable to address them by (the panel mints ids as it adds nodes).
 */
export function automationTargets(chain: HfAudioFxChain | null): AutomationTargetOption[] {
  const out: AutomationTargetOption[] = [
    { target: VOLUME_TARGET, label: "Volume", range: VOLUME_RANGE },
  ];
  for (const node of chain?.nodes ?? []) {
    out.push(...nodeTargets(node, chain));
  }
  return out;
}

/** One effect's automatable knobs. Empty for a node no lane could address. */
function nodeTargets(
  node: HfAudioFxChain["nodes"][number],
  chain: HfAudioFxChain | null,
): AutomationTargetOption[] {
  const nodeId = node.id;
  const def = nodeId ? getAudioFxDef(node.type) : undefined;
  if (!nodeId || !def) return [];
  const out: AutomationTargetOption[] = [];
  for (const param of def.params) {
    if (param.kind !== "number" || !param.automatable) continue;
    const target = fxAutomationTarget(nodeId, param.key);
    const range = resolveAutomationRange(target, chain ?? undefined);
    if (range) out.push({ target, label: range.label, range });
  }
  return out;
}

/** Value → 0..1 up the lane, honouring a log-read knob's own scale. */
export function toUnit(range: AutomationRange, value: number): number {
  const { min, max } = range;
  if (max <= min) return 0;
  if (range.scale === "log" && min > 0 && value > 0) {
    return (Math.log(value) - Math.log(min)) / (Math.log(max) - Math.log(min));
  }
  return (value - min) / (max - min);
}

export function fromUnit(range: AutomationRange, unit: number): number {
  const t = Math.min(1, Math.max(0, unit));
  const { min, max } = range;
  if (range.scale === "log" && min > 0) {
    return Math.exp(Math.log(min) + t * (Math.log(max) - Math.log(min)));
  }
  return min + t * (max - min);
}

export function formatValue(range: AutomationRange, value: number): string {
  const decimals = range.step >= 1 ? 0 : range.step >= 0.1 ? 1 : 2;
  const shown =
    range.unit === "" && range.max === 1 ? `${Math.round(value * 100)}%` : value.toFixed(decimals);
  return range.unit ? `${shown} ${range.unit}` : shown;
}

export function laneFor(automation: HfAutomation, target: string): HfAutomationLane {
  return automation.lanes.find((l) => l.target === target) ?? { target, points: [] };
}

/**
 * Replace one lane in place, dropping it when it has no points left.
 *
 * Order is preserved deliberately. A lane with no explicitly chosen parameter
 * shows whichever comes first, so moving the edited one to the end would switch
 * the lane out from under the pointer on the first edit.
 */
export function withLane(automation: HfAutomation, lane: HfAutomationLane): HfAutomation {
  const empty = lane.points.length === 0;
  const exists = automation.lanes.some((l) => l.target === lane.target);
  const lanes = automation.lanes
    .map((l) => (l.target === lane.target ? lane : l))
    .filter((l) => l.points.length > 0);
  if (!exists && !empty) lanes.push(lane);
  return { version: 1, lanes };
}
