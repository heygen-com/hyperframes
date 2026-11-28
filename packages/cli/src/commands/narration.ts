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
  [
    "Change one line: re-voice it and update its captions",
    'hyperframes narration set l2 "Twenty renewals are due today."',
  ],
  ["See what a change would write, without writing", "hyperframes narration set l2 --dry-run"],
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
  set: () =>
    narrated<{
      id: string;
      text?: string;
      dir?: string;
      json: boolean;
      voice?: string;
      speed?: string;
      "dry-run": boolean;
      retime: boolean;
      force: boolean;
      who?: string;
    }>(
      {
        meta: {
          name: "set",
          description:
            "Re-voice one line and update its clip, captions and narration.json together",
        },
        args: {
          id: { type: "positional", required: true, description: "The line's id, such as l2" },
          text: {
            type: "positional",
            required: false,
            description: "New text (default: keep the line's text)",
          },
          voice: { type: "string", description: "Kokoro voice for this line" },
          speed: { type: "string", description: "Speech speed for this line (0.1 to 3)" },
          "dry-run": {
            type: "boolean",
            default: false,
            description: "Show what would change; write nothing",
          },
          retime: {
            type: "boolean",
            default: true,
            description:
              "Refuse a longer take that runs into the next narration clip (--no-retime keeps it)",
          },
          force: {
            type: "boolean",
            default: false,
            description: "Re-voice even when nothing changed",
          },
          who: { type: "string", description: "Your agent name, for the history entry" },
        },
      },
      async (args) => {
        const speed = args.speed === undefined ? undefined : Number(args.speed);
        if (speed !== undefined && !(speed >= 0.1 && speed <= 3)) {
          throw new NarrationRefusal("--speed takes a number from 0.1 to 3");
        }
        const { runNarrationSet } = await import("../narration/set.js");
        const result = await runNarrationSet({
          dir: projectDir(args.dir),
          line: args.id,
          text: args.text,
          voice: args.voice,
          speed,
          dryRun: args["dry-run"],
          allowOverlap: !args.retime,
          force: args.force,
          who: args.who,
        });
        print(args.json, result, describeSet(result));
      },
    ),
};

function describeSet(
  result: Awaited<ReturnType<typeof import("../narration/set.js").runNarrationSet>>,
) {
  if (result.kind === "unchanged") {
    return `Line ${result.line} is already voiced from its text; pass --force to re-voice it anyway.`;
  }
  const verb = result.kind === "planned" ? "Would write" : "Wrote";
  const captions = result.captions
    ? ` ${result.captions.removed} caption words became ${result.captions.added} in ${result.captions.file}.`
    : " No caption array was found.";
  const dropped = result.overridesDropped
    ? ` Dropped ${result.overridesDropped} caption override(s) on words that changed.`
    : "";
  const warnings = result.warnings.map((warning) => `\nWarning: ${warning}`).join("");
  return `${verb} line ${result.line}: ${result.durationSeconds}s, ${result.words} words, ${result.audio}.${captions}${dropped}\nFiles: ${result.files.join(", ")}${warnings}`;
}

export default defineCommand({
  meta: {
    name: "narration",
    description: "Keep each voice-over line, its audio clip and its captions in step",
  },
  subCommands,
});
