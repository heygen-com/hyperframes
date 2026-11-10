// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { openProjectHistory } from "./projectHistory";

// A slow disk, as a large project on a scanned drive is: each blocking stat or listing holds the thread this long.
const slowDisk = vi.hoisted(() => ({ ms: 0 }));
vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  const pause = new Int32Array(new SharedArrayBuffer(4));
  const slow =
    <A extends unknown[], R>(call: (...args: A) => R) =>
    (...args: A): R => {
      if (slowDisk.ms) Atomics.wait(pause, 0, 0, slowDisk.ms);
      return call(...args);
    };
  const lstatSync = slow(real.lstatSync);
  const readdirSync = slow(real.readdirSync);
  return { ...real, lstatSync, readdirSync, default: { ...real, lstatSync, readdirSync } };
});

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  slowDisk.ms = 0;
  for (const step of cleanup.splice(0).reverse()) await step();
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** The longest stretch the event loop went without turning while `work` ran. */
async function longestHold(work: () => Promise<unknown>): Promise<number> {
  let last = performance.now();
  let longest = 0;
  let running = true;
  const turn = () => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
    if (running) setImmediate(turn);
  };
  setImmediate(turn);
  await work();
  running = false;
  // The stretch since the last turn counts too: a walk that never yields ends before a first turn.
  return Math.max(longest, performance.now() - last);
}

// fails without the fix: the sweep listed the project with readdirSync and lstatSync, holding the loop for the walk.
it("a sweep of a project on a slow disk lets the host keep answering while it lists the files", async () => {
  const projectDir = tempDir("hf-history-walk-");
  for (let folder = 0; folder < 20; folder++) {
    mkdirSync(join(projectDir, `scenes-${folder}`));
    for (let file = 0; file < 20; file++)
      writeFileSync(join(projectDir, `scenes-${folder}`, `clip-${file}.html`), `<p>${file}</p>`);
  }
  // A minute on, the files are settled, as in a project opened later: the sweep stats them and hashes none.
  const history = await openProjectHistory({
    projectDir,
    historyRoot: tempDir("hf-history-root-"),
    now: () => Date.now() + 60_000,
  });
  cleanup.push(() => history.close());

  slowDisk.ms = 1;
  const longest = await longestHold(() => history.flush());

  // A blocking walk of these 420 entries holds the loop at least 420 ms.
  expect(longest, `held the loop ${longest.toFixed(1)} ms`).toBeLessThan(200);
});

// fails without the fix: every queued operation rebuilt and rewrote video-state.json, one record per project file.
it("a sweep that finds nothing leaves the video state file alone, and a change rewrites it", async () => {
  const projectDir = tempDir("hf-history-state-");
  writeFileSync(join(projectDir, "index.html"), "<h1>Hello</h1>");
  const history = await openProjectHistory({
    projectDir,
    historyRoot: tempDir("hf-history-root-"),
    now: () => Date.now() + 60_000,
  });
  cleanup.push(() => history.close());
  await history.flush();
  // Each write replaces the file, so a rewrite shows as a new inode.
  const written = () => statSync(join(projectDir, ".hyperframes", "video-state.json")).ino;
  const before = written();

  await history.flush();
  expect(written()).toBe(before);

  writeFileSync(join(projectDir, "index.html"), "<h1>Bye</h1>");
  await history.flush();
  expect(written()).not.toBe(before);
});
