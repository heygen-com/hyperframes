// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { openProjectHistory, readProjectHistory } from "./projectHistory";

// A history folder whose disk stops answering for `stall.ms` on every read of its records, through either kind of
// call; each span is when one read began and ended.
const stall = vi.hoisted(() => ({ ms: 0, home: "", spans: [] as Array<[number, number]> }));
const RECORDS = ["project.json", "log.jsonl", "stat.json", "adopting.json", "went-ahead.json"];
const stalls = (path: unknown) =>
  stall.ms > 0 &&
  typeof path === "string" &&
  path.startsWith(stall.home) &&
  RECORDS.includes(basename(path));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const slowed = <F extends (...args: never[]) => unknown>(call: F) =>
    ((path: unknown, ...rest: unknown[]) => {
      if (stalls(path)) {
        const began = performance.now();
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, stall.ms);
        stall.spans.push([began, performance.now()]);
      }
      return (call as (...args: unknown[]) => unknown)(path, ...rest);
    }) as unknown as F;
  return {
    ...actual,
    readFileSync: slowed(actual.readFileSync),
    statSync: slowed(actual.statSync),
    existsSync: slowed(actual.existsSync),
    utimesSync: slowed(actual.utimesSync),
  };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const slowed = <F extends (...args: never[]) => Promise<unknown>>(call: F) =>
    (async (path: unknown, ...rest: unknown[]) => {
      if (stalls(path)) {
        const began = performance.now();
        await new Promise((settle) => setTimeout(settle, stall.ms));
        stall.spans.push([began, performance.now()]);
      }
      return (call as (...args: unknown[]) => Promise<unknown>)(path, ...rest);
    }) as unknown as F;
  return {
    ...actual,
    readFile: slowed(actual.readFile),
    stat: slowed(actual.stat),
    utimes: slowed(actual.utimes),
  };
});

const roots: string[] = [];
afterEach(() => {
  Object.assign(stall, { ms: 0, home: "", spans: [] });
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function closedHistory() {
  const root = mkdtempSync(join(tmpdir(), "hf-open-stall-"));
  roots.push(root);
  const projectDir = join(root, "film");
  mkdirSync(projectDir);
  writeFileSync(join(projectDir, "index.html"), "<h1>A</h1>");
  const historyRoot = join(root, "history");
  const first = await openProjectHistory({ projectDir, historyRoot });
  const home = join(historyRoot, first.projectId);
  await first.close();
  return { projectDir, historyRoot, home };
}

/** Runs `work` with every read of the history's records stalled; the share of stalls the thread ran through. */
async function pingedThroughStalls(home: string, work: () => Promise<unknown>) {
  const pings: number[] = [];
  const ping = setInterval(() => pings.push(performance.now()), 5);
  Object.assign(stall, { ms: 150, home });
  try {
    await work();
  } finally {
    clearInterval(ping);
    stall.ms = 0;
  }
  const ranThrough = stall.spans.filter(([began, ended]) =>
    pings.some((at) => at > began && at < ended),
  );
  return { stalls: stall.spans.length, ranThrough: ranThrough.length };
}

// fails without the fix: reopening read the project record, the log, the stat cache and the adoption records with
// sync calls, so a history folder whose disk stopped answering held the opening app's thread until it answered.
it("a reopen keeps the thread running while each read of the history's records waits on the disk", async () => {
  const { projectDir, historyRoot, home } = await closedHistory();
  let history: Awaited<ReturnType<typeof openProjectHistory>> | undefined;
  const { stalls, ranThrough } = await pingedThroughStalls(home, async () => {
    history = await openProjectHistory({ projectDir, historyRoot });
  });
  await history?.close();
  expect(stalls).toBeGreaterThanOrEqual(3);
  expect(ranThrough).toBe(stalls);
});

// fails without the fix: the read-only view read the project record and the log with readFileSync.
it("a read-only view keeps the thread running while each read of the history's records waits on the disk", async () => {
  const { projectDir, historyRoot, home } = await closedHistory();
  const { stalls, ranThrough } = await pingedThroughStalls(home, () =>
    readProjectHistory({ projectDir, historyRoot }),
  );
  expect(stalls).toBeGreaterThanOrEqual(2);
  expect(ranThrough).toBe(stalls);
});
