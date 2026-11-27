import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { writeHistoryState } from "./videoState.js";

const collection = () => ({ latest: null, revisions: {}, unversioned: [] });
const stored = {
  version: 1,
  historyId: null,
  currentRevision: null,
  pendingChanges: true,
  files: {},
  revisions: {},
  checks: collection(),
  snapshots: collection(),
};

let projectDir = "";
afterEach(() => {
  vi.useRealTimers();
  rmSync(projectDir, { recursive: true, force: true });
});

const write = (historyId: string) =>
  writeHistoryState(projectDir, historyId, join(projectDir, "h"), [], new Map(), new Map());

// fails without the fix: the state file was read and written with sync calls on the caller's thread, so a project
// whose drive stopped answering froze the app that opened it until the drive answered.
it.skipIf(process.platform === "win32")(
  "a state file whose drive never answers leaves the caller's thread free and gives up at its deadline",
  async () => {
    projectDir = mkdtempSync(join(tmpdir(), "hf-video-state-silent-"));
    mkdirSync(join(projectDir, ".hyperframes"));
    const state = join(projectDir, ".hyperframes/video-state.json");
    execFileSync("mkfifo", [state]);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    let settled = false;
    const first = write("first").finally(() => (settled = true));
    const outcome = first.then(
      () => "wrote",
      (error: Error) => error.message,
    );
    // The give-up timer starts once the lock is held and the read is waiting; ticking before then skips it.
    for (let turn = 0; turn < 100_000 && vi.getTimerCount() === 0; turn++)
      await new Promise((next) => setImmediate(next));
    expect(vi.getTimerCount()).toBe(1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await outcome).toMatch(/did not answer within 5000 ms\. The save may still land later/);
    vi.useRealTimers();

    // The drive answers: the given-up write finishes and frees the lock, so the next write takes it (one still held
    // would refuse it busy after the lock's 5 s wait).
    const drive = await open(state, "w");
    await drive.writeFile(JSON.stringify(stored));
    await drive.close();
    await expect(write("second")).resolves.toBeUndefined();
  },
);
