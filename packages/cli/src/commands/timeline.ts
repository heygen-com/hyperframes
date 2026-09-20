import {
  applyFileMutations,
  fileContentVersion,
  patchElementInHtml,
  removeElementFromHtml,
  splitElementInHtml,
} from "@hyperframes/studio-server";
import type { AppliedFileMutation } from "@hyperframes/studio-server";
import { fpsToNumber, parseFpsWithDefault } from "@hyperframes/core";
import { readCompositionFps } from "../utils/compositionFps.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import {
  describeProject,
  type ProjectTimeline,
  type TimelineRow,
} from "../timeline/describeProject.js";
import { formatTimeline } from "../timeline/formatTimeline.js";
import { resolveRef } from "../timeline/resolveRef.js";
import { parseTimeExpression } from "../timeline/timeExpr.js";
import { ensureDOMParser } from "../utils/dom.js";
import { setCommandExitCode } from "../utils/commandResult.js";
import { resolveProject } from "../utils/project.js";
import { withMeta } from "../utils/updateCheck.js";

export const examples: Example[] = [
  ["Show every track and clip of the project in the current directory", "hyperframes timeline"],
  ["Move a clip without writing", "hyperframes timeline move '#hero' +2 --plan"],
  ["Delete a clip and return a receipt", "hyperframes timeline delete '#hero' --json"],
];

type MutationVerb = "move" | "trim" | "split" | "delete";

type MutationDecision =
  | { ok: true; after: string; nextStart: number; nextDuration: number }
  | { ok: false; reason: string; fix: string };

interface MutationContext {
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

const allRows = (timeline: ProjectTimeline): TimelineRow[] =>
  timeline.tracks.flatMap((track) => track.rows);

function refusal(reason: string, fix: string, json: boolean): void {
  setCommandExitCode(2);
  const payload = { ok: false, reason, fix };
  console.error(json ? JSON.stringify(payload, null, 2) : `${reason}; ${fix}.`);
}

function fpsFor(indexPath: string): number {
  const parsed = parseFpsWithDefault(
    readCompositionFps(readFileSync(indexPath, "utf-8")) ?? undefined,
  );
  return fpsToNumber(parsed.ok ? parsed.value : { num: 30, den: 1 });
}

function declaredFps(source: string): number | null {
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
  const existing = new Set(
    Array.from(document.querySelectorAll("[id]"), (element) => element.id),
  );
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

function diff(before: string, after: string): string {
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
      Math.max(start, candidate.start) < Math.min(end, candidate.end),
  );
}

function moveMutation(context: MutationContext, args: Record<string, unknown>): MutationDecision {
  const expression = typeof args.time === "string" ? args.time : "";
  const time = parseMutationTime(context, expression, "pass a valid time expression");
  if (!time.ok) return time;
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
  return { ok: true, after: patched.html, ...bounds };
}

function trimBounds(
  context: MutationContext,
  args: Record<string, unknown>,
): MutationDecision | { ok: true; nextStart: number; nextDuration: number } {
  const startExpr = typeof args.start === "string" ? args.start : undefined;
  const endExpr = typeof args.end === "string" ? args.end : undefined;
  const durationExpr = typeof args.duration === "string" ? args.duration : undefined;
  if (!startExpr && !endExpr && !durationExpr) {
    return {
      ok: false,
      reason: "trim requires --start, --end, or --duration",
      fix: "pass one trim option",
    };
  }
  const start = startExpr
    ? parseMutationTime(context, startExpr, "pass a valid time expression")
    : { ok: true as const, seconds: context.row.start };
  if (!start.ok) return start;
  const end = endExpr
    ? parseMutationTime(context, endExpr, "pass a valid time expression")
    : undefined;
  if (end && !end.ok) return end;
  const duration = durationExpr
    ? parseMutationTime(context, durationExpr, "pass a valid duration")
    : undefined;
  if (duration && !duration.ok) return duration;
  const nextStart = start.seconds;
  const nextDuration = duration?.seconds ?? (end ? end.seconds - nextStart : context.row.duration);
  if (nextDuration <= 0) {
    return {
      ok: false,
      reason: "trim duration must be positive",
      fix: "choose a later end or positive duration",
    };
  }
  return { ok: true, nextStart, nextDuration };
}

function deleteMutation(context: MutationContext): MutationDecision {
  return {
    ok: true,
    after: removeElementFromHtml(context.before, context.resolved.target),
    nextStart: context.row.start,
    nextDuration: context.row.duration,
  };
}

function decideMutation(
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
  }
}

async function runMutation(verb: MutationVerb, args: Record<string, unknown>): Promise<void> {
  const setup = await prepareMutation(args);
  if (!setup.ok) return refusal(setup.reason, setup.fix, setup.json);
  const decision = decideMutation(verb, setup.context, args);
  if (!decision.ok) return refusal(decision.reason, decision.fix, setup.json);
  await finishMutation(setup, verb, decision);
}

interface MutationSetup {
  ok: true;
  project: ReturnType<typeof resolveProject>;
  ref: string;
  json: boolean;
  plan: boolean;
  overwrite: boolean;
  timeline: ProjectTimeline;
  indexSource: string;
  row: TimelineRow;
  resolved: Extract<ReturnType<typeof resolveRef>, { ok: true }>;
  filePath: string;
  before: string;
  expectedVersion: string;
  context: MutationContext;
}

type MutationSetupResult = MutationSetup | { ok: false; reason: string; fix: string; json: boolean };

async function prepareMutation(args: Record<string, unknown>): Promise<MutationSetupResult> {
  const project = resolveProject(typeof args.dir === "string" ? args.dir : undefined);
  const ref = typeof args.ref === "string" ? args.ref : "";
  const json = args.json === true;
  const plan = args.plan === true;
  const overwrite = args.overwrite === true;
  const snap = args.snap === true;
  ensureDOMParser();
  const indexSource = readFileSync(project.indexPath, "utf-8");
  const initialTimeline = await describeProject(
    project.indexPath,
    undefined,
    new Map([["index.html", indexSource]]),
  );
  const projectFps = declaredFps(indexSource);
  if (snap && projectFps === null) {
    return { ok: false, reason: "project fps is unknown", fix: "set data-fps on the project, then rerun with --snap", json };
  }
  const initialResolved = resolveRef(initialTimeline, ref);
  if (!initialResolved.ok) return { ok: false, reason: initialResolved.reason, fix: initialResolved.fix, json };
  const initialRow = initialResolved.row;
  const filePath = join(project.dir, initialRow.file);
  const before = readFileSync(filePath, "utf-8");
  const expectedVersion = fileContentVersion(before);
  const sources = new Map([
    ["index.html", indexSource],
    [initialRow.file, before],
  ]);
  const timeline = await describeProject(project.indexPath, undefined, sources);
  const resolved = resolveRef(timeline, ref);
  if (!resolved.ok) return { ok: false, reason: resolved.reason, fix: resolved.fix, json };
  const row = resolved.row;
  const anchor = (anchorRef: string) => {
    const found = resolveRef(timeline, anchorRef);
    return found.ok ? found.row : undefined;
  };
  const parseTime = (expression: string) => {
    const parsed = parseTimeExpression(expression, {
      row,
      duration: timeline.duration,
      fps: fpsFor(project.indexPath),
      resolveAnchor: anchor,
    });
    if (!parsed.ok || !snap) return parsed;
    return { ok: true as const, seconds: Math.round(parsed.seconds * projectFps!) / projectFps! };
  };
  return {
    ok: true,
    project,
    ref,
    json,
    plan,
    overwrite,
    timeline,
    indexSource,
    row,
    resolved,
    filePath,
    before,
    expectedVersion,
    context: { ref, row, before, resolved, parseTime, duration: timeline.duration },
  };
}

async function finishMutation(
  setup: MutationSetup,
  verb: MutationVerb,
  decision: Extract<MutationDecision, { ok: true }>,
): Promise<void> {
  const { after, nextStart, nextDuration } = decision;
  const { ref, row, timeline, json, overwrite, project, filePath, before, expectedVersion } = setup;
  const refusalMessage = mutationRefusal(verb, after, before, ref);
  if (refusalMessage) return refusal(refusalMessage.reason, refusalMessage.fix, json);
  const conflict = mutationConflict(verb, overwrite, row, timeline, nextStart, nextDuration);
  if (conflict) return refusal(conflict.reason, conflict.fix, json);
  const describeSource = (source: string): Promise<ProjectTimeline> =>
    describeProject(project.indexPath, undefined, new Map([["index.html", setup.indexSource], [row.file, source]]));
  const describedBefore = await describeSource(before);
  const result = mutationResult(row, describedBefore, setup.plan);
  if (setup.plan) return printPlan(result, json, timeline, describeSource, after, before);
  const receipt = applyMutation(setup, after);
  if (receipt && "error" in receipt) return refusal(receipt.error, "re-run hyperframes timeline", json);
  if (!receipt && after !== before) return refusal("mutation produced no receipt", "re-run hyperframes timeline", json);
  result.after = rowsForFile(await describeSource(after), row.file);
  result.receipt = receipt;
  if (json) console.log(JSON.stringify(withMeta(result), null, 2));
  else console.log(`${verb} ${row.ref}: ${row.start}-${row.end}s -> ${nextStart}-${nextStart + nextDuration}s\nreceipt: ${receipt?.version ?? "unchanged"}`);
}

function rowsForFile(timeline: ProjectTimeline, file: string): TimelineRow[] {
  return allRows(timeline).filter((candidate) => candidate.file === file);
}

function mutationResult(row: TimelineRow, before: ProjectTimeline, planned: boolean) {
  return {
    ok: true,
    receipt: null as unknown,
    file: row.file,
    before: rowsForFile(before, row.file),
    after: [] as TimelineRow[],
    warnings: row.warnings,
    planned,
  };
}

async function printPlan(
  result: ReturnType<typeof mutationResult>,
  json: boolean,
  timeline: ProjectTimeline,
  describeSource: (source: string) => Promise<ProjectTimeline>,
  after: string,
  before: string,
): Promise<void> {
  const plannedTimeline = await describeSource(after);
  result.after = rowsForFile(plannedTimeline, result.file);
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log(`${formatTimeline(timeline)}\n\nplanned:\n${formatTimeline(plannedTimeline)}\n\ndiff:\n${diff(before, after)}`);
}

function applyMutation(
  setup: MutationSetup,
  after: string,
): AppliedFileMutation | { error: string } | undefined {
  try {
    return applyFileMutations(setup.project.dir, [
      { sourceFile: setup.row.file, absPath: setup.filePath, before: setup.before, after, expectedVersion: setup.expectedVersion },
    ])[0];
  } catch (error) {
    if (error instanceof Error && error.message === "file changed since the timeline was read") {
      return { error: error.message };
    }
    throw error;
  }
}

function mutationRefusal(
  verb: MutationVerb,
  after: string,
  before: string,
  ref: string,
): { reason: string; fix: string } | null {
  if (verb !== "delete" || after !== before) return null;
  return { reason: `${ref} was not found`, fix: "choose an existing clip" };
}

function mutationConflict(
  verb: MutationVerb,
  overwrite: boolean,
  row: TimelineRow,
  timeline: ProjectTimeline,
  nextStart: number,
  nextDuration: number,
): { reason: string; fix: string } | null {
  if ((verb !== "move" && verb !== "trim") || overwrite) return null;
  const conflict = overlap(row, timeline, nextStart, nextStart + nextDuration);
  if (!conflict) return null;
  return {
    reason: `${row.ref} would overlap ${conflict.ref} at ${nextStart}-${nextStart + nextDuration}`,
    fix: "pass --overwrite or move the named neighbour",
  };
}

function mutationCommand(verb: MutationVerb) {
  return defineCommand({
    meta: { name: verb, description: `${verb} a timeline clip` },
    args: {
      ref: { type: "positional", required: true },
      time: { type: "positional", required: verb === "move" || verb === "split" },
      dir: { type: "string" },
      start: { type: "string" },
      end: { type: "string" },
      duration: { type: "string" },
      plan: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      overwrite: { type: "boolean", default: false },
      snap: { type: "boolean", default: false },
    },
    async run({ args }) {
      await runMutation(verb, args);
    },
  });
}

export default defineCommand({
  meta: { name: "timeline", description: "Print and edit the project's tracks and clips" },
  args: {
    dir: { type: "positional", description: "Project directory", required: false },
    json: { type: "boolean", description: "Output as JSON", default: false },
  },
  subCommands: {
    move: () => mutationCommand("move"),
    trim: () => mutationCommand("trim"),
    split: () => mutationCommand("split"),
    delete: () => mutationCommand("delete"),
  },
  async run({ args }) {
    if (args._?.[0]) return;
    const project = resolveProject(args.dir);
    ensureDOMParser();
    const timeline = await describeProject(project.indexPath);
    console.log(
      args.json ? JSON.stringify(withMeta({ timeline }), null, 2) : formatTimeline(timeline),
    );
  },
});
