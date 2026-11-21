import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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

function runCli(args: string[]): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn("bun", ["run", cliEntry, ...args], {
      cwd: home,
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
