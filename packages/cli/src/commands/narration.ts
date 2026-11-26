import { terminalLines } from "@hyperframes/core";
import { type ArgsDef } from "citty";
import { defineCommand } from "../utils/defineCommand.js";
import type { Example } from "./_examples.js";
import { setCommandExitCode } from "../utils/commandResult.js";
import { jsonFailure } from "../utils/jsonError.js";
import { resolveProject } from "../utils/project.js";
import { withMeta } from "../utils/updateCheck.js";
import { NarrationRefusal } from "../narration/project.js";

export const examples: Example[] = [
  ["Adopt a voiced project into narration.json", "hyperframes narration init"],
  ["List each line and whether it is in sync", "hyperframes narration list"],
  ["Fail when voice, clips and captions have drifted", "hyperframes narration check"],
];

const common = {
  dir: { type: "string", description: "Project directory (default: current)" },
  json: { type: "boolean", description: "Output as JSON", default: false },
} as const;

function print(json: boolean, data: unknown, text: string): void {
  console.log(
    json ? JSON.stringify(withMeta(data as Record<string, unknown>), null, 2) : terminalLines(text),
  );
}

/** A refusal is the caller's to fix: exit 2 with its message, never a stack. */
function refused(error: unknown, json: boolean | undefined): void {
  if (!(error instanceof NarrationRefusal)) throw error;
  setCommandExitCode(2);
  if (json) print(true, jsonFailure("refused", error.message), error.message);
  else console.error(terminalLines(error.message));
}

interface Narrated {
  meta: { name: string; description: string };
  args?: ArgsDef;
}

/** A narration subcommand: shared --dir and --json, and refusals printed instead of thrown. */
function narrated<A extends { json?: boolean }>(
  { meta, args = {} }: Narrated,
  task: (args: A) => Promise<void>,
) {
  return defineCommand({
    meta,
    args: { ...common, ...args },
    async run(context) {
      const parsed = context.args as unknown as A;
      await task(parsed).catch((error: unknown) => refused(error, parsed.json));
    },
  });
}

const projectDir = (dir: string | undefined) => resolveProject(dir).dir;

const subCommands = {
  list: () =>
    narrated<{ dir?: string; json: boolean }>(
      {
        meta: { name: "list", description: "List narration lines and whether each is in sync" },
        args: {},
      },
      async (args) => {
        const { narrationStatus } = await import("../narration/status.js");
        const { lines } = await narrationStatus(projectDir(args.dir));
        const text = lines
          .map((line) => {
            const state = line.problems.length ? line.problems.join(", ") : "in sync";
            const length = line.durationSeconds === null ? "?" : `${line.durationSeconds}s`;
            return `${line.id.padEnd(6)} ${length.padStart(7)}  ${state.padEnd(32)} ${line.text}`;
          })
          .join("\n");
        print(args.json, { lines }, text || "narration.json has no lines.");
      },
    ),
  check: () =>
    narrated<{ dir?: string; json: boolean }>(
      {
        meta: { name: "check", description: "Report narration drift; exits 1 when there is any" },
        args: {},
      },
      async (args) => {
        const { narrationStatus } = await import("../narration/status.js");
        const { findings } = await narrationStatus(projectDir(args.dir));
        const drift = findings.filter((finding) => finding.severity !== "info");
        if (drift.length > 0) setCommandExitCode(1);
        const text = findings.length
          ? findings.map((f) => `${f.severity} ${f.code}: ${f.message}`).join("\n")
          : "Narration is in sync: every line's voice, clip and captions match narration.json.";
        print(args.json, { ok: drift.length === 0, findings }, text);
      },
    ),
  init: () =>
    narrated<{ dir?: string; json: boolean; force: boolean; who?: string }>(
      {
        meta: {
          name: "init",
          description: "Create narration.json from a voiced project and link each line's clip",
        },
        args: {
          force: {
            type: "boolean",
            default: false,
            description: "Replace an existing narration.json",
          },
          who: { type: "string", description: "Your agent name, for the history entry" },
        },
      },
      async (args) => {
        const { runNarrationInit } = await import("../narration/init.js");
        const result = await runNarrationInit({
          dir: projectDir(args.dir),
          force: args.force,
          who: args.who,
        });
        const unlinked = result.unlinked.length
          ? `\nNo clip plays: ${result.unlinked.join(", ")}; add data-narration-line to their <audio>.`
          : "";
        print(
          args.json,
          result,
          `Wrote narration.json with ${result.lines.length} lines from ${result.source}; linked ${result.linked.length} clips${result.captions ? `, captions in ${result.captions}` : ""}.${unlinked}`,
        );
      },
    ),
};

export default defineCommand({
  meta: {
    name: "narration",
    description: "Keep each voice-over line, its audio clip and its captions in step",
  },
  subCommands,
});
