import {
  duplicateElementInHtml,
  patchElementInHtml,
  removeElementFromHtml,
  splitElementInHtml,
} from "@hyperframes/studio-server";
import type { AppliedFileMutation, PatchOperation } from "@hyperframes/studio-server";
import { fpsToNumber, parseFpsWithDefault } from "@hyperframes/core";
import { isInsideSpan, sameInstant, spansShareTime } from "@hyperframes/core/clip-facts";
import { readCompositionFps } from "../utils/compositionFps.js";
import { readFileSync } from "node:fs";
import type { ProjectTimeline, TimelineRow } from "./describeProject.js";
import { resolveRef } from "./resolveRef.js";
import { parseTimeExpression } from "./timeExpr.js";
import { setCommandExitCode } from "../utils/commandResult.js";
import { parseSetAssignments, type SetAssignment } from "./a2Mutations.js";

export type MutationVerb = "move" | "trim" | "split" | "delete" | "set" | "duplicate";

export type MutationDecision =
  | { ok: true; after: string; nextStart: number; nextDuration: number }
  | { ok: false; reason: string; fix: string };

export interface MutationContext {
  ref: string;
  row: TimelineRow;
  before: string;
  resolved: Extract<ReturnType<typeof resolveRef>, { ok: true }>;
  parseTime: (expression: string) => ReturnType<typeof parseTimeExpression>;
  duration: number;
}

type ParsedMutationTime =
  | { ok: true; seconds: number }
  | { ok: false; reason: string; fix: string };

export const allRows = (timeline: ProjectTimeline): TimelineRow[] =>
  timeline.tracks.flatMap((track) => track.rows);

export function refusal(reason: string, fix: string, json: boolean): void {
  setCommandExitCode(2);
  const payload = { ok: false, reason, fix };
  console.error(json ? JSON.stringify(payload, null, 2) : `${reason}; ${fix}.`);
}

export const isFileChanged = (error: unknown): error is Error =>
  error instanceof Error && error.message === "file changed since the timeline was read";

export function refuse(kind: string, detail: { reason: string; fix: string }, json: boolean): void {
  refusal(`${kind}: ${detail.reason}`, detail.fix, json);
}

export function publicReceipt(receipt: AppliedFileMutation) {
  return {
    file: receipt.sourceFile,
    version: receipt.version,
    writeToken: receipt.writeToken,
    changed: receipt.changed,
    backupPath: receipt.backupPath,
  };
}

export function fpsFor(indexPath: string): number {
  const parsed = parseFpsWithDefault(
    readCompositionFps(readFileSync(indexPath, "utf-8")) ?? undefined,
  );
  return fpsToNumber(parsed.ok ? parsed.value : { num: 30, den: 1 });
}

export function declaredFps(source: string): number | null {
  const raw = readCompositionFps(source);
  if (raw === null) return null;
  const parsed = parseFpsWithDefault(raw);
  return parsed.ok ? fpsToNumber(parsed.value) : null;
}

function splitBaseId(row: TimelineRow): string {
  return row.ref.startsWith("hf:") ? row.ref.slice(3) : row.id;
}

function nextFreeSplitId(source: string, base: string): string {
  const document = new DOMParser().parseFromString(source, "text/html");
  const existing = new Set(Array.from(document.querySelectorAll("[id]"), (element) => element.id));
  const match = /^(.*)-(\d+)$/.exec(base);
  const prefix = match && existing.has(match[1]!) ? match[1]! : base;
  let suffix = 2;
  while (existing.has(`${prefix}-${suffix}`)) suffix += 1;
  return `${prefix}-${suffix}`;
}

function parseMutationTime(
  context: MutationContext,
  expression: string,
  fix: string,
): ParsedMutationTime {
  const value = context.parseTime(expression);
  if (!value.ok) return { ok: false, reason: value.reason, fix };
  if (value.seconds < 0 || value.seconds > context.duration) {
    return {
      ok: false,
      reason: `time ${value.seconds} is outside the composition duration`,
      fix: "pass a time between 0 and the composition duration",
    };
  }
  return { ok: true, seconds: value.seconds };
}

export function diff(before: string, after: string): string {
  if (before === after) return "";
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  let prefix = 0;
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - suffix - 1] === afterLines[afterLines.length - suffix - 1]
  ) {
    suffix += 1;
  }
  const changedBefore = beforeLines.slice(prefix, beforeLines.length - suffix);
  const changedAfter = afterLines.slice(prefix, afterLines.length - suffix);
  const lines = [
    "--- before",
    "+++ after",
    ...changedBefore.map((line) => `-${line}`),
    ...changedAfter.map((line) => `+${line}`),
  ];
  const output = lines.join("\n");
  return output.length <= 8_000 ? output : `${output.slice(0, 7_997)}...`;
}

function overlap(
  row: TimelineRow,
  timeline: ProjectTimeline,
  start: number,
  end: number,
): TimelineRow | undefined {
  return allRows(timeline).find(
    (candidate) =>
      candidate !== row &&
      candidate.file === row.file &&
      candidate.trackIndex === row.trackIndex &&
      spansShareTime(start, end, candidate.start, candidate.end),
  );
}

function moveMutation(context: MutationContext, args: Record<string, unknown>): MutationDecision {
  const expression = typeof args.time === "string" ? args.time : "";
  const time = parseMutationTime(context, expression, "pass a valid time expression");
  if (!time.ok) return time;
  const end = time.seconds + context.row.duration;
  if (end > context.duration) {
    return {
      ok: false,
      reason: `move would end at ${end}, beyond composition duration ${context.duration}`,
      fix: `choose a start at or before the latest valid start ${context.duration - context.row.duration}`,
    };
  }
  const patched = patchElementInHtml(context.before, context.resolved.target, [
    { type: "html-attribute", property: "data-start", value: String(time.seconds) },
  ]);
  if (!patched.matched) {
    return { ok: false, reason: `${context.ref} was not found`, fix: "choose an existing clip" };
  }
  return {
    ok: true,
    after: patched.html,
    nextStart: time.seconds,
    nextDuration: context.row.duration,
  };
}

function splitMutation(context: MutationContext, args: Record<string, unknown>): MutationDecision {
  const expression = typeof args.time === "string" ? args.time : "";
  const time = parseMutationTime(context, expression, "pass a valid time expression");
  if (!time.ok) return time;
  const split = splitElementInHtml(
    context.before,
    context.resolved.target,
    time.seconds,
    nextFreeSplitId(context.before, splitBaseId(context.row)),
    {
      start: context.row.start,
      duration: context.row.duration,
      track: context.row.trackIndex,
    },
  );
  if (!split.matched || !split.newId) {
    return {
      ok: false,
      reason: `${context.ref} cannot be split at ${time.seconds}`,
      fix: "choose a time inside the clip",
    };
  }
  return {
    ok: true,
    after: split.html,
    nextStart: context.row.start,
    nextDuration: context.row.duration,
  };
}

function trimMutation(context: MutationContext, args: Record<string, unknown>): MutationDecision {
  const bounds = trimBounds(context, args);
  if (!bounds.ok) return bounds;
  const patched = patchElementInHtml(context.before, context.resolved.target, [
    { type: "html-attribute", property: "data-start", value: String(bounds.nextStart) },
    { type: "html-attribute", property: "data-duration", value: String(bounds.nextDuration) },
  ]);
  if (!patched.matched) {
    return { ok: false, reason: `${context.ref} was not found`, fix: "choose an existing clip" };
  }
  return {
    ok: true,
    after: patched.html,
    nextStart: bounds.nextStart,
    nextDuration: bounds.nextDuration,
  };
}

function trimBounds(
  context: MutationContext,
  args: Record<string, unknown>,
): MutationDecision | { ok: true; nextStart: number; nextDuration: number } {
  const input = trimInput(args);
  if (!input.ok) return input;
  const start = trimStart(context, input.start);
  if (!start.ok) return start;
  return finishTrim(
    context,
    start.seconds,
    trimEnd(context, input.end),
    trimDuration(context, input.duration),
  );
}

function trimInput(args: Record<string, unknown>) {
  const input = {
    start: typeof args.start === "string" ? args.start : undefined,
    end: typeof args.end === "string" ? args.end : undefined,
    duration: typeof args.duration === "string" ? args.duration : undefined,
  };
  if (input.start || input.end || input.duration) return { ok: true as const, ...input };
  return {
    ok: false as const,
    reason: "trim requires --start, --end, or --duration",
    fix: "pass one trim option",
  };
}

const leavesNoLength = (start: number, duration: number) =>
  duration <= 0 || sameInstant(start, start + duration);

function finishTrim(
  context: MutationContext,
  nextStart: number,
  end: ReturnType<typeof trimEnd>,
  duration: ReturnType<typeof trimDuration>,
): MutationDecision | { ok: true; nextStart: number; nextDuration: number } {
  if (end && !end.ok) return end;
  if (duration && !duration.ok) return duration;
  const nextDuration =
    duration?.seconds ?? (end ? durationUntil(nextStart, end.seconds) : context.row.duration);
  if (leavesNoLength(nextStart, nextDuration)) {
    return {
      ok: false,
      reason: "trim duration must be positive",
      fix: "choose a later end or positive duration",
    };
  }
  return { ok: true, nextStart, nextDuration };
}

function trimStart(context: MutationContext, expression: string | undefined) {
  if (!expression) return { ok: true as const, seconds: context.row.start };
  return parseMutationTime(context, expression, "pass a valid time expression");
}

function durationUntil(start: number, end: number): number {
  let duration = end - start;
  while (duration > 0 && start + duration > end) duration = nextSmaller(duration);
  return duration;
}

const float = new DataView(new ArrayBuffer(8));
function nextSmaller(positive: number): number {
  float.setFloat64(0, positive);
  float.setBigUint64(0, float.getBigUint64(0) - 1n);
  return float.getFloat64(0);
}

function trimEnd(context: MutationContext, expression: string | undefined) {
  if (!expression) return undefined;
  return parseMutationTime(context, expression, "pass a valid time expression");
}

function trimDuration(context: MutationContext, expression: string | undefined) {
  if (!expression) return undefined;
  return parseMutationTime(context, expression, "pass a valid duration");
}

function deleteMutation(context: MutationContext): MutationDecision {
  return {
    ok: true,
    after: removeElementFromHtml(context.before, context.resolved.target),
    nextStart: context.row.start,
    nextDuration: context.row.duration,
  };
}

function setOperation(assignment: SetAssignment): PatchOperation {
  const property =
    assignment.field === "volume"
      ? "data-volume"
      : assignment.field === "rate"
        ? "data-playback-rate"
        : "data-track-index";
  return { type: "html-attribute", property, value: assignment.value };
}

function setMutation(context: MutationContext, args: Record<string, unknown>): MutationDecision {
  const positionalAssignments = positional(args)
    .slice(1)
    .filter((value): value is string => typeof value === "string");
  const namedAssignments = ["volume", "rate", "track"].flatMap((field) => {
    const value = args[field];
    return typeof value === "string" ? [`${field}=${value}`] : [];
  });
  const assignments = parseSetAssignments([...positionalAssignments, ...namedAssignments]);
  if (!assignments.ok) return assignments;
  const patched = patchElementInHtml(
    context.before,
    context.resolved.target,
    assignments.assignments.map(setOperation),
  );
  if (!patched.matched) {
    return { ok: false, reason: `${context.ref} was not found`, fix: "choose an existing clip" };
  }
  return {
    ok: true,
    after: patched.html,
    nextStart: context.row.start,
    nextDuration: context.row.duration,
  };
}

function duplicateMutation(
  context: MutationContext,
  args: Record<string, unknown>,
): MutationDecision {
  const expression = typeof args.at === "string" ? args.at : String(context.row.end);
  const time = parseMutationTime(context, expression, "pass a valid insertion time");
  if (!time.ok) return time;
  const duplicate = duplicateElementInHtml(
    context.before,
    context.resolved.target,
    `${splitBaseId(context.row)}-copy`,
    time.seconds,
  );
  if (!duplicate.matched) {
    return { ok: false, reason: `${context.ref} was not found`, fix: "choose an existing clip" };
  }
  return {
    ok: true,
    after: duplicate.html,
    nextStart: time.seconds,
    nextDuration: context.row.duration,
  };
}

export function decideMutation(
  verb: MutationVerb,
  context: MutationContext,
  args: Record<string, unknown>,
): MutationDecision {
  switch (verb) {
    case "move":
      return moveMutation(context, args);
    case "trim":
      return trimMutation(context, args);
    case "split":
      return splitMutation(context, args);
    case "delete":
      return deleteMutation(context);
    case "set":
      return setMutation(context, args);
    case "duplicate":
      return duplicateMutation(context, args);
  }
}

export function rowAt(
  timeline: ProjectTimeline,
  pointer: { kind: TimelineRow["trackKind"]; index: number },
): TimelineRow {
  const track = timeline.tracks.find((candidate) => candidate.kind === pointer.kind);
  if (!track) throw new Error(`missing track ${pointer.kind}`);
  const row = track.rows[pointer.index];
  if (!row) throw new Error(`missing row ${pointer.kind}/${pointer.index}`);
  return row;
}

export function positional(args: Record<string, unknown>): string[] {
  return Array.isArray(args._)
    ? args._.filter((value): value is string => typeof value === "string")
    : [];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mutationConflict(
  verb: MutationVerb,
  overwrite: boolean,
  row: TimelineRow,
  timeline: ProjectTimeline,
  nextStart: number,
  nextDuration: number,
): { reason: string; fix: string } | null {
  if (verb === "duplicate") {
    const conflict = allRows(timeline).find(
      (candidate) =>
        candidate.file === row.file &&
        candidate.trackIndex === row.trackIndex &&
        isInsideSpan(nextStart, candidate.start, candidate.end),
    );
    if (!conflict) return null;
    return {
      reason: `duplicate insertion at ${nextStart} falls inside ${conflict.ref}`,
      fix: "choose a clip boundary or split the spanning clip first",
    };
  }
  if ((verb !== "move" && verb !== "trim") || overwrite) return null;
  const conflict = overlap(row, timeline, nextStart, nextStart + nextDuration);
  if (!conflict) return null;
  return {
    reason: `${row.ref} would overlap ${conflict.ref} at ${nextStart}-${nextStart + nextDuration}`,
    fix: "pass --overwrite or move the named neighbour",
  };
}
