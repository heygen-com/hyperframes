import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defineCommand, type ArgsDef } from "citty";
import {
  HISTORY_START,
  HistoryBusyError,
  type HistoryEntry,
  type HistoryListItem,
  type HistoryResult,
  type HistoryWho,
} from "@hyperframes/studio-server";
import type { Example } from "./_examples.js";
import { trackHistoryAction } from "../telemetry/events.js";
import { setCommandExitCode } from "../utils/commandResult.js";
import {
  Refusal,
  endTurn,
  lastTurnParts,
  withOwner as withHistoryOwner,
  writeTurn,
  type Owner,
  type Turn,
  type UndoMode,
} from "../utils/historyOwner.js";
import { AmbiguousPreviewServerError } from "../utils/studioSelectionClient.js";
import { withMeta } from "../utils/updateCheck.js";

export const examples: Example[] = [
  [
    "What changed since your last turn, and who changed it",
    "hyperframes history --since mine --who claude",
  ],
  [
    "Label your writes as one entry",
    "hyperframes history begin --who claude --label 'Bigger title'",
  ],
  ["Undo your newest entry after a failed check", "hyperframes history undo --who claude"],
];

const YOU: HistoryWho = { kind: "person", name: "You" };

/** The project's history for one subcommand, counted by action and by who kept it (preview or this process). */
const withOwner = <T>(
  action: string,
  dir: string | undefined,
  task: (owner: Owner, turn: Turn | null, projectDir: string) => Promise<T>,
) =>
  withHistoryOwner(dir, (owner, turn, projectDir) => {
    trackHistoryAction({ action, via: owner.via });
    return task(owner, turn, projectDir);
  });

/** An agent names itself with --who; without it the caller is the person, even during an agent's turn. */
const whoOf = (name: string | undefined): HistoryWho => (name ? { kind: "agent", name } : YOU);

const short = (id: string) => id.slice(0, 8);

function lastIndex<T>(items: readonly T[], match: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) if (match(items[index]!)) return index;
  return -1;
}

/** An entry id or a unique prefix of one. */
function entryOf(entries: readonly HistoryListItem[], ref: string): HistoryListItem {
  const found = entries.filter((entry) => entry.id.startsWith(ref));
  if (found.length === 1) return found[0]!;
  throw new Refusal(
    found.length ? `"${ref}" matches ${found.length} entries` : `No entry "${ref}" in this history`,
  );
}

/** A local ISO date or date-time, when `ref` is no entry id (a date like 2026-09-24 also reads as hex). */
function timeOf(entries: readonly HistoryListItem[], ref: string): number | null {
  if (!/^\d{4}-\d\d-\d\d(T.+)?$/.test(ref) || entries.some((entry) => entry.id.startsWith(ref)))
    return null;
  // A bare date would parse as UTC midnight; with a time it parses as local.
  const time = Date.parse(ref.includes("T") ? ref : `${ref}T00:00`);
  // Date.parse rolls 2026-02-31 over to March instead of refusing it.
  const [year, month, date] = ref.slice(0, 10).split("-").map(Number) as [number, number, number];
  const day = new Date(Date.UTC(year, month - 1, date));
  if (Number.isNaN(time) || day.getUTCMonth() !== month - 1 || day.getUTCDate() !== date)
    throw new Refusal(`"${ref}" is not a date`);
  return time;
}

/** A point is START, an entry id, or a time (the files right after the newest entry by then). */
function pointOf(entries: readonly HistoryListItem[], ref: string): string {
  if (ref === HISTORY_START) return ref;
  const time = timeOf(entries, ref);
  if (time === null) return entryOf(entries, ref).id;
  return entries[lastIndex(entries, (entry) => entry.endedAt <= time)]?.id ?? HISTORY_START;
}

function since(entries: HistoryListItem[], ref: string, who: HistoryWho): HistoryListItem[] {
  if (ref === "mine")
    return entries.slice(lastIndex(entries, (entry) => entry.who.name === who.name) + 1);
  const time = timeOf(entries, ref);
  if (time !== null) return entries.filter((entry) => entry.endedAt > time);
  return entries.slice(entries.indexOf(entryOf(entries, ref)) + 1);
}

function ago(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

function line(entry: HistoryListItem | HistoryEntry): string {
  const paths = entry.files.map((file) => file.path);
  const files = paths.slice(0, 2).join(", ") + (paths.length > 2 ? ` +${paths.length - 2}` : "");
  const flags =
    "undone" in entry ? `${entry.undone ? " [undone]" : ""}${entry.pinned ? " [pinned]" : ""}` : "";
  return `${short(entry.id)}  ${ago(entry.endedAt)}  ${entry.who.name}  ${entry.label}  (${files})${flags}`;
}

/** The public entry shape: files as paths, no hashes. */
const publicEntry = (entry: HistoryEntry & Partial<HistoryListItem>) => ({
  id: entry.id,
  who: entry.who,
  label: entry.label,
  startedAt: entry.startedAt,
  endedAt: entry.endedAt,
  files: entry.files.map((file) => file.path),
  undone: entry.undone ?? false,
  pinned: entry.pinned ?? false,
});

const changeOf = (file: HistoryEntry["files"][number]) =>
  file.before === null ? "added" : file.after === null ? "deleted" : "modified";

function print(json: boolean, data: object, text: string): void {
  console.log(json ? JSON.stringify(withMeta(data), null, 2) : text);
}

async function textDiff(owner: Owner, entry: HistoryEntry): Promise<string> {
  const work = mkdtempSync(join(tmpdir(), "hf-history-diff-"));
  try {
    const out: string[] = [];
    for (const file of entry.files) {
      const sides = await Promise.all(
        [file.before, file.after].map((hash) => (hash ? owner.blob(hash) : Buffer.alloc(0))),
      );
      if (sides.some((bytes) => bytes.subarray(0, 8000).includes(0))) {
        out.push(`Binary ${file.path} changed`);
        continue;
      }
      const [a, b] = ["a", "b"].map((side, index) => {
        const path = join(side, file.path);
        mkdirSync(dirname(join(work, path)), { recursive: true });
        writeFileSync(join(work, path), sides[index]!);
        return path;
      });
      const diff = spawnSync("git", ["diff", "--no-index", "--no-color", "--no-prefix", a!, b!], {
        cwd: work,
        encoding: "utf-8",
      });
      if (diff.error) throw new Refusal("--diff needs git on PATH");
      out.push(diff.stdout.trimEnd());
    }
    return out.join("\n");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** `again` is the command to run once more with a choice: `undo <id>`, or `undo --who <name>` for a whole turn. */
function conflictText(
  entry: HistoryListItem,
  newer: HistoryListItem[],
  files: string[],
  again: string,
): string {
  return [
    `${files.join(", ")} changed since "${entry.label}". Newer entries:`,
    ...newer.map((later) => `  ${line(later)}`),
    `Choose one:`,
    `  hyperframes history ${again} --just-this       put back only its files, over the newer edits to them`,
    `  hyperframes history ${again} --back-to-before  go back to before it, undoing the newer entries too`,
  ].join("\n");
}

/**
 * What `undo --who` reverts: every entry of the agent's last turn still in effect, newest first. An agent that never
 * ended a turn here gets its newest entry.
 */
function turnTargets(entries: HistoryListItem[], who: HistoryWho, dir: string): HistoryListItem[] {
  const inEffect = (entry: HistoryListItem) => !entry.undone && !entry.undoes;
  const parts = lastTurnParts(dir, who.name);
  const newest = entries[lastIndex(entries, (e) => e.who.name === who.name && inEffect(e))];
  const targets = parts
    ? entries.filter((entry) => parts.includes(entry.id) && inEffect(entry)).reverse()
    : newest
      ? [newest]
      : [];
  if (!targets.length)
    throw new Refusal(
      parts
        ? `${who.name}'s last turn has no change still in effect; undo an older entry by its id`
        : `${who.name} has no entry still in effect`,
    );
  return targets;
}

type Undone = { target: HistoryListItem; undo: HistoryEntry };
type Refused = { target: HistoryListItem; result: Extract<HistoryResult, { ok: false }> };

/** A turn is undone whole or not at all: on a conflict, the parts this run already undid are redone. */
async function undoWhole(
  owner: Owner,
  targets: HistoryListItem[],
  who: HistoryWho,
  mode: UndoMode | undefined,
): Promise<{ undid: Undone[]; refused?: Refused }> {
  const undid: Undone[] = [];
  for (const target of targets) {
    const result = await owner.undo(target.id, who, mode);
    if (!result.ok) {
      for (const done of undid.reverse()) await owner.undo(done.undo.id, who);
      return { undid: [], refused: { target, result } };
    }
    if (result.entry) undid.push({ target, undo: result.entry });
  }
  return { undid };
}

async function runUndo(args: {
  ref?: string;
  who?: string;
  justThis?: boolean;
  backToBefore?: boolean;
  dir?: string;
  json: boolean;
}): Promise<void> {
  const mode: UndoMode | undefined = args.justThis
    ? "just-this"
    : args.backToBefore
      ? "back-to-before"
      : undefined;
  await withOwner("undo", args.dir, async (owner, turn, projectDir) => {
    const who = whoOf(args.who);
    // Undo ends the caller's own open turn first, so its entries can be undone.
    if (turn?.who.name === who.name) await endTurn(owner, turn, projectDir);
    const entries = await owner.list();
    const targets = args.ref ? [entryOf(entries, args.ref)] : turnTargets(entries, who, projectDir);
    const { undid, refused } = await undoWhole(owner, targets, who, mode);
    if (refused) {
      const { target, result } = refused;
      setCommandExitCode(2);
      const now = await owner.list();
      const newer = result.conflict.newer.map((id) => entryOf(now, id));
      const again = args.ref ? `undo ${short(target.id)}` : `undo --who ${who.name}`;
      return print(args.json, result, conflictText(target, newer, result.conflict.files, again));
    }
    print(
      args.json,
      {
        ok: true,
        entry: undid[0] ? publicEntry(undid[0].undo) : null,
        entries: undid.map((done) => publicEntry(done.undo)),
      },
      undid.map((done) => `Undid ${short(done.target.id)}: ${line(done.undo)}`).join("\n") ||
        "Nothing to undo.",
    );
  });
}

/** Refusals are the user's to fix: one line on stderr (or JSON on stdout) and exit 2, never a stack. */
function guarded<A>(run: (args: A) => Promise<void>) {
  return async (args: A) => {
    try {
      await run(args);
    } catch (error) {
      const refused =
        error instanceof Refusal ||
        error instanceof AmbiguousPreviewServerError ||
        error instanceof HistoryBusyError;
      if (!refused) throw error;
      setCommandExitCode(2);
      const { message } = error as Error;
      if ((args as { json?: boolean }).json) print(true, { ok: false, error: message }, message);
      else console.error(message);
    }
  };
}

const common = {
  dir: { type: "string", description: "Project directory (default: current)" },
  json: { type: "boolean", description: "Output as JSON", default: false },
} as const;

const sub = <A>(
  name: string,
  description: string,
  args: ArgsDef,
  run: (args: A) => Promise<void>,
) =>
  defineCommand({
    meta: { name, description },
    args: { ...common, ...args },
    run: ({ args: parsed }) => guarded(run)(parsed as A),
  });

const listEntries = async (args: {
  _?: string[];
  since?: string;
  who?: string;
  limit?: string;
  dir?: string;
  json: boolean;
}) => {
  if (args._?.[0]) return;
  await withOwner("list", args.dir, async (owner) => {
    const all = await owner.list();
    const picked = args.since ? since(all, args.since, whoOf(args.who)) : all;
    const limit = Number(args.limit ?? 20);
    if (!Number.isInteger(limit) || limit < 1)
      throw new Refusal("--limit takes a whole number above 0");
    const shown = picked.slice(-limit).reverse();
    const more = picked.length - shown.length;
    const text = shown.map(line).join("\n") || "No changes recorded.";
    print(
      args.json,
      { entries: shown.map(publicEntry) },
      more ? `${text}\n(${more} older; --limit)` : text,
    );
  });
};

export default defineCommand({
  meta: { name: "history", description: "List, undo and restore the project's recorded changes" },
  args: {
    ...common,
    since: { type: "string", description: "Only entries after an entry id, a time, or 'mine'" },
    who: { type: "string", description: "Your name, for --since mine" },
    limit: { type: "string", description: "Newest entries to show (default 20)" },
  },
  subCommands: {
    show: () =>
      sub<{ ref: string; diff: boolean; dir?: string; json: boolean }>(
        "show",
        "One entry's files, before and after",
        { ref: { type: "positional", required: true }, diff: { type: "boolean", default: false } },
        (args) =>
          withOwner("show", args.dir, async (owner) => {
            const entry = entryOf(await owner.list(), args.ref);
            const changes = entry.files.map((file) => ({
              path: file.path,
              change: changeOf(file),
            }));
            const diff = args.diff ? await textDiff(owner, entry) : undefined;
            const marks = changes.map((file) => `  ${file.change[0]!.toUpperCase()} ${file.path}`);
            print(
              args.json,
              { entry: publicEntry(entry), changes, ...(diff !== undefined && { diff }) },
              `${line(entry)}\n${diff ?? marks.join("\n")}`,
            );
          }),
      ),
    undo: () =>
      sub(
        "undo",
        "Undo an entry (default: your newest one still in effect)",
        {
          ref: { type: "positional", required: false },
          who: { type: "string", description: "Your name" },
          "just-this": { type: "boolean", default: false },
          "back-to-before": { type: "boolean", default: false },
        },
        runUndo,
      ),
    restore: () =>
      sub<{ ref: string; who?: string; dir?: string; json: boolean }>(
        "restore",
        "Make the files what they were right after an entry, a time, or 'start'",
        { ref: { type: "positional", required: true }, who: { type: "string" } },
        (args) =>
          withOwner("restore", args.dir, async (owner) => {
            const entry = await owner.restore(
              pointOf(await owner.list(), args.ref),
              whoOf(args.who),
            );
            print(
              args.json,
              { entry: entry && publicEntry(entry) },
              entry ? `Restored: ${line(entry)}` : "Already there.",
            );
          }),
      ),
    peek: () =>
      sub<{ ref: string; path?: string; dir?: string; json: boolean }>(
        "peek",
        "The files at an entry, a time, or 'start' (read-only); with a path, that file",
        {
          ref: { type: "positional", required: true },
          path: { type: "positional", required: false },
        },
        (args) =>
          withOwner("peek", args.dir, async (owner) => {
            const files = await owner.peek(pointOf(await owner.list(), args.ref));
            if (!files) throw new Refusal("That point is no longer kept");
            if (!args.path) return print(args.json, { files }, Object.keys(files).join("\n"));
            const hash = files[args.path];
            if (!hash) throw new Refusal(`${args.path} did not exist then`);
            process.stdout.write(await owner.blob(hash));
          }),
      ),
    pin: () =>
      sub<{ ref: string; off: boolean; dir?: string; json: boolean }>(
        "pin",
        "Keep an entry (and what it needs) when old history is trimmed",
        { ref: { type: "positional", required: true }, off: { type: "boolean", default: false } },
        (args) =>
          withOwner("pin", args.dir, async (owner) => {
            const entry = entryOf(await owner.list(), args.ref);
            await owner.pin(entry.id, !args.off);
            print(
              args.json,
              { id: entry.id, pinned: !args.off },
              `${args.off ? "Unpinned" : "Pinned"} ${short(entry.id)}`,
            );
          }),
      ),
    begin: () =>
      sub<{ who: string; label: string; dir?: string; json: boolean }>(
        "begin",
        "Start a turn: your writes until `end` become one entry under your name",
        { who: { type: "string", required: true }, label: { type: "string", required: true } },
        (args) =>
          withOwner("begin", args.dir, async (owner, turn, projectDir) => {
            if (turn) await endTurn(owner, turn, projectDir);
            const who = whoOf(args.who);
            const { id, startedAt } = await owner.begin(who, args.label);
            writeTurn(projectDir, {
              via: owner.via,
              id,
              who,
              label: args.label,
              startedAt,
              lastWriteAt: startedAt,
              parts: [],
            });
            print(args.json, { entryId: id }, short(id));
          }),
      ),
    end: () =>
      sub<{ dir?: string; json: boolean }>("end", "End your turn and print its entry", {}, (args) =>
        withOwner("end", args.dir, async (owner, turn, projectDir) => {
          if (!turn) throw new Refusal("No turn is open; start one with history begin");
          const { entry, parts } = await endTurn(owner, turn, projectDir);
          const earlier = parts.length - (entry ? 1 : 0);
          const text = entry
            ? line(entry)
            : earlier
              ? "Nothing changed since this turn's last command."
              : "Nothing changed in this turn.";
          print(
            args.json,
            { entry: entry && publicEntry(entry), parts },
            earlier ? `${text}\n(+${earlier} earlier part${earlier > 1 ? "s" : ""})` : text,
          );
        }),
      ),
  },
  run: ({ args }) => guarded(listEntries)(args),
});
