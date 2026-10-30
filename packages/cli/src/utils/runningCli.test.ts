import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { RUNNING_STALE_MS, registerRunningCli } from "./runningCli.js";

let dir = "";
afterEach(() => rmSync(dir, { recursive: true, force: true }));

it("marks this process as running until it exits", () => {
  dir = mkdtempSync(join(tmpdir(), "hf-running-"));
  const before = process.listeners("exit");
  registerRunningCli(join(dir, "running"));
  const file = join(dir, "running", String(process.pid));
  expect(existsSync(file)).toBe(true);

  const added = process.listeners("exit").filter((listener) => !before.includes(listener));
  for (const listener of added) {
    listener(0);
    process.off("exit", listener);
  }
  expect(existsSync(file)).toBe(false);
});

it("rewrites the file on each heartbeat, so a removed file comes back", async () => {
  dir = mkdtempSync(join(tmpdir(), "hf-running-"));
  const before = process.listeners("exit");
  registerRunningCli(join(dir, "running"), 20);
  const file = join(dir, "running", String(process.pid));
  unlinkSync(file);
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(existsSync(file)).toBe(true);

  for (const listener of process.listeners("exit").filter((l) => !before.includes(l))) {
    listener(0);
    process.off("exit", listener);
  }
});

// A CLI killed by a signal never runs its exit listener, and the installer that sweeps such
// files never runs for an install layout it does not recognise, so each start sweeps too.
it("removes the files of processes that are gone or stopped beating, and keeps live ones", () => {
  dir = mkdtempSync(join(tmpdir(), "hf-running-"));
  const running = join(dir, "running");
  mkdirSync(running, { recursive: true });
  const exited = spawnSync(process.execPath, ["-e", ""]).pid;
  const longAgo = new Date(Date.now() - RUNNING_STALE_MS - 60_000);
  const dead = join(running, String(exited));
  const silent = join(running, String(process.ppid));
  const junk = join(running, "not-a-pid");
  writeFileSync(dead, "");
  writeFileSync(junk, "");
  writeFileSync(silent, "");
  utimesSync(silent, longAgo, longAgo);

  const before = process.listeners("exit");
  registerRunningCli(running);

  // Read the folder rather than test each path: an existence check followed by a write to the same
  // path below is what CodeQL reports as a file system race. A listing also catches a stray file.
  // A live pid whose file has not been touched for longer than the stale window is a reused pid.
  expect(readdirSync(running)).toEqual([String(process.pid)]);

  // The same live pid with a fresh file is another CLI that is still beating.
  writeFileSync(silent, "");
  registerRunningCli(running);
  expect(readdirSync(running).sort()).toEqual([String(process.pid), String(process.ppid)].sort());

  for (const listener of process.listeners("exit").filter((l) => !before.includes(l))) {
    listener(0);
    process.off("exit", listener);
  }
});
