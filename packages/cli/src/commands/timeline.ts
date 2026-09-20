import {
  applyFileMutations,
  fileContentVersion,
  patchElementInHtml,
  removeElementFromHtml,
  splitElementInHtml,
} from "@hyperframes/studio-server";
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

function declaredFps(indexPath: string): number | null {
  const raw = readCompositionFps(readFileSync(indexPath, "utf-8"));
  if (raw === null) return null;
  const parsed = parseFpsWithDefault(raw);
  return parsed.ok ? fpsToNumber(parsed.value) : null;
}

function nextSplitId(id: string): string {
  const match = /^(.*)-(\d+)$/.exec(id);
  return match ? `${match[1]}-${Number(match[2]) + 1}` : `${id}-2`;
}

function splitBaseId(row: TimelineRow): string {
  return row.ref.startsWith("hf:") ? row.ref.slice(3) : row.id;
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

// fallow-ignore-next-line complexity
async function runMutation(verb: MutationVerb, args: Record<string, unknown>): Promise<void> {
  const project = resolveProject(typeof args.dir === "string" ? args.dir : undefined);
  const ref = typeof args.ref === "string" ? args.ref : "";
  const json = args.json === true;
  const plan = args.plan === true;
  const overwrite = args.overwrite === true;
  const snap = args.snap === true;
  ensureDOMParser();
  const timeline = await describeProject(project.indexPath);
  const projectFps = declaredFps(project.indexPath);
  if (snap && projectFps === null) {
    return refusal(
      "project fps is unknown",
      "set data-fps on the project, then rerun with --snap",
      json,
    );
  }
  const resolved = resolveRef(timeline, ref);
  if (!resolved.ok) return refusal(resolved.reason, resolved.fix, json);
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
  const filePath = join(project.dir, row.file);
  const before = readFileSync(filePath, "utf-8");
  const expectedVersion = fileContentVersion(before);
  let after = before;
  let nextStart = row.start;
  let nextDuration = row.duration;
  if (verb === "move" || verb === "split") {
    const expression = typeof args.time === "string" ? args.time : "";
    const time = parseTime(expression);
    if (!time.ok) return refusal(time.reason, "pass a valid time expression", json);
    if (verb === "move") {
      nextStart = time.seconds;
      const patched = patchElementInHtml(before, resolved.target, [
        { type: "html-attribute", property: "data-start", value: String(nextStart) },
      ]);
      if (!patched.matched) return refusal(`${ref} was not found`, "choose an existing clip", json);
      after = patched.html;
    } else {
      const split = splitElementInHtml(
        before,
        resolved.target,
        time.seconds,
        nextSplitId(splitBaseId(row)),
        {
          start: row.start,
          duration: row.duration,
          track: row.trackIndex,
        },
      );
      if (!split.matched || !split.newId) {
        return refusal(
          `${ref} cannot be split at ${time.seconds}`,
          "choose a time inside the clip",
          json,
        );
      }
      after = split.html;
    }
  } else if (verb === "trim") {
    const startExpr = typeof args.start === "string" ? args.start : undefined;
    const endExpr = typeof args.end === "string" ? args.end : undefined;
    const durationExpr = typeof args.duration === "string" ? args.duration : undefined;
    if (!startExpr && !endExpr && !durationExpr) {
      return refusal("trim requires --start, --end, or --duration", "pass one trim option", json);
    }
    if (startExpr) {
      const value = parseTime(startExpr);
      if (!value.ok) return refusal(value.reason, "pass a valid time expression", json);
      nextStart = value.seconds;
    }
    if (endExpr) {
      const value = parseTime(endExpr);
      if (!value.ok) return refusal(value.reason, "pass a valid time expression", json);
      nextDuration = value.seconds - nextStart;
    }
    if (durationExpr) {
      const value = parseTime(durationExpr);
      if (!value.ok) return refusal(value.reason, "pass a valid duration", json);
      nextDuration = value.seconds;
    }
    if (nextDuration <= 0) {
      return refusal(
        "trim duration must be positive",
        "choose a later end or positive duration",
        json,
      );
    }
    const patched = patchElementInHtml(before, resolved.target, [
      { type: "html-attribute", property: "data-start", value: String(nextStart) },
      { type: "html-attribute", property: "data-duration", value: String(nextDuration) },
    ]);
    if (!patched.matched) return refusal(`${ref} was not found`, "choose an existing clip", json);
    after = patched.html;
  } else {
    after = removeElementFromHtml(before, resolved.target);
  }
  if (after === before) {
    return refusal(`${ref} was not found`, "choose an existing clip", json);
  }
  if ((verb === "move" || verb === "trim") && !overwrite) {
    const conflict = overlap(row, timeline, nextStart, nextStart + nextDuration);
    if (conflict) {
      return refusal(
        `${ref} would overlap ${conflict.ref} at ${nextStart}-${nextStart + nextDuration}`,
        "pass --overwrite or move the named neighbour",
        json,
      );
    }
  }
  const describeSource = (source: string): Promise<ProjectTimeline> =>
    describeProject(project.indexPath, undefined, new Map([[row.file, source]]));
  const describedBefore = await describeSource(before);
  const result = {
    ok: true,
    receipt: null as unknown,
    file: row.file,
    before: allRows(describedBefore).filter((candidate) => candidate.file === row.file),
    after: [] as TimelineRow[],
    diff: diff(before, after),
    warnings: row.warnings,
  };
  const describeAfter = async (): Promise<ProjectTimeline> => describeSource(after);
  if (plan) {
    const plannedTimeline = await describeAfter();
    result.after = allRows(plannedTimeline).filter((candidate) => candidate.file === row.file);
    if (json) console.log(JSON.stringify({ ...result, planned: true }, null, 2));
    else
      console.log(
        `${formatTimeline(timeline)}\n\nplanned:\n${formatTimeline(plannedTimeline)}\n\ndiff:\n${result.diff}`,
      );
    return;
  }
  let receipt;
  try {
    [receipt] = applyFileMutations(project.dir, [
      { sourceFile: row.file, absPath: filePath, before, after, expectedVersion },
    ]);
  } catch (error) {
    if (error instanceof Error && error.message === "file changed since the timeline was read") {
      return refusal(error.message, "re-run hyperframes timeline", json);
    }
    throw error;
  }
  if (!receipt) return refusal("mutation produced no receipt", "re-run hyperframes timeline", json);
  const appliedTimeline = await describeAfter();
  result.after = allRows(appliedTimeline).filter((candidate) => candidate.file === row.file);
  result.receipt = receipt;
  if (json) console.log(JSON.stringify(withMeta(result), null, 2));
  else
    console.log(
      `${verb} ${row.ref}: ${row.start}-${row.end}s -> ${nextStart}-${nextStart + nextDuration}s\nreceipt: ${receipt.version}`,
    );
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
