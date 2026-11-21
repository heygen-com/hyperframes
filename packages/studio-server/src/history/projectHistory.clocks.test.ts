import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fileContentVersion, hashOfVersion } from "../helpers/fileVersion";
import { openProjectHistory, type ProjectHistoryOptions } from "./projectHistory";
import type { HistoryWho } from "./historyLog";

// FAT keeps file times in 2 s steps: while `held` is set, every listed file reads that one time.
const fat = vi.hoisted(() => ({ held: null as number | null }));
vi.mock("../helpers/projectSignature", async (importOriginal) => {
  const real = await importOriginal<typeof import("../helpers/projectSignature")>();
  return {
    ...real,
    listProjectFilesAsync: async (dir: string) =>
      (await real.listProjectFilesAsync(dir)).map((file) =>
        fat.held === null ? file : { ...file, mtimeMs: fat.held, ctimeMs: fat.held },
      ),
  };
});

const you: HistoryWho = { kind: "person", name: "You" };
const agent: HistoryWho = { kind: "agent", name: "Agent" };
const MINUTE = 60_000;
const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  fat.held = null;
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function project(files: Record<string, string>, options: Partial<ProjectHistoryOptions>) {
  const projectDir = mkdtempSync(join(tmpdir(), "hf-history-clocks-"));
  const historyRoot = mkdtempSync(join(tmpdir(), "hf-history-clocks-root-"));
  cleanup.push(() => rmSync(projectDir, { recursive: true, force: true }));
  cleanup.push(() => rmSync(historyRoot, { recursive: true, force: true }));
  const write = (path: string, text: string) => writeFileSync(join(projectDir, path), text);
  for (const [path, text] of Object.entries(files)) write(path, text);
  const history = await openProjectHistory({ projectDir, historyRoot, quietMs: 30, ...options });
  cleanup.push(() => history.close());
  const read = (path: string) => readFileSync(join(projectDir, path), "utf-8");
  return { history, write, read, projectDir, historyRoot };
}

// fails without the fix: history timed each write by its file's time and compared that with its own clock, so with
// the two a minute apart a person's edit vanished into the agent's turn, and a window took writes past its idle end.
describe.each([
  ["on the same clock as the files", 0],
  ["a minute ahead of the files' clock", MINUTE],
  ["a minute behind the files' clock", -MINUTE],
])("history's clock %s", (_clock, skew) => {
  const now = () => Date.now() + skew;

  it("splits an agent's turn around a person's edit, and undoing walks back in order", async () => {
    const { history, write, read } = await project({ "index.html": "A", "b.js": "1" }, { now });
    const window = await history.beginWindow(agent, "Agent turn");
    write("index.html", "B");
    write("b.js", "2");
    await history.claim(you, "scan", []);
    write("index.html", "C");
    await history.claim(you, "Moved Title", ["index.html"], {
      overwrote: { "index.html": fileContentVersion("B") },
    });
    write("index.html", "D");
    await window.close();
    expect(
      history.list().map((entry) => [entry.label, entry.files.map((file) => file.path)]),
    ).toEqual([
      ["Agent turn", ["b.js", "index.html"]],
      ["Moved Title", ["index.html"]],
      ["Agent turn", ["index.html"]],
    ]);
    for (const expected of ["C", "B", "A"]) {
      const newest = [...history.list()].reverse().find((entry) => !entry.undoes && !entry.undone);
      expect(await history.undo(newest!.id, { who: you })).toMatchObject({ ok: true });
      expect(read("index.html")).toBe(expected);
    }
  });

  it("ends a window idle past its lifetime, so later writes are the outside's", async () => {
    const { history, write } = await project({ "index.html": "a" }, { now });
    const window = await history.beginWindow(agent, "Short", { idleMs: 40 });
    write("index.html", "b");
    await vi.waitFor(() => expect(history.list()).toHaveLength(1));
    write("index.html", "c");
    await history.flush();
    expect(history.list().map((entry) => [entry.label, entry.who.kind])).toEqual([
      ["Short", "agent"],
      ["Changed outside the app", "outside"],
    ]);
    expect((await window.close())?.id).toBe(window.id);
  });

  it("files what changed while closed to an earlier turn by file times alone", async () => {
    const { history, write, projectDir, historyRoot } = await project(
      { "a.html": "a1", "b.html": "b1" },
      { now },
    );
    await history.close();
    const lastWriteFileTime = Date.now();
    const closedWindow = {
      ...{ id: "turn-1", who: agent, label: "Turn", startedAt: 1, lastWriteAt: now() },
      ...{ lastWriteFileTime, idleMs: 400 },
    };
    write("a.html", "a2");
    write("b.html", "b2");
    const late = (lastWriteFileTime + 1500) / 1000;
    utimesSync(join(projectDir, "b.html"), late, late);
    const reopened = await openProjectHistory({ projectDir, historyRoot, now, closedWindow });
    cleanup.push(() => reopened.close());
    expect(reopened.list().map((entry) => [entry.who.kind, entry.files[0]?.path])).toEqual([
      ["agent", "a.html"],
      ["outside", "b.html"],
    ]);
  });

  it("files a removal made while closed to the reopened turn it came within", async () => {
    const { history, projectDir, historyRoot } = await project(
      { "a.html": "a1", "b.html": "b1" },
      { now },
    );
    await history.close();
    const closedWindow = {
      ...{ id: "turn-1", who: agent, label: "Turn", startedAt: 1, lastWriteAt: now() },
      ...{ lastWriteFileTime: Date.now(), idleMs: 60_000 },
    };
    rmSync(join(projectDir, "b.html"));
    const reopened = await openProjectHistory({ projectDir, historyRoot, now, closedWindow });
    cleanup.push(() => reopened.close());
    expect(reopened.list().map((entry) => [entry.who.kind, entry.files[0]?.path])).toEqual([
      ["agent", "b.html"],
    ]);
  });

  it("keeps a same-size rewrite made within one 2 s FAT time step", async () => {
    fat.held = Math.floor(Date.now() / 2000) * 2000;
    const { history, write } = await project({ "a.html": "aa" }, { now });
    const window = await history.beginWindow(agent, "Turn");
    write("a.html", "bb");
    await history.claim(you, "scan", []);
    write("a.html", "cc");
    const entry = await window.close();
    expect(history.peek(entry!.id)?.["a.html"]).toBe(hashOfVersion(fileContentVersion("cc")));
  });
});
