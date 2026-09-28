import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { installerScript } from "./autoUpdate.js";

// Runs the real detached-installer script; the "install" only writes a marker file.
const dirs: string[] = [];
const children: ChildProcess[] = [];

afterEach(() => {
  for (const child of children.splice(0)) child.kill();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "hf-installer-"));
  dirs.push(dir);
  const runningDir = join(dir, "running");
  mkdirSync(runningDir);
  const marker = join(dir, "installed");
  const script = installerScript({
    configFile: join(dir, "config.json"),
    version: "9.9.9",
    bin: process.execPath,
    args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "")`],
    runningDir,
    pollMs: 50,
    maxWaitMs: 60_000,
    staleMs: 60_000,
  });
  return { dir, runningDir, marker, script };
}

function start(args: string[]): ChildProcess {
  const child = spawn(process.execPath, args, { stdio: "ignore" });
  children.push(child);
  return child;
}

const exited = (child: ChildProcess) =>
  child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve()
    : new Promise<void>((resolve) => child.once("exit", () => resolve()));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check: () => boolean): Promise<void> {
  while (!check()) await sleep(25);
}

function registerCli(runningDir: string): ChildProcess {
  const cli = start(["-e", "setInterval(() => {}, 1000)"]);
  writeFileSync(join(runningDir, String(cli.pid)), "");
  return cli;
}

it("never replaces package files while a CLI process is running, then installs once it exits", async () => {
  const { dir, runningDir, marker, script } = setup();
  const cli = registerCli(runningDir);
  const installer = start(["-e", script]);

  await sleep(1000);
  expect(existsSync(marker)).toBe(false);

  cli.kill();
  await exited(installer);
  expect(existsSync(marker)).toBe(true);
  expect(JSON.parse(readFileSync(join(dir, "config.json"), "utf-8")).completedUpdate).toMatchObject(
    { version: "9.9.9", ok: true },
  );
});

it("does not wait on a CLI process that died without cleaning up", async () => {
  const { runningDir, marker, script } = setup();
  const dead = start(["-e", ""]);
  await exited(dead);
  const staleFile = join(runningDir, String(dead.pid));
  writeFileSync(staleFile, "");

  await exited(start(["-e", script]));
  expect(existsSync(marker)).toBe(true);
  expect(existsSync(staleFile)).toBe(false);
});

it("does not wait on an old pid file whose pid now belongs to another process", async () => {
  const { runningDir, marker, script } = setup();
  const other = start(["-e", "setInterval(() => {}, 1000)"]);
  const staleFile = join(runningDir, String(other.pid));
  writeFileSync(staleFile, "");
  const tenMinutesAgo = new Date(Date.now() - 10 * 60_000);
  utimesSync(staleFile, tenMinutesAgo, tenMinutesAgo);

  await exited(start(["-e", script]));
  expect(existsSync(marker)).toBe(true);
  expect(existsSync(staleFile)).toBe(false);
});

it("lets only one installer wait: a later launch exits and installs nothing", async () => {
  const { dir, runningDir, marker, script } = setup();
  const cli = registerCli(runningDir);
  const first = start(["-e", script]);
  await until(() => existsSync(join(dir, "config.json.install-lock")));

  await exited(start(["-e", script]));
  expect(existsSync(marker)).toBe(false);

  cli.kill();
  await exited(first);
  expect(existsSync(marker)).toBe(true);
});

it("takes over an old install lock whose pid now belongs to another process", async () => {
  const { dir, marker, script } = setup();
  const other = start(["-e", "setInterval(() => {}, 1000)"]);
  const lock = join(dir, "config.json.install-lock");
  writeFileSync(lock, String(other.pid));
  const tenMinutesAgo = new Date(Date.now() - 10 * 60_000);
  utimesSync(lock, tenMinutesAgo, tenMinutesAgo);

  await exited(start(["-e", script]));
  expect(existsSync(marker)).toBe(true);
});
