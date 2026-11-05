import { type ArgDef } from "citty";
import { defineCommand } from "../utils/defineCommand.js";
import type { Example } from "./_examples.js";
import { describeProject } from "../timeline/describeProject.js";
import { formatTimeline } from "../timeline/formatTimeline.js";
import { ensureDOMParser } from "../utils/dom.js";
import { resolveProject } from "../utils/project.js";
import { withMeta } from "../utils/updateCheck.js";
import { runApply, runIds, runUndo } from "../timeline/a2Commands.js";
import { runMutation } from "../timeline/a2MutationCommand.js";
import { FIELDS_READ_BY_VERB, type MutationVerb } from "../timeline/a2Shared.js";
import { resolveExtraPositionals } from "../utils/reject-extra-positionals.js";
import { assertKnownFlags } from "../utils/reject-unknown-flags.js";

export const examples: Example[] = [
  ["Show every track and clip of the project in the current directory", "hyperframes timeline"],
  ["Move a clip without writing", "hyperframes timeline move '#hero' +2 --plan"],
  ["Delete a clip and return a receipt", "hyperframes timeline delete '#hero' --json"],
];

const MUTATION_OPTIONS: Record<string, ArgDef> = {
  time: { type: "positional", required: true },
  at: { type: "string" },
  start: { type: "string" },
  end: { type: "string" },
  duration: { type: "string" },
  volume: { type: "string" },
  rate: { type: "string" },
  track: { type: "string" },
  overwrite: { type: "boolean", default: false },
};

function mutationCommand(verb: MutationVerb) {
  const fields = FIELDS_READ_BY_VERB[verb];
  return defineCommand({
    meta: { name: verb, description: `${verb} a timeline clip` },
    args: {
      ref: { type: "positional", required: true },
      ...(verb === "set" && { assignment: { type: "positional", required: false } }),
      ...Object.fromEntries(fields.map((field) => [field, MUTATION_OPTIONS[field]!])),
      dir: { type: "string" },
      plan: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      ...(verb !== "set" && { snap: { type: "boolean", default: false } }),
    },
    async run({ args }) {
      await runMutation(verb, args);
    },
  });
}

const subCommands = {
  move: () => mutationCommand("move"),
  trim: () => mutationCommand("trim"),
  split: () => mutationCommand("split"),
  delete: () => mutationCommand("delete"),
  set: () => mutationCommand("set"),
  duplicate: () => mutationCommand("duplicate"),
  ids: () =>
    defineCommand({
      meta: { name: "ids", description: "Stamp stable ids on timeline clips" },
      args: { dir: { type: "string" }, json: { type: "boolean", default: false } },
      async run({ args }) {
        await runIds(args);
      },
    }),
  apply: () =>
    defineCommand({
      meta: { name: "apply", description: "Apply an atomic timeline edit plan" },
      args: {
        file: { type: "positional", required: true },
        dir: { type: "string" },
        json: { type: "boolean", default: false },
        plan: { type: "boolean", default: false },
      },
      async run({ args }) {
        await runApply(args);
      },
    }),
  undo: () =>
    defineCommand({
      meta: { name: "undo", description: "Restore a timeline mutation receipt" },
      args: {
        receipt: { type: "positional", required: true },
        dir: { type: "string" },
        json: { type: "boolean", default: false },
      },
      async run({ args }) {
        await runUndo(args);
      },
    }),
};

function isTimelineSubcommand(first: string | undefined, rawArgs: string[]): boolean {
  if (!first || !Object.hasOwn(subCommands, first)) return false;
  const separator = rawArgs.indexOf("--");
  return separator < 0 || rawArgs.indexOf(first) < separator;
}

export default defineCommand({
  meta: { name: "timeline", description: "Print and edit the project's tracks and clips" },
  args: {
    dir: { type: "positional", description: "Project directory", required: false },
    component: {
      type: "string",
      description:
        "Unique component selector, or JSON target {selector|hfId|ref}; runtime inspection",
    },
    at: { type: "string", description: "Global second; requires the inspector service" },
    range: {
      type: "string",
      description: "Global start,end (half-open); requires the inspector service",
    },
    boundary: {
      type: "string",
      description: "Global boundary second; requires the inspector service",
    },
    generation: {
      type: "string",
      description: "Inspector generation for a continued runtime query",
    },
    offset: {
      type: "string",
      description: "Group offset for a continued runtime query",
    },

    json: { type: "boolean", description: "Output as JSON", default: false },
  },
  subCommands,
  setup({ args, rawArgs, cmd }) {
    const first = args._[0];
    if (!first || isTimelineSubcommand(first, rawArgs)) return;
    assertKnownFlags({ args: cmd.args }, rawArgs);
    const separator = rawArgs.indexOf("--");
    const directoryIndex = rawArgs.indexOf(first);
    if (separator < 0 || directoryIndex < separator) rawArgs.splice(directoryIndex, 0, "--");
  },
  async run({ args, rawArgs, cmd }) {
    if (isTimelineSubcommand(args._[0], rawArgs)) return;
    resolveExtraPositionals({ args: cmd.args }, "timeline", args);
    const project = resolveProject(args.dir);
    if ([args.component, args.at, args.range, args.boundary].some((v) => v !== undefined)) {
      const url = process.env.HF_INSPECT_URL;
      if (!url || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url))
        throw new Error(
          "Runtime timeline queries require HF_INSPECT_URL from the existing inspector service.",
        );
      const info = await fetch(`${url}/info`, { signal: AbortSignal.timeout(5000) }).then((r) =>
        r.json(),
      );
      const { realpathSync } = await import("node:fs");
      const { dirname } = await import("node:path");
      if (realpathSync(info.project) !== realpathSync(dirname(project.indexPath)))
        throw new Error("Inspector service belongs to another project");
      const component = args.component?.trim().startsWith("{")
        ? JSON.parse(args.component)
        : args.component
          ? { selector: args.component }
          : undefined;
      const response = await fetch(`${url}/timeline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          component,
          at: args.at === undefined ? undefined : Number(args.at),
          range: args.range?.split(",").map(Number),
          boundary: args.boundary === undefined ? undefined : Number(args.boundary),
          generation: args.generation,
          offset: args.offset === undefined ? undefined : Number(args.offset),
        }),
        signal: AbortSignal.timeout(60000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Timeline query failed");
      console.log(args.json ? JSON.stringify(result) : result.text);
      return;
    }
    ensureDOMParser();
    const timeline = await describeProject(project.indexPath);
    console.log(
      args.json ? JSON.stringify(withMeta({ timeline }), null, 2) : formatTimeline(timeline),
    );
  },
});
