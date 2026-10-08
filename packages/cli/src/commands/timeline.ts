import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { describeProject } from "../timeline/describeProject.js";
import { formatTimeline } from "../timeline/formatTimeline.js";
import { ensureDOMParser } from "../utils/dom.js";
import { resolveProject } from "../utils/project.js";
import { withMeta } from "../utils/updateCheck.js";
import { runApply, runIds, runUndo } from "../timeline/a2Commands.js";
import { runMutation } from "../timeline/a2MutationCommand.js";
import type { MutationVerb } from "../timeline/a2Shared.js";
import { resolveExtraPositionals } from "../utils/reject-extra-positionals.js";
import { assertKnownFlags } from "../utils/reject-unknown-flags.js";

export const examples: Example[] = [
  ["Show every track and clip of the project in the current directory", "hyperframes timeline"],
  ["Move a clip without writing", "hyperframes timeline move '#hero' +2 --plan"],
  ["Delete a clip and return a receipt", "hyperframes timeline delete '#hero' --json"],
];

function mutationCommand(verb: MutationVerb) {
  return defineCommand({
    meta: { name: verb, description: `${verb} a timeline clip` },
    args: {
      ref: { type: "positional", required: true },
      time: { type: "positional", required: verb === "move" || verb === "split" },
      at: { type: "string" },
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
    ensureDOMParser();
    const timeline = await describeProject(project.indexPath);
    console.log(
      args.json ? JSON.stringify(withMeta({ timeline }), null, 2) : formatTimeline(timeline),
    );
  },
});
