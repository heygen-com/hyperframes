import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, expect, it } from "vitest";

const cliEntry = join(dirname(fileURLToPath(import.meta.url)), "cli.ts");
const home = mkdtempSync(join(tmpdir(), "hf-unknown-command-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd = home): Promise<Run> {
  return new Promise((resolve, reject) => {
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
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

it("shows control characters in an unknown command word as visible text", async () => {
  const [word, file, json, lines] = await Promise.all([
    runCli(["ren\u001b[2Jdr\u202e"]),
    runCli(["cloud", "a\u001b[2Jb.html"]),
    runCli(["cloud", "a\u001b[2Jb.html", "--json"]),
    runCli(["cloud", "a\nError: b.html"]),
  ]);
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
  const [text, json] = await Promise.all([
    runCli(["info", ".", "x\u001b[2Jy\nError: z"]),
    runCli(["info", ".", "x\u001b[2Jy", "--json"]),
  ]);
  expect(text.stderr).toContain("hyperframes info: x\\x1b[2Jy\\x0aError: z\nUsage: ");
  expect(text.stderr).not.toContain("\u001b");
  expect(startsALine(text, "Error:")).toEqual([]);
  expect(JSON.parse(json.stdout).error.message).toContain("x\u001b[2Jy");
}, 60_000);
