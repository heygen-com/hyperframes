// A gsap-snapshot reply is frame data: Studio holds one only in the shape and within the
// bounds the frame keeps to.
import {
  MAX_SNAPSHOT_CHANNELS,
  MAX_SNAPSHOT_FIELDS,
  MAX_SNAPSHOT_TARGETS,
  MAX_SNAPSHOT_TEXT,
  MAX_SNAPSHOT_TWEENS,
  MAX_VARS_DEPTH,
  TARGET_FIELDS,
  TIMELINE_FIELDS,
  type EditingResult,
} from "@hyperframes/core/runtime/editing-port";
import { isFields, isHandle } from "../player/lib/previewElements";

type Snapshot = EditingResult<"gsap-snapshot">;
/** What the whole reply may still spend, shared by every tween and vars field in it. */
type Budget = { tweens: number; fields: number };

const isText = (value: unknown): value is string =>
  typeof value === "string" && value.length <= MAX_SNAPSHOT_TEXT;
const isTextOrNull = (value: unknown) => value === null || isText(value);
const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const isNumberOrNull = (value: unknown) => value === null || isNumber(value);
const isList = (value: unknown, max: number): value is unknown[] =>
  Array.isArray(value) && value.length <= max;

/** The reply as a snapshot, or null when any part of it is off its shape or past a bound. */
export function readGsapSnapshot(value: unknown): Snapshot | null {
  if (!isFields(value) || !isNumberOrNull(value.time) || !isTextOrNull(value.defaultEase))
    return null;
  const budget: Budget = { tweens: MAX_SNAPSHOT_TWEENS, fields: MAX_SNAPSHOT_FIELDS };
  const { timelines, globalTweens, targets } = value;
  const ok =
    isList(timelines, MAX_SNAPSHOT_TWEENS) &&
    timelines.every((line) => isTimeline(line, budget)) &&
    isList(globalTweens, MAX_SNAPSHOT_TWEENS) &&
    globalTweens.every((tween) => isTween(tween, budget)) &&
    isList(targets, MAX_SNAPSHOT_TARGETS) &&
    targets.every((target) => isTarget(target, budget));
  return ok ? (value as unknown as Snapshot) : null;
}

function isTimeline(value: unknown, budget: Budget): boolean {
  return (
    (budget.fields -= TIMELINE_FIELDS) >= 0 &&
    isFields(value) &&
    isText(value.id) &&
    isNumberOrNull(value.time) &&
    isTextOrNull(value.defaultEase) &&
    isList(value.tweens, MAX_SNAPSHOT_TWEENS) &&
    value.tweens.every((tween) => isTween(tween, budget))
  );
}

function isTween(value: unknown, budget: Budget): boolean {
  if ((budget.tweens -= 1) < 0 || !isFields(value)) return false;
  return (
    isTargetHandles(value.targets) &&
    (budget.fields -= value.targets.length) >= 0 &&
    isFields(value.vars) &&
    isVars(value.vars, budget, 0) &&
    isTiming(value) &&
    isParsed(value.parsed) &&
    areParts(value.parts, budget)
  );
}

const isTargetHandles = (value: unknown): value is string[] =>
  isList(value, MAX_SNAPSHOT_TARGETS) && value.every(isHandle);

const isTiming = (tween: Record<string, unknown>) =>
  isNumber(tween.start) &&
  isNumber(tween.duration) &&
  typeof tween.from === "boolean" &&
  typeof tween.initted === "boolean";

const isChannel = (value: unknown) =>
  isFields(value) && isText(value.p) && isNumber(value.s) && isNumber(value.c);

const isParsed = (value: unknown) => isList(value, MAX_SNAPSHOT_CHANNELS) && value.every(isChannel);

function areParts(value: unknown, budget: Budget): boolean {
  return isList(value, MAX_SNAPSHOT_TWEENS) && value.every((part) => isTween(part, budget));
}

/** A plain vars value: finite numbers, bounded text, booleans, null, and lists and records
 *  no deeper than the frame's. */
function isVars(value: unknown, budget: Budget, depth: number): boolean {
  if ((budget.fields -= 1) < 0) return false;
  if (value === null || typeof value === "boolean" || isNumber(value) || isText(value)) return true;
  if (depth >= MAX_VARS_DEPTH) return false;
  if (Array.isArray(value)) return value.every((item) => isVars(item, budget, depth + 1));
  return (
    isFields(value) &&
    Object.entries(value).every(([key, item]) => isText(key) && isVars(item, budget, depth + 1))
  );
}

function isTarget(value: unknown, budget: Budget): boolean {
  if (!isFields(value) || !isFields(value.values)) return false;
  const values = Object.entries(value.values);
  return (
    (budget.fields -= TARGET_FIELDS + values.length) >= 0 &&
    isHandle(value.handle) &&
    isText(value.id) &&
    isText(value.className) &&
    values.length <= MAX_SNAPSHOT_CHANNELS &&
    values.every(([key, number]) => isText(key) && isNumber(number))
  );
}
