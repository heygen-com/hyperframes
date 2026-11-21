import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { describe, expect, it, onTestFinished } from "vitest";
import { ID_PATH } from "./historyId.js";
import { openProjectHistory } from "./projectHistory.js";
import { KEEP_GONE_PROJECT_HISTORY_MS, pruneGoneProjectHistories } from "./pruneHistories.js";

// Answers the first read of a named pipe only once the main thread has run while that read waits, as a slow, cloud
// or unmounted disk would; later reads find a plain file. A read that holds the thread never lets it run.
const SLOW_DISK = `
const { workerData, parentPort } = require("node:worker_threads");
const fs = require("node:fs");
const { pipe, id, flag } = workerData;
const fd = fs.openSync(pipe, "w");
const mainRan = Atomics.wait(new Int32Array(flag), 0, 0, 5000) !== "timed-out";
fs.writeFileSync(pipe + ".next", id + "\\n");
fs.renameSync(pipe + ".next", pipe);
fs.writeSync(fd, id + "\\n");
fs.closeSync(fd);
parentPort.postMessage(mainRan);
`;

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function projectWithClosedHistory(historyRoot: string) {
  const projectDir = join(tempDir("hf-offthread-project-"), "film");
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, "index.html"), "<h1>A</h1>");
  const history = await openProjectHistory({ projectDir, historyRoot });
  await new Promise((settle) => setImmediate(settle));
  await history.close();
  return projectDir;
}

/** Whether the main thread ran while `start` waited on the project's history id. */
async function ranWhileIdWaits<T>(projectDir: string, start: () => Promise<T>) {
  const pipe = join(projectDir, ID_PATH);
  const id = readFileSync(pipe, "utf-8").trim();
  rmSync(pipe);
  execFileSync("mkfifo", [pipe]);
  const flag = new SharedArrayBuffer(4);
  const disk = new Worker(SLOW_DISK, { eval: true, workerData: { pipe, id, flag } });
  const answered = new Promise<boolean>((resolve, reject) => {
    disk.once("message", resolve);
    disk.once("error", reject);
  });
  const running = start();
  await new Promise((next) => setImmediate(next));
  Atomics.store(new Int32Array(flag), 0, 1);
  Atomics.notify(new Int32Array(flag), 0);
  const mainRan = await answered;
  return { mainRan, result: await running };
}

describe.skipIf(process.platform === "win32")(
  "a project's history id is read off the thread",
  () => {
    // fails without the fix: the prune read each project's history id with readFileSync.
    it("by the prune of gone projects", async () => {
      const historyRoot = tempDir("hf-offthread-root-");
      const projectDir = await projectWithClosedHistory(historyRoot);

      const { mainRan, result } = await ranWhileIdWaits(projectDir, () =>
        pruneGoneProjectHistories(historyRoot, {
          now: Date.now() + 1 + KEEP_GONE_PROJECT_HISTORY_MS,
        }),
      );

      expect(mainRan).toBe(true);
      expect(result).toEqual([]);
    });

    // fails without the fix: the open read the project's history id with readFileSync.
    it("by an open", async () => {
      const historyRoot = tempDir("hf-offthread-root-");
      const projectDir = await projectWithClosedHistory(historyRoot);

      const { mainRan, result: history } = await ranWhileIdWaits(projectDir, () =>
        openProjectHistory({ projectDir, historyRoot }),
      );
      await history.close();

      expect(mainRan).toBe(true);
    });
  },
);
