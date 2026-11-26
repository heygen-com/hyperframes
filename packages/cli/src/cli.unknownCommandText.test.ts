import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, expect, it } from "vitest";

const cliEntry = join(dirname(fileURLToPath(import.meta.url)), "cli.ts");
const home = mkdtempSync(join(tmpdir(), "hf-unknown-command-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

// A CLI start can take seconds on a busy Windows runner; several at once stalled the whole job there.
const starts = { running: 0, peak: 0 };
beforeEach(() => void (starts.peak = 0));

function runCli(args: string[], cwd = home): Promise<Run> {
  return new Promise((resolve, reject) => {
    starts.peak = Math.max(starts.peak, ++starts.running);
    const child = spawn("bun", ["run", cliEntry, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
      env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, CI: "1" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      starts.running--;
      resolve({ code, stdout, stderr });
    });
  });
}

/** Runs each argv in turn, one CLI start at a time. */
async function runEach<const T extends string[][]>(...argvs: T): Promise<{ [K in keyof T]: Run }> {
  const runs: Run[] = [];
  for (const args of argvs) runs.push(await runCli(args));
  return runs as { [K in keyof T]: Run };
}

it("shows control characters in an unknown command word as visible text", async () => {
  const [word, file, json, lines] = await runEach(
    ["ren\u001b[2Jdr\u202e"],
    ["cloud", "a\u001b[2Jb.html"],
    ["cloud", "a\u001b[2Jb.html", "--json"],
    ["cloud", "a\nError: b.html"],
  );
  expect(word.stderr).toContain("Unknown command: ren\\x1b[2Jdr\\u202e\n");
  expect(file.stderr).toContain("'a\\x1b[2Jb.html' ");
  for (const run of [word, file]) {
    expect(run.code).toBe(2);
    expect(run.stderr).not.toContain("\u001b");
    expect(run.stderr).not.toContain("\u202e");
  }
  expect(JSON.parse(json.stdout).error.hint).not.toContain("\\x1b");
  expect(lines.stderr).toContain("Unknown command: a\\x0aError: b.html\n");
  expect(lines.stderr).toContain("'a\\x0aError: b.html' ");
  expect(lines.stderr.split("\n").filter((line) => line.startsWith("Error:"))).toEqual([]);
  expect(starts.peak).toBe(1);
}, 60_000);

const startsALine = (run: Run, text: string) =>
  run.stderr.split("\n").filter((line) => line.startsWith(text));

it("keeps a usage failure that repeats a typed flag on one line", async () => {
  const run = await runCli(["info", "--x\nError: y"]);
  expect(run.stderr).toContain("--x\\x0aError: y");
  expect(startsALine(run, "Error:")).toEqual([]);
}, 60_000);

it("shows control characters in a project .env key name as visible text", async () => {
  const project = mkdtempSync(join(home, "env-"));
  writeFileSync(join(project, ".env"), "KEY\u001b[2J\u202e=1\n");
  const run = await runCli(["info"], project);
  expect(run.stderr).toContain(".env: ignoring KEY\\x1b[2J\\u202e ");
  expect(run.stderr).not.toContain("\u001b");
  expect(run.stderr).not.toContain("\u202e");
}, 60_000);

it("shows direction marks in the file name the measure shortcut repeats", async () => {
  const folder = mkdtempSync(join(home, "measure-"));
  writeFileSync(join(folder, "clip\u202e\u0085.mp4"), "");
  const run = await runCli(["measure", "clip\u202e\u0085.mp4"], folder);
  expect(run.stderr).toContain("running 'probe \"clip\\u202e\\x85.mp4\"'");
  expect(run.stderr).not.toContain("\u202e");
}, 60_000);

it("keeps a flag value that looks like the next option on one line", async () => {
  const run = await runCli(["catalog", "--query", "--json=a\u001b[2Jb\nError: c"]);
  expect(run.stderr).toContain('Missing value for --query: value "--json=a\\x1b[2Jb\\x0aError: c"');
  expect(run.stderr).not.toContain("\u001b[2J");
  expect(startsALine(run, "Error:")).toEqual([]);
}, 60_000);

it("shows control characters in an extra argument as visible text", async () => {
  const [text, json] = await runEach(
    ["info", ".", "x\u001b[2Jy\nError: z"],
    ["info", ".", "x\u001b[2Jy", "--json"],
  );
  expect(text.stderr).toContain("hyperframes info: x\\x1b[2Jy\\x0aError: z\nUsage: ");
  expect(text.stderr).not.toContain("\u001b");
  expect(startsALine(text, "Error:")).toEqual([]);
  expect(JSON.parse(json.stdout).error.message).toContain("x\u001b[2Jy");
  expect(starts.peak).toBe(1);
}, 60_000);
