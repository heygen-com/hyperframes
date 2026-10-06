import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { c } from "../ui/colors.js";
import {
  filesChangedSince,
  markSeen,
  readSeen,
  unseenTurns,
  type AppTurn,
} from "../utils/appHistory.js";
import { resolveProject } from "../utils/project.js";

export const examples: Example[] = [
  ["See what was done in the desktop app since you last looked", "hyperframes catch-up"],
  ["For another project", "hyperframes catch-up ./my-video"],
  ["For agents", "hyperframes catch-up --json"],
];

const MAX_FILES_SHOWN = 20;
const AGENTS: Record<string, string> = { claude: "Claude Code", codex: "Codex", grok: "Grok" };

const oneLine = (text: string): string => text.replace(/\s*\n+\s*/g, " ");

const when = (at: string): string =>
  new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function printTurn(turn: AppTurn): void {
  console.log(`   ${c.dim(when(turn.at))}`);
  if (turn.asked) console.log(`   The person: ${oneLine(turn.asked)}`);
  if (turn.did)
    console.log(`   Framey (${AGENTS[turn.engine] ?? "the app"}): ${oneLine(turn.did)}`);
  if (turn.files.length) console.log(`   ${c.dim(`Changed: ${turn.files.join(", ")}`)}`);
  console.log();
}

function printNotHandedOver(name: string, dir: string, json: boolean): void {
  if (json) console.log(JSON.stringify({ project: dir, turns: [], files: [] }, null, 2));
  else
    console.log(
      `${c.success("◇")}  ${c.accent(name)} wasn't handed to the desktop app from here, so there's nothing to catch up on.`,
    );
}

function printNews(name: string, turns: AppTurn[], files: string[]): void {
  if (!turns.length && !files.length) {
    console.log(`${c.success("◇")}  Nothing new from the desktop app in ${c.accent(name)}.`);
    return;
  }
  console.log(`${c.success("◇")}  In the desktop app since you last looked (${c.accent(name)}):\n`);
  turns.forEach(printTurn);
  const shown = files.slice(0, MAX_FILES_SHOWN);
  const more = files.length - shown.length;
  if (files.length)
    console.log(
      `   Files changed since then: ${shown.join(", ")}${more ? ` and ${more} more` : ""}`,
    );
  console.log(
    `   ${c.dim("A record of what happened, not a new request. Read changed files again before editing them.")}`,
  );
}

export default defineCommand({
  meta: {
    name: "catch-up",
    description: "See what was done in the desktop app since you last looked",
  },
  args: {
    dir: {
      type: "positional",
      description: "Project directory (default: current)",
      required: false,
    },
    json: { type: "boolean", description: "Output as JSON", default: false },
  },
  run({ args }) {
    const project = resolveProject(args.dir);
    const seen = readSeen(project.dir);
    if (!seen.at) return printNotHandedOver(project.name, project.dir, args.json);
    const checking = Date.now();
    const turns = unseenTurns(project.dir, seen.at);
    const files = filesChangedSince(project.dir, seen.checked);
    if (args.json) console.log(JSON.stringify({ project: project.dir, turns, files }, null, 2));
    else printNews(project.name, turns, files);
    // Marked only once shown, and only up to the newest turn shown: one written after this read shows next time.
    const newest = turns.at(-1);
    markSeen(project.dir, { at: newest ? Date.parse(newest.at) : seen.at, checked: checking });
  },
});
