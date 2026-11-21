import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArgsDef, CommandDef } from "citty";
import { mockTelemetry } from "./cliDispatchTestUtils.js";
import { jsonFlagBeforeSeparator, jsonFlagAfterCommand } from "./utils/projectShortcut.js";

type Loader = () => Promise<CommandDef>;
type Tracking = typeof import("./utils/command-failure-tracking.js");

const originalArgv = [...process.argv];
const originalExitCode = process.exitCode;
const MOCKED = [
  "citty",
  "./utils/command-failure-tracking.js",
  "./telemetry/index.js",
  "./telemetry/events.js",
  "./utils/workspaceBuildCheck.js",
];
// The test job does not build the studio packages; `preview` only needs them once it runs.
const studioBuilt = () =>
  vi.doMock("./utils/workspaceBuildCheck.js", () => ({
    checkStudioWorkspaceBuild: () => [],
    formatWorkspaceBuildProblems: () => "",
  }));

// Each load of the entry point adds its own listeners; drop the ones a row added.
function keepListeners(): () => void {
  const watched = [
    ...["exit", "uncaughtException", "unhandledRejection"].map((event) => [process, event]),
    [process.stdout, "error"],
    [process.stderr, "error"],
  ] as Array<[NodeJS.EventEmitter, string]>;
  const before = watched.map(([emitter, event]) => emitter.listeners(event));
  return () =>
    watched.forEach(([emitter, event], i) => {
      for (const added of emitter.listeners(event))
        if (!before[i]!.includes(added)) emitter.removeListener(event, added as () => void);
    });
}

afterEach(async () => {
  process.argv = [...originalArgv];
  process.exitCode = originalExitCode;
  await vi.dynamicImportSettled();
  vi.restoreAllMocks();
  for (const path of MOCKED) vi.doUnmock(path);
  vi.resetModules();
});

// Every command that declares a `json` flag. A new command goes here or in WITHOUT_JSON.
const names = (list: string): string[] => list.trim().split(/,\s*/);
const WITH_JSON = names(`
  add, audio, auth status, beats, benchmark, capture, catalog, catch-up, check, clean,
  cloud delete, cloud get, cloud list, cloud render, cloudrun, compare, compositions, diff,
  doctor, grade-compare, history begin, history end, history peek, history pin,
  history restore, history show, history undo, info, inspect, keyframes, lambda, layout, lint,
  measure curve, measure cuts, measure energy, measure events, measure extract, measure face,
  measure frames, measure hands, measure ink, measure look, measure probe, measure sync,
  media-treatment, media-use adopt, media-use analyze, media-use avatars, media-use candidates,
  media-use doctor, media-use from, media-use generate, media-use params, media-use resolve,
  media-use reuse, media-use stats, media-use voices, models, normalize-audio, open, preview,
  remove-background, render, reverse start, share, skills check, skills update, snapshot,
  telemetry, timeline apply, timeline delete, timeline duplicate, timeline ids, timeline move,
  timeline set, timeline split, timeline trim, timeline undo, transcribe, tts, update, upgrade,
  usage, validate
`);
const WITHOUT_JSON = names(`
  auth login, auth logout, auth refresh, billing, browser, docs, events, feedback, figma asset,
  figma component, figma tokens, init, play, present, publish, templates
`);

// Command words that take subcommands, run on their own. REFUSED answer `json_unsupported`.
const REFUSED_PARENTS = names("auth, cloud, figma, media-use, skills");
const OTHER_PARENTS = names("history, measure, reverse, timeline");

interface Leaf {
  path: string[];
  json: boolean;
  required: string[];
  parent?: true;
}

const load = async (entry: unknown): Promise<CommandDef> =>
  (typeof entry === "function" ? await (entry as Loader)() : await entry) as CommandDef;

async function leaves(command: CommandDef, path: string[] = []): Promise<Leaf[]> {
  const subs = command.subCommands as Record<string, unknown> | undefined;
  if (subs) {
    const nested = Object.entries(subs).map(async ([name, entry]) =>
      leaves(await load(entry), [...path, name]),
    );
    const own: Leaf[] = path.length ? [{ path, json: false, required: [], parent: true }] : [];
    return [...own, ...(await Promise.all(nested)).flat()];
  }
  const args = Object.entries((command.args ?? {}) as ArgsDef);
  // Enough words for citty's own required-argument check to pass.
  const required = args.flatMap(([name, arg]) => {
    if (arg.default !== undefined) return [];
    if (arg.type === "positional") return arg.required === false ? [] : ["x"];
    return arg.required ? [`--${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}=x`] : [];
  });
  return [{ path, json: "json" in (command.args ?? {}), required }];
}

/** The CLI's own command tree, read from the entry point without running a command. */
async function commandTree(): Promise<Leaf[]> {
  let root: CommandDef | undefined;
  vi.doMock("citty", async (original) => ({
    ...(await original<typeof import("citty")>()),
    runCommand: async (command: CommandDef) => void (root = command),
  }));
  mockTelemetry();
  studioBuilt();
  process.argv = ["node", "cli.ts", "info"];
  const restoreListeners = keepListeners();
  await import("./cli.js");
  await vi.dynamicImportSettled();
  restoreListeners();
  vi.doUnmock("citty");
  vi.resetModules();
  return leaves(root!);
}

// A leaf's own work is replaced by one line; its flag checks stay real.
function stubLeafRuns(command: CommandDef): CommandDef {
  const subs = command.subCommands as Record<string, unknown> | undefined;
  const run: CommandDef["run"] = ({ args }) => console.log(`ran json=${args.json}`);
  if (!subs) return { ...command, run };
  const stubbed = Object.entries(subs).map(([name, entry]) => [
    name,
    async () => stubLeafRuns(await load(entry)),
  ]);
  // citty also calls a parent's handler after its subcommand; the stand-in speaks only when run bare.
  const bare: CommandDef["run"] = (context) =>
    context.rawArgs.some((arg) => arg in subs) ? undefined : run(context);
  return {
    ...command,
    ...(command.run ? { run: bare } : {}),
    subCommands: Object.fromEntries(stubbed),
  };
}

async function run(args: string[]): Promise<{ stdout: string; exit: unknown }> {
  let stdout = "";
  vi.doMock("./utils/command-failure-tracking.js", async (original) => {
    const actual = await original<Tracking>();
    return {
      ...actual,
      trackCommandFailures: (loader: Loader) =>
        actual.trackCommandFailures(async () => stubLeafRuns(await loader())),
    };
  });
  mockTelemetry();
  studioBuilt();
  const keep = (chunk: unknown): boolean => {
    stdout += String(chunk);
    return true;
  };
  vi.spyOn(process.stdout, "write").mockImplementation(keep as typeof process.stdout.write);
  vi.spyOn(console, "log").mockImplementation((line) => void keep(`${line}\n`));
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.exitCode = undefined;
  process.argv = ["node", "cli.ts", ...args];
  const restoreListeners = keepListeners();
  await import("./cli.js");
  await vi.dynamicImportSettled();
  restoreListeners();
  const exit = process.exitCode ?? 0;
  vi.restoreAllMocks();
  vi.resetModules();
  return { stdout, exit };
}

describe("--json ahead of the command word", () => {
  it.each([
    [
      ["--json", "info"],
      ["info", "--json"],
    ],
    [
      ["--json", "--verbose", "info", "dir"],
      ["--verbose", "info", "dir", "--json"],
    ],
    [
      ["--json", "lambda", "policies", "validate", "a.json"],
      ["lambda", "policies", "validate", "a.json", "--json"],
    ],
    [
      ["--json", "--json", "info"],
      ["info", "--json"],
    ],
    [
      ["--json", "info", "--json"],
      ["info", "--json"],
    ],
    [
      ["--json=false", "info"],
      ["info", "--json=false"],
    ],
    [
      ["--json", "add", "x", "--", "--y"],
      ["add", "x", "--json", "--", "--y"],
    ],
    [
      ["info", "--", "--json"],
      ["info", "--", "--json"],
    ],
    [
      ["--", "--json", "info"],
      ["--", "--json", "info"],
    ],
    [["--json"], ["--json"]],
    [
      ["info", "--json"],
      ["info", "--json"],
    ],
  ])("%j is read as %j", (given, read) => {
    expect(jsonFlagAfterCommand(given)).toEqual(read);
  });

  it.each([
    [["info", "--json"], true],
    [["info", "--", "--json"], false],
    [["info", "--json=false"], false],
  ])("%j asks for JSON: %s", (argv, asks) => {
    expect(jsonFlagBeforeSeparator(argv)).toBe(asks);
  });

  // fails without the fix: `--json help info` was answered as an unknown command named `help`.
  it("prints a command's help the same in both positions", async () => {
    const first = await run(["--json", "help", "info"]);
    const after = await run(["help", "info", "--json"]);
    expect(first).toEqual(after);
    expect(first.exit).toBe(0);
    expect(first.stdout).toContain("hyperframes info");
    expect(first.stdout).not.toContain("unknown_command");
  });

  it("answers the same in both positions, for every command", async () => {
    const tree = await commandTree();
    const named = (json: boolean) =>
      tree
        .filter((leaf) => !leaf.parent && leaf.json === json)
        .map((leaf) => leaf.path.join(" "))
        .sort();
    expect({ with: named(true), without: named(false) }).toEqual({
      with: WITH_JSON,
      without: WITHOUT_JSON,
    });

    const parents = tree.filter((leaf) => leaf.parent).map((leaf) => leaf.path.join(" "));
    expect(parents.sort()).toEqual([...REFUSED_PARENTS, ...OTHER_PARENTS].sort());

    const wrong: unknown[] = [];
    for (const leaf of tree) {
      const words = [...leaf.path, ...leaf.required];
      const first = await run(["--json", ...words]);
      const after = await run([...words, "--json"]);
      if (leaf.parent && !REFUSED_PARENTS.includes(leaf.path.join(" "))) {
        if (JSON.stringify(first) !== JSON.stringify(after)) wrong.push({ words, first, after });
        continue;
      }
      const expected = leaf.json
        ? { stdout: "ran json=true\n", exit: 0 }
        : {
            stdout: `${JSON.stringify({
              ok: false,
              error: {
                code: "json_unsupported",
                message: `hyperframes ${leaf.path.join(" ")} has no JSON output.`,
                hint: "Run it without --json.",
              },
            })}\n`,
            exit: 2,
          };
      if (JSON.stringify([first, after]) !== JSON.stringify([expected, expected])) {
        wrong.push({ command: words, first, after });
      }
    }
    expect(wrong).toEqual([]);
  }, 600_000);
});
