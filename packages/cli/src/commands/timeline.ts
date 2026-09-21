import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { describeProject } from "../timeline/describeProject.js";
import { formatTimeline } from "../timeline/formatTimeline.js";
import { ensureDOMParser } from "../utils/dom.js";
import { resolveProject } from "../utils/project.js";
import { withMeta } from "../utils/updateCheck.js";
import { runMutation } from "../timeline/a2MutationCommand.js";
import type { MutationVerb } from "../timeline/a2Shared.js";

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
    set: () => mutationCommand("set"),
    duplicate: () => mutationCommand("duplicate"),
    ids: () =>
      defineCommand({
        meta: { name: "ids", description: "Stamp stable ids on timeline clips" },
        args: { dir: { type: "string" }, json: { type: "boolean", default: false } },
        async run({ args }) {
          await (await import("../timeline/a2Commands.js")).runIds(args);
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
          await (await import("../timeline/a2Commands.js")).runApply(args);
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
          await (await import("../timeline/a2Commands.js")).runUndo(args);
        },
      }),
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
