/**
 * Internal clipboard for automation ranges. Module-level, not the OS
 * clipboard — points are not text, and useClipboard is already the DOM-element
 * channel. Values cross parameters through unit space, so a volume duck
 * pasted onto a log-scaled wet knob lands proportionally, not literally.
 */
import type {
  AutomationRange,
  HfAutomationLane,
  HfAutomationPoint,
} from "@hyperframes/core/audio-automation";
import { fromUnit, toUnit } from "./automationLaneGeometry";
import { pointsIn } from "./automationLaneSelection";

export interface AutomationClipboardEntry {
  sourceRange: AutomationRange;
  span: number;
  points: HfAutomationPoint[];
}

let entry: AutomationClipboardEntry | null = null;

export function copyRange(
  lane: HfAutomationLane,
  range: AutomationRange,
  t0: number,
  t1: number,
): void {
  entry = {
    sourceRange: range,
    span: t1 - t0,
    points: pointsIn(lane, t0, t1).map((p) => ({ ...p, t: p.t - t0 })),
  };
}

export function readClipboard(): AutomationClipboardEntry | null {
  return entry;
}

export function pastePoints(
  from: AutomationClipboardEntry,
  target: AutomationRange,
  atT: number,
): HfAutomationPoint[] {
  return from.points.map((p) => ({
    ...p,
    t: atT + p.t,
    v: fromUnit(target, toUnit(from.sourceRange, p.v)),
  }));
}

export function clearAutomationClipboard(): void {
  entry = null;
}
