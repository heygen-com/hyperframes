import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CommandDef } from "citty";
import { afterAll, describe, expect, it } from "vitest";
import { isDefinedCommand } from "./utils/defineCommand.js";
import { checkStudioWorkspaceBuild } from "./utils/workspaceBuildCheck.js";

// Runs every registered command the way a coding agent does: no terminal, stdin closed, CI set,
// an agent marker in the environment, and a home folder of its own. A new command is covered as
// soon as it is added to `commandLoaders` in cli.ts.

const srcDir = dirname(fileURLToPath(import.meta.url));
const cliEntry = join(srcDir, "cli.ts");
const home = mkdtempSync(join(tmpdir(), "hf-agent-mode-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));

const ANSI = "\u001b[";
const PROMPT = /\(y\/N\)|Yes \/ No|[◆◇]\s+[^\n]*\?\s*$/m;
const NAG = /Update available|auto-updated to|skills? out of date or missing/;

interface Registered {
  path: string[];
  command: CommandDef;
}

type Resolvable = CommandDef | Promise<CommandDef> | (() => CommandDef | Promise<CommandDef>);

async function resolveCommand(entry: Resolvable): Promise<CommandDef> {
  return typeof entry === "function" ? await entry() : await entry;
}

function registeredModules(): { name: string; file: string; exportName: string }[] {
  const source = readFileSync(cliEntry, "utf8");
  const block = source.match(/const commandLoaders = \{([\s\S]*?)\n\};/)?.[1] ?? "";
  const entry =
    /^\s+"?([\w-]+)"?:[\s\S]*?import\("\.\/commands\/([\w/-]+)\.js"\)\.then\(\(m\) => m\.(\w+)\)/gm;
  return [...block.matchAll(entry)].map(([, name, file, exportName]) => ({
    name: name!,
    file: file!,
    exportName: exportName!,
  }));
}

async function walk(path: string[], command: CommandDef, out: Registered[]): Promise<void> {
  out.push({ path, command });
  const subCommands = (await resolveCommand(
    (command.subCommands ?? {}) as Resolvable,
  )) as unknown as Record<string, Resolvable>;
  for (const [name, sub] of Object.entries(subCommands)) {
    await walk([...path, name], await resolveCommand(sub), out);
  }
}

async function registeredCommands(): Promise<Registered[]> {
  const out: Registered[] = [];
  for (const { name, file, exportName } of registeredModules()) {
    const mod = (await import(`./commands/${file}.ts`)) as Record<string, CommandDef>;
    await walk([name], mod[exportName]!, out);
  }
  return out;
}

interface Run {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

function runAsAgent(args: string[], { ci = true } = {}): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn("bun", ["run", cliEntry, ...args], {
      cwd: home,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15_000,
      env: {
        PATH: process.env.PATH,
        HOME: home,
        USERPROFILE: home,
        ...(ci ? { CI: "1" } : {}),
        CLAUDECODE: "1",
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

function expectQuiet(run: Run): void {
  expect(run.signal, "finished before the timeout").toBeNull();
  const output = run.stdout + run.stderr;
  expect(output).not.toContain(ANSI);
  expect(output).not.toMatch(PROMPT);
  expect(output).not.toMatch(NAG);
}

function declaresJson(command: CommandDef): boolean {
  const args = command.args;
  return typeof args === "object" && args !== null && "json" in args;
}

function expectJsonFailure(run: Run, code?: string): void {
  const parsed = JSON.parse(run.stdout) as { ok?: unknown; error?: { code?: unknown } };
  expect(parsed.ok).toBe(false);
  expect(typeof parsed.error?.code).toBe("string");
  if (code) expect(parsed.error?.code).toBe(code);
}

const commands = await registeredCommands();
// From source, `preview` refuses to load until the studio packages are built; the test job does
// not build them, so preview is only spawned where they are.
const studioBuilt = checkStudioWorkspaceBuild(join(srcDir, "..", "..", "..")).length === 0;
const spawnable = commands.filter((c) => studioBuilt || c.path[0] !== "preview");

describe("agent-mode contract", () => {
  it("finds the registered commands", () => {
    expect(commands.length).toBeGreaterThan(50);
  });

  it.each(commands.map((c) => [c.path.join(" "), c] as const))(
    "%s is defined with the shared factory",
    (_label, { command }) => {
      expect(isDefinedCommand(command)).toBe(true);
    },
  );

  describe.concurrent("each command", () => {
    it.each(spawnable.map((c) => [c.path.join(" "), c.path] as const))(
      "%s --help prints plain help and exits 0",
      async (_label, path) => {
        const run = await runAsAgent([...path, "--help"]);
        expectQuiet(run);
        expect(run.code, run.stderr).toBe(0);
        expect(run.stdout).toContain("USAGE");
      },
    );

    it.each(
      spawnable
        .filter((c) => declaresJson(c.command))
        .map((c) => [c.path.join(" "), c.path] as const),
    )("%s --json answers a usage error with the JSON envelope", async (_label, path) => {
      const run = await runAsAgent([...path, "--json", "--not-a-real-flag"]);
      expectQuiet(run);
      expect(run.code, run.stderr).toBe(2);
      expectJsonFailure(run);
    });

    it.each(
      spawnable
        .filter((c) => !declaresJson(c.command))
        .map((c) => [c.path.join(" "), c.path] as const),
    )(
      "%s has no JSON output, so --json is a usage error, answered as JSON",
      async (_label, path) => {
        const run = await runAsAgent([...path, "--json"]);
        expectQuiet(run);
        expect(run.code, run.stderr).toBe(2);
        expectJsonFailure(run);
      },
    );

    it.each(spawnable.map((c) => [c.path.join(" "), c.path] as const))(
      "%s rejects an unknown flag with exit 2",
      async (_label, path) => {
        const run = await runAsAgent([...path, "--not-a-real-flag"]);
        expectQuiet(run);
        expect(run.code, run.stderr).toBe(2);
        expect(run.stdout).toBe("");
      },
    );
  });

  it.each([
    ["lambda progress"],
    ["cloudrun progress"],
    ["capture"],
    ["remove-background in.mp4"],
    ["init demo --resolution huge --non-interactive"],
  ])("`%s` is missing or misusing an argument, a usage error with exit 2", async (args) => {
    const run = await runAsAgent(args.split(" "));
    expectQuiet(run);
    expect(run.code, run.stderr).toBe(2);
  });

  // A bad flag value or flag combination a command checks itself is a usage error like any other:
  // exit 2, and under --json a usage_error envelope that names the problem.
  describe.concurrent("flag checks a command makes itself", () => {
    it.each([
      ["lambda render proj", "--width and --height are required"],
      ["lambda render proj --width 1920 --height 1080 --fps 7", "--fps must be one of"],
      ["lambda render proj --width 0 --height 1080", "--width must be a positive integer"],
      ["lambda render proj --width 1920 --height 1080 --chunk-size 0", "--chunk-size must be"],
      ["lambda render proj --width 1920 --height 1080 --format avi", "--format must be"],
      ["lambda render proj --width 1920 --height 1080 --output-resolution 8k", "8k"],
      ["lambda render-batch proj --batch b.jsonl", "--width and --height are required"],
      ["lambda render-batch proj --batch b.jsonl --width 1920 --height 1080 --fps 7", "--fps"],
      ["lambda deploy --concurrency 0", "--concurrency must be"],
      ["lambda sites bogus", 'unknown verb "bogus"'],
      ["lambda bogus", "Unknown subcommand"],
      ["cloudrun render proj", "--width and --height are required"],
      ["cloudrun render proj --width 1920 --height 1080 --fps 7", "--fps must be one of"],
      ["cloudrun render proj --width 1920 --height 1080 --chunk-size 0", "--chunk-size must be"],
      ["cloudrun render proj --width 1920 --height 1080 --wait-interval-ms 0", "--wait-interval"],
      ["cloudrun render proj --width 1920 --height 1080 --variables {bad", "--variables"],
      ["cloudrun render-batch proj --batch b.jsonl", "--width and --height are required"],
      ["cloudrun render-batch proj --batch b.jsonl --width 1920 --height 1080 --fps 7", "--fps"],
      ["cloudrun render-batch proj --batch b.jsonl --width 640 --height 360 --format avi", "avi"],
      ["cloudrun sites bogus", 'unknown verb "bogus"'],
      ["cloudrun bogus", "Unknown subcommand"],
      ["capture https://example.com --max-screenshots 0", "--max-screenshots must be"],
      ["capture https://example.com --capture-budget 0", "--capture-budget must be"],
      ["capture https://example.com --local-file page.html", "not both"],
      ["capture not-a-url", "Invalid URL"],
      ["benchmark --runs 0", "Invalid runs"],
      ["models bogus", "Unknown: models bogus"],
      ["tts", "Provide text to speak"],
      ["tts hello --speed 9", "Speed must be"],
      ["cloud render --asset-id a --url https://example.com/p.zip", "Conflicting inputs"],
      ["cloud delete render_1", "Confirmation required"],
      ["snapshot --at 1 --range 0,1", "Use only one of"],
      ["snapshot --at x", "--at must be"],
      ["snapshot --frames abc", "--frames must be a positive integer"],
      ["snapshot --frames -3", "--frames must be a positive integer"],
      ["compare a.html", "need 2+ paths"],
      ["compare a.html b.html --cols 0", "--cols must be"],
      ["grade-compare --for frame.png", "Exactly one of --grades or --luts"],
      ["check --range 5,1", "Invalid --range"],
      ["normalize-audio --target music --tolerance=-1", "--tolerance must be"],
      ["media-treatment --capabilities --all --capability x", "--all or --capability"],
    ])("`%s` exits 2 with a usage_error envelope", async (args, message) => {
      const run = await runAsAgent([...args.split(" "), "--json"]);
      expectQuiet(run);
      expect(run.code, run.stderr).toBe(2);
      expectJsonFailure(run, "usage_error");
      expect(JSON.parse(run.stdout).error.message).toContain(message);
    });

    it.each([
      ["feedback --rating 99", "Rating must be an integer between 0 and 10"],
      ["feedback", "Give a --rating"],
      ["feedback --comment x --file-issue", "--file-issue needs a --rating"],
      ["feedback --rating 5 --source bot", "Source must be"],
      ["browser bogus", "Unknown subcommand"],
      ["telemetry bogus", "Unknown subcommand"],
      ["docs bogus", "Unknown topic"],
      ["init demo --template x --non-interactive", "renamed to --example"],
      ["init demo --video a.mp4 --audio b.mp3 --non-interactive", "--video and --audio"],
      ["play --port 0", "--port must be"],
      ["present --port 0", "--port must be"],
    ])("`%s` has no JSON output and exits 2 naming the problem", async (args, message) => {
      const run = await runAsAgent(args.split(" "));
      expect(run.signal, "finished before the timeout").toBeNull();
      expect(run.code, run.stderr).toBe(2);
      expect(run.stdout + run.stderr).toContain(message);
    });
  });

  it.each([
    ["help", "Usage:"],
    ["help render", "USAGE hyperframes render"],
    ["help cloud render", "USAGE cloud render"],
  ])("`%s` prints that help on stdout and exits 0", async (args, heading) => {
    const run = await runAsAgent(args.split(" "));
    expectQuiet(run);
    expect(run.code, run.stderr).toBe(0);
    expect(run.stdout).toContain(heading);
    expect(run.stderr).toBe("");
  });

  it("help stays plain inside an agent even without CI", async () => {
    const run = await runAsAgent(["render", "--help"], { ci: false });
    expectQuiet(run);
    expect(run.code).toBe(0);
  });

  it.each([
    ["rendr", "Did you mean 'hyperframes render'?"],
    ["cloud rendr", "Did you mean 'hyperframes cloud render'?"],
    ["help rendr", "Did you mean 'hyperframes render'?"],
    ["help cloud rendr", "Did you mean 'hyperframes cloud render'?"],
    ["search crossfade", "Did you mean 'hyperframes catalog'?"],
    ["install crossfade", "Did you mean 'hyperframes add'?"],
    ["find crossfade", "Did you mean 'hyperframes catalog'?"],
    ["list", "Did you mean 'hyperframes catalog'?"],
    ["browse", "Did you mean 'hyperframes catalog'?"],
    ["registry", "Did you mean 'hyperframes catalog'?"],
  ])(
    "unknown command `%s` suggests the closest one, usage on stderr, exit 2",
    async (args, hint) => {
      const run = await runAsAgent(args.split(" "));
      expectQuiet(run);
      expect(run.code).toBe(2);
      expect(run.stdout).toBe("");
      expect(run.stderr).toContain(hint);
    },
  );

  it.each([["lint"], ["check"], ["info"], ["validate"], ["layout"], ["inspect"]])(
    "%s --json in an empty directory names the real failure, and no notice",
    async (name) => {
      const run = await runAsAgent([name, "--json"]);
      const parsed = JSON.parse(run.stdout) as { ok: boolean; error: { message: string } };
      expect(parsed.ok).toBe(false);
      expect(parsed.error.message).toContain("No composition found");
      expect(parsed.error.message).not.toMatch(/Command failed|deprecated|anonymous usage/);
    },
  );

  it("a missing argument under --json is a usage_error with the real message", async () => {
    const run = await runAsAgent(["capture", "--json"]);
    expect(run.code).toBe(2);
    expectJsonFailure(run, "usage_error");
    expect(JSON.parse(run.stdout).error.message).toContain("Missing URL");
  });

  it("a runtime failure under --json is an envelope that says why, not empty stdout", async () => {
    const run = await runAsAgent(["info", "--json"]);
    expectQuiet(run);
    expect(run.code).toBe(1);
    expectJsonFailure(run, "runtime_error");
    expect(run.stdout).toContain("No composition found");
  });

  it("a render that fails under --json prints only the envelope on stdout", async () => {
    const project = join(home, "render-json");
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, "index.html"), "<!doctype html><html><body></body></html>");
    const run = await runAsAgent(["render", project, "--variables", "{bad", "--json"]);
    expectQuiet(run);
    expect(run.code, run.stderr).toBe(2);
    expect(run.stdout.trim().split("\n")).toHaveLength(1);
    expectJsonFailure(run, "usage_error");
    expect(JSON.parse(run.stdout).error.message).toBe("Invalid JSON in --variables");
  });

  it("a --strict lint abort under --json names the lint errors, on stdout and stderr", async () => {
    const project = join(home, "render-strict");
    mkdirSync(project, { recursive: true });
    writeFileSync(
      join(project, "index.html"),
      '<!doctype html><html><body><div data-composition-id="main"></div></body></html>',
    );
    const run = await runAsAgent(["render", project, "--strict", "--json"]);
    expectQuiet(run);
    expect(run.code, run.stderr).toBe(1);
    expectJsonFailure(run, "runtime_error");
    const { message } = JSON.parse(run.stdout).error as { message: string };
    expect(message).toMatch(/Aborting render due to lint issues in --strict mode: [1-9]\d* error/);
    expect(run.stderr).toContain(message);
  });

  it("an unknown command under --json is an envelope with the suggestion", async () => {
    const run = await runAsAgent(["rendr", "--json"]);
    expect(run.code).toBe(2);
    expectJsonFailure(run, "unknown_command");
    expect(JSON.parse(run.stdout).error.hint).toBe("Did you mean 'hyperframes render'?");
  });

  it("an unknown flag suggests the flag it most likely means", async () => {
    const run = await runAsAgent(["render", "--out", "x.mp4"]);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain("Did you mean --output?");
  });

  it.each([["publish"], ["upgrade"]])(
    "%s without --yes refuses to prompt, names --yes, and exits 2",
    async (name) => {
      const run = await runAsAgent([name]);
      expectQuiet(run);
      expect(run.code, run.stderr).toBe(2);
      expect(run.stdout).toBe("");
      expect(run.stderr).toContain("--yes");
    },
  );

  it("only the prompt wrapper loads @clack/prompts, statically or dynamically", () => {
    const offenders = (readdirSync(srcDir, { recursive: true }) as string[]).filter(
      (file) =>
        file.endsWith(".ts") &&
        !file.endsWith(".test.ts") &&
        file !== join("ui", "prompts.ts") &&
        readFileSync(join(srcDir, file), "utf8").includes('"@clack/prompts"'),
    );
    expect(offenders).toEqual([]);
  });
});
