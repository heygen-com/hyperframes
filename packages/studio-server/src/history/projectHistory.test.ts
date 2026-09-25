// @vitest-environment node
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fileContentVersion } from "../helpers/fileVersion";
import { HistoryBusyError } from "./ownerLock";
import { openProjectHistory, type ProjectHistory } from "./projectHistory";
import { START, type HistoryWho } from "./historyLog";

const you: HistoryWho = { kind: "person", name: "You" };
const pause = (ms: number) => new Promise((settle) => setTimeout(settle, ms));
const agent: HistoryWho = { kind: "agent", name: "Agent" };
const cleanup: Array<() => unknown> = [];

afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

const inside = (dir: string, path: string) => readFileSync(join(dir, path), "utf-8");

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function open(projectDir: string, historyRoot: string, options = {}) {
  const history = await openProjectHistory({ projectDir, historyRoot, ...options });
  cleanup.push(() => history.close());
  return history;
}

async function project(files: Record<string, string | Buffer>, options = {}) {
  const projectDir = tempDir("hf-history-project-");
  const historyRoot = tempDir("hf-history-root-");
  const write = (path: string, content: string | Buffer) => {
    mkdirSync(dirname(join(projectDir, path)), { recursive: true });
    writeFileSync(join(projectDir, path), content);
  };
  for (const [path, content] of Object.entries(files)) write(path, content);
  const history = await open(projectDir, historyRoot, options);
  const read = (path: string) => readFileSync(join(projectDir, path), "utf-8");
  const has = (path: string) => existsSync(join(projectDir, path));
  return { projectDir, historyRoot, history, write, read, has };
}

/** An agent turn writes B, C, D; the person's drag claims C (written over B) and is held when the turn closes. */
async function dragDuringTurn(
  history: ProjectHistory,
  write: (path: string, content: string) => void,
) {
  const window = await history.beginWindow(agent, "Agent turn");
  write("index.html", "B");
  await history.claim(you, "sweep", []);
  write("index.html", "C");
  await history.claim(you, "Dragged Title", ["index.html"], {
    coalesceKey: "drag",
    idleMs: 60_000,
    overwrote: { "index.html": fileContentVersion("B") },
  });
  write("index.html", "D");
  await window.close();
}

/** Runs `writes` inside a window of `who`'s and returns the entry it became. */
async function change(history: ProjectHistory, who: HistoryWho, label: string, writes: () => void) {
  const window = await history.beginWindow(who, label);
  writes();
  const entry = await window.close();
  if (!entry) throw new Error("the window recorded nothing");
  return entry;
}

describe("openProjectHistory", () => {
  it("records a write nobody announced as one outside entry, and undo puts the bytes back as a new entry", async () => {
    const { history, write, read, projectDir } = await project(
      { "index.html": "<h1>Hello</h1>", "assets/logo.png": Buffer.from([1, 2, 3]) },
      { quietMs: 30 },
    );
    write("index.html", "<h1>Bye</h1>");
    write("assets/logo.png", Buffer.from([9, 9]));
    history.noteChange("index.html");
    history.noteChange(join(projectDir, "assets/logo.png"));

    await vi.waitFor(() => expect(history.list()).toHaveLength(1));
    const [outside] = history.list();
    expect(outside).toMatchObject({ who: { kind: "outside" }, label: "Changed outside the app" });
    expect(outside!.files.map((file) => file.path)).toEqual(["assets/logo.png", "index.html"]);

    const undone = await history.undo(outside!.id, { who: you });
    expect(undone).toMatchObject({ ok: true, entry: { label: "Undid: Changed outside the app" } });
    expect(read("index.html")).toBe("<h1>Hello</h1>");
    expect([...readFileSync(join(projectDir, "assets/logo.png"))]).toEqual([1, 2, 3]);
    expect(history.list().find((entry) => entry.id === outside!.id)?.undone).toBe(true);

    expect(await history.step("forward", you)).toMatchObject({
      entry: { label: "Redid: Changed outside the app" },
    });
    expect(read("index.html")).toBe("<h1>Bye</h1>");
    await history.step("back", you);
    expect(read("index.html")).toBe("<h1>Hello</h1>");
    expect(history.list()).toHaveLength(4);
  });

  it("gives a window's writes to its writer, and undoes a create, a delete and Studio's manifest", async () => {
    const { history, write, read, has, projectDir } = await project({
      "index.html": "<h1>Hello</h1>",
      "old.css": "h1 {}",
    });
    expect(await (await history.beginWindow(agent, "nothing")).close()).toBeNull();

    const entry = await change(history, agent, "add Flash Through White", () => {
      write("index.html", "<h1>Flash</h1>");
      write("new.html", "<p>new</p>");
      write(".hyperframes/studio-manual-edits.json", "{}");
      rmSync(join(projectDir, "old.css"));
    });
    expect(entry.who).toEqual(agent);
    expect(entry.files.map((file) => [file.path, !!file.before, !!file.after])).toEqual([
      [".hyperframes/studio-manual-edits.json", false, true],
      ["index.html", true, true],
      ["new.html", false, true],
      ["old.css", true, false],
    ]);

    expect((await history.undo(entry.id, { who: you })).ok).toBe(true);
    expect(read("index.html")).toBe("<h1>Hello</h1>");
    expect(read("old.css")).toBe("h1 {}");
    expect(has("new.html")).toBe(false);
    expect(has(".hyperframes/studio-manual-edits.json")).toBe(false);
  });

  it("names a file changed since and the newer change, then takes 'undo just this' when asked", async () => {
    const { history, write, read } = await project({ "index.html": "A", "notes.txt": "n1" });
    const first = await change(history, you, "Title", () => {
      write("index.html", "B");
      write("notes.txt", "n2");
    });
    const newer = await change(history, agent, "Retitle", () => write("index.html", "C"));

    expect(await history.undo(first.id, { who: you })).toEqual({
      ok: false,
      conflict: { files: ["index.html"], newer: [newer.id] },
    });
    expect([read("index.html"), read("notes.txt")]).toEqual(["C", "n2"]);

    expect((await history.undo(first.id, { who: you, mode: "just-this" })).ok).toBe(true);
    expect([read("index.html"), read("notes.txt")]).toEqual(["A", "n1"]);
  });

  it("'go back to before this' reverts the change and everything after it as one entry", async () => {
    const { history, write, read, has } = await project({ "index.html": "A" });
    const first = await change(history, you, "Title", () => write("index.html", "B"));
    await change(history, agent, "Extra", () => {
      write("index.html", "C");
      write("extra.txt", "x");
    });

    const back = await history.undo(first.id, { who: you, mode: "back-to-before" });
    expect(back).toMatchObject({ ok: true, entry: { restoredTo: START } });
    expect(read("index.html")).toBe("A");
    expect(has("extra.txt")).toBe(false);
  });

  it("restores any point, and peek reads a point's bytes without writing", async () => {
    const { history, write, read } = await project({ "index.html": "v1" });
    const second = await change(history, you, "Second", () => write("index.html", "v2"));
    await change(history, you, "Third", () => write("index.html", "v3"));

    const at = (point: string) => history.peek(point)!["index.html"]!;
    expect((await history.readBlob(at(second.id))).toString()).toBe("v2");
    expect((await history.readBlob(at(START))).toString()).toBe("v1");
    expect(read("index.html")).toBe("v3");

    const restored = await history.restore(second.id, you);
    expect(restored).toMatchObject({ label: "Restored: Second", restoredTo: second.id });
    expect(read("index.html")).toBe("v2");
  });

  it("checks out an entry's before and after into a folder, leaving the project and its history alone", async () => {
    const { history, write, read } = await project({ "index.html": "v1", "assets/a.txt": "a" });
    const second = await change(history, you, "Second", () => {
      write("index.html", "v2");
      write("extra/b.txt", "b");
    });
    await change(history, you, "Third", () => write("index.html", "v3"));

    const before = tempDir("hf-history-checkout-");
    const after = tempDir("hf-history-checkout-");
    await history.checkout(second.id, "before", before);
    await history.checkout(second.id, "after", after);
    expect([inside(before, "index.html"), inside(before, "assets/a.txt")]).toEqual(["v1", "a"]);
    expect(existsSync(join(before, "extra/b.txt"))).toBe(false);
    expect([inside(after, "index.html"), inside(after, "extra/b.txt")]).toEqual(["v2", "b"]);
    const beforeThird = join(tempDir("hf-history-checkout-"), "made-by-checkout");
    await history.checkout(history.list()[1]!.id, "before", beforeThird);
    expect([inside(beforeThird, "index.html"), inside(beforeThird, "extra/b.txt")]).toEqual([
      "v2",
      "b",
    ]);

    expect(read("index.html")).toBe("v3");
    expect(history.list()).toHaveLength(2);
    await expect(history.checkout(second.id, "after", after)).rejects.toThrow("empty folder");
    await expect(
      history.checkout("gone", "after", tempDir("hf-history-checkout-")),
    ).rejects.toThrow("no longer kept");
  });

  it("checks out each entry's own change even when entries were logged out of write order", async () => {
    const { history, write } = await project({ "index.html": "A" });
    const drag = (overwrote: string) =>
      history.claim(you, "Dragged Title", ["index.html"], {
        coalesceKey: "drag",
        idleMs: 60_000,
        overwrote: { "index.html": fileContentVersion(overwrote) },
      });
    write("index.html", "B");
    await drag("A");
    const window = await history.beginWindow(agent, "Agent turn");
    write("index.html", "C");
    await window.close();
    write("index.html", "D");
    await drag("C");
    await history.flush();

    const sides = async (id: string) => {
      const pair: string[] = [];
      for (const side of ["before", "after"] as const) {
        const dir = tempDir("hf-history-checkout-");
        await history.checkout(id, side, dir);
        pair.push(inside(dir, "index.html"));
      }
      return pair.join(">");
    };
    const changes = [];
    for (const entry of history.list()) changes.push(`${entry.label}: ${await sides(entry.id)}`);
    expect(changes.sort()).toEqual(["Agent turn: B>C", "Dragged Title: A>B", "Dragged Title: C>D"]);
  });

  it("logs the outside change that turned a file into a folder before the agent turn that followed", async () => {
    const { history, projectDir, write } = await project({ a: "file", "r.txt": "R0" });
    rmSync(join(projectDir, "a"));
    mkdirSync(join(projectDir, "a"));
    writeFileSync(join(projectDir, "a", "b.txt"), "b0");
    const window = await history.beginWindow(agent, "Agent turn");
    writeFileSync(join(projectDir, "a", "b.txt"), "b1");
    const turn = await window.close();
    write("r.txt", "R1");
    await history.flush();
    expect(history.list().map((entry) => entry.label)).toEqual([
      "Changed outside the app",
      "Agent turn",
      "Changed outside the app",
    ]);

    for (const [side, content] of [
      ["before", "b0"],
      ["after", "b1"],
    ] as const) {
      const dir = tempDir("hf-history-checkout-");
      await history.checkout(turn!.id, side, dir);
      expect([inside(dir, "a/b.txt"), inside(dir, "r.txt")]).toEqual([content, "R0"]);
    }
  });

  it("refuses a checkout folder inside the project, however it is reached", async () => {
    const { history, write, projectDir, has } = await project({ "index.html": "v1" });
    const entry = await change(history, you, "Second", () => write("index.html", "v2"));
    const alias = join(tempDir("hf-history-alias-"), "alias");
    symlinkSync(projectDir, alias);

    for (const dir of [join(projectDir, "archive"), join(alias, "archive"), projectDir])
      await expect(history.checkout(entry.id, "after", dir)).rejects.toThrow("outside the project");
    expect(has("archive")).toBe(false);
    await history.flush();
    expect(history.list()).toHaveLength(1);
  });

  it("leaves the folder empty when a checkout fails partway, so it can be retried", async () => {
    const { history, write, historyRoot } = await project({ "a.txt": "a", "b.txt": "b" });
    const entry = await change(history, you, "Edit", () => write("b.txt", "b2"));
    const lost = history.peek(entry.id)!["b.txt"]!;
    const blob = readdirSync(historyRoot, { recursive: true }).find((path) =>
      String(path).endsWith(lost),
    );
    rmSync(join(historyRoot, String(blob)));

    const dir = tempDir("hf-history-checkout-");
    await expect(history.checkout(entry.id, "after", dir)).rejects.toThrow();
    expect(readdirSync(dir)).toEqual([]);
  });

  it("keeps the history across a move and a reopen, and a copy of the folder starts its own", async () => {
    const { history, write, projectDir, historyRoot } = await project({ "index.html": "v1" });
    write("index.html", "v2");
    await history.flush();
    const moved = `${projectDir}-moved`;
    renameSync(projectDir, moved);
    cleanup.push(() => rmSync(moved, { recursive: true, force: true }));
    await history.flush();
    expect(history.list(), "a moved folder is not every file deleted").toHaveLength(1);
    await history.close();
    writeFileSync(join(moved, "index.html"), "v3");

    const reopened = await open(moved, historyRoot);
    expect(reopened.projectId).toBe(history.projectId);
    expect(reopened.list()).toHaveLength(2);
    await reopened.step("back", you);
    expect(readFileSync(join(moved, "index.html"), "utf-8")).toBe("v2");

    const copy = tempDir("hf-history-copy-");
    cpSync(moved, copy, { recursive: true });
    const copied = await open(copy, historyRoot);
    expect(copied.projectId).not.toBe(history.projectId);
    expect(copied.list()).toEqual([]);
  });

  it("lets one process at a time hold a project's history, so a second opener cannot fork its log", async () => {
    const { history, projectDir, historyRoot } = await project({ "index.html": "v1" });
    await expect(openProjectHistory({ projectDir, historyRoot, ownerWaitMs: 0 })).rejects.toThrow(
      `pid ${process.pid}`,
    );
    const waiting = open(projectDir, historyRoot, { ownerWaitMs: 5000 });
    await history.close();
    expect((await waiting).projectId).toBe(history.projectId);
  });

  it("files what changed while closed to a window begun on an earlier open, under its id", async () => {
    const { history, write, projectDir, historyRoot } = await project({ "index.html": "v1" });
    await history.close();
    write("index.html", "v2");
    const closedWindow = {
      id: "turn-1",
      who: agent,
      label: "Bigger title",
      startedAt: 1,
      lastWriteAt: Date.now(),
      idleMs: 60_000,
    };

    const reopened = await open(projectDir, historyRoot, { closedWindow });
    expect(reopened.list()).toMatchObject([{ id: "turn-1", who: agent, label: "Bigger title" }]);
    await reopened.close();

    write("index.html", "v3");
    const again = await open(projectDir, historyRoot, { closedWindow });
    expect(
      again.list().map((entry) => entry.who),
      "an id already kept is not reused",
    ).toEqual([agent, { kind: "outside", name: "Outside" }]);
  });

  it("files to a closed window only the writes before its idle limit ran out, counting from each write", async () => {
    const { history, write, projectDir, historyRoot } = await project({
      "a.html": "a1",
      "b.html": "b1",
      "c.html": "c1",
    });
    await history.close();
    // A file's change time is its ctime, which only the clock sets: the writes are spaced in real time.
    const lastWriteAt = Date.now();
    await pause(300);
    write("a.html", "2");
    await pause(300);
    write("b.html", "2"); // 600 ms after the window's last write, but 300 ms after a.html: still the window's
    await pause(700);
    write("c.html", "2"); // 700 ms without a write: the window had ended
    const closedWindow = { id: "turn-1", who: agent, label: "Turn", startedAt: 1, lastWriteAt };

    const reopened = await open(projectDir, historyRoot, {
      closedWindow: { ...closedWindow, idleMs: 400 },
    });
    const [turn, outside] = reopened.list();
    expect([turn, outside].map((entry) => entry?.files.map((file) => file.path))).toEqual([
      ["a.html", "b.html"],
      ["c.html"],
    ]);
    expect(outside?.who.kind).toBe("outside");
    const onDisk = readFileSync(join(historyRoot, reopened.projectId, "log.jsonl"), "utf-8");
    expect(Object.keys(JSON.parse(onDisk.trim().split("\n")[1]!).entry).sort()).toEqual([
      "endedAt",
      "files",
      "id",
      "label",
      "startedAt",
      "who",
    ]);
  });

  it("times each write by its file: oldest first, a copy that keeps an old mtime as now, a removal as now", async () => {
    const { history, write, projectDir, historyRoot } = await project({
      "a.html": "a1",
      "b.html": "b1",
      "c.html": "c1",
    });
    await history.close();
    const writeAt = (path: string, text: string, at: number) => {
      write(path, text);
      utimesSync(join(projectDir, path), at / 1000, at / 1000);
    };
    const turn = (id: string, lastWriteAt: number) => ({
      closedWindow: { id, who: agent, label: "Turn", startedAt: 1, lastWriteAt, idleMs: 400 },
    });

    // b.html comes first in time though not by name: taken in order, both are the window's.
    const first = Date.now();
    await pause(300);
    write("b.html", "b2");
    await pause(300);
    write("a.html", "a2"); // past the limit from the window's last write, so it counts only after b.html
    const lastWrite = statSync(join(projectDir, "a.html")).ctimeMs;
    const reopened = await open(projectDir, historyRoot, turn("turn-1", first));
    const [kept] = reopened.list();
    expect(kept?.files.map((file) => file.path)).toEqual(["a.html", "b.html"]);
    expect(Math.abs(kept!.endedAt - lastWrite), "ends at its last write").toBeLessThan(2);
    await reopened.close();

    // Long after the window's last write: an old mtime does not hide a write made now, nor does a removal.
    const stale = Date.now() - 5000;
    writeAt("a.html", "a3", stale + 100);
    rmSync(join(projectDir, "c.html"));
    const again = await open(projectDir, historyRoot, turn("turn-2", stale));
    expect(again.list().at(-1)).toMatchObject({
      who: { kind: "outside" },
      files: [{ path: "a.html" }, { path: "c.html" }],
    });
  });

  it("logs an agent window past its idle limit before a later Studio edit that claims its file", async () => {
    const { history, write } = await project({ "index.html": "A" });
    // The idle timer stays asleep (a laptop lid closed) while real time passes the limit.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const window = await history.beginWindow(agent, "Retitle", { idleMs: 50 });
      write("index.html", "A2");
      await history.claim(you, "Nothing", []); // a claim scans first: the agent's write is seen
      for (const until = Date.now() + 150; Date.now() < until; );
      write("index.html", "A3");
      await history.claim(you, "Dragged Title", ["index.html"], {
        overwrote: { "index.html": fileContentVersion("A2") },
      });
      await window.close();
    } finally {
      vi.useRealTimers();
    }

    expect(history.list().map((entry) => entry.label)).toEqual(["Retitle", "Dragged Title"]);
  });

  it("counts a file time ahead of the scan as the scan's time, so it does not end an open turn", async () => {
    const { projectDir, history, write } = await project({ "a.js": "1", "b.js": "1" });
    const window = await history.beginWindow(agent, "Build", { idleMs: 2000 });
    write("a.js", "2");
    const ahead = Date.now() + 60_000;
    utimesSync(join(projectDir, "a.js"), ahead / 1000, ahead / 1000);
    await history.claim(you, "Nothing", []);
    write("b.js", "2");

    expect((await window.close())?.files.map((file) => file.path)).toEqual(["a.js", "b.js"]);
  });

  it("ends every entry at or after the one logged before it, though a window ends at its last write", async () => {
    const { history, write } = await project({ "index.html": "A", "notes.html": "N" });
    const window = await history.beginWindow(agent, "Retitle");
    write("index.html", "A2");
    write("notes.html", "N2");
    await new Promise((settle) => setTimeout(settle, 20));
    await history.claim(you, "Edited notes", ["notes.html"]);
    await window.close();

    const ends = history.list().map((entry) => entry.endedAt);
    expect(ends).toEqual([...ends].sort((a, b) => a - b));
  });

  it("takes over the lock of an owner that died without closing", async () => {
    const { history, projectDir, historyRoot } = await project({ "index.html": "v1" });
    await history.close();
    const dead = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"]);
    writeFileSync(join(historyRoot, history.projectId, "owner.pid"), dead.stdout);
    expect((await open(projectDir, historyRoot, { ownerWaitMs: 0 })).projectId).toBe(
      history.projectId,
    );
  });

  it("never removes a lock another process holds: not on close, not while another evicts a dead owner", async () => {
    const { history, projectDir, historyRoot } = await project({ "index.html": "v1" });
    const lock = join(historyRoot, history.projectId, "owner.pid");
    const other = String(process.ppid); // a live process that is not this one
    writeFileSync(lock, other);
    await history.close();
    expect(readFileSync(lock, "utf-8"), "a close leaves a later owner's lock").toBe(other);

    const dead = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"]);
    writeFileSync(lock, dead.stdout);
    writeFileSync(`${lock}.evict`, other);
    await expect(
      openProjectHistory({ projectDir, historyRoot, ownerWaitMs: 200 }),
      "only the evictor that holds the evict lock removes a dead owner",
    ).rejects.toThrow(HistoryBusyError);

    writeFileSync(`${lock}.evict`, dead.stdout);
    expect((await open(projectDir, historyRoot, { ownerWaitMs: 200 })).projectId).toBe(
      history.projectId,
    );
  });

  it("fails an open whose lock cannot be read, instead of retrying it forever", async () => {
    const { history, projectDir, historyRoot } = await project({ "index.html": "v1" });
    await history.close();
    mkdirSync(join(historyRoot, history.projectId, "owner.pid"));
    await expect(openProjectHistory({ projectDir, historyRoot, ownerWaitMs: 0 })).rejects.toThrow(
      /EISDIR/,
    );
  });

  it("takes over a lock file that holds no pid", async () => {
    const { history, projectDir, historyRoot } = await project({ "index.html": "v1" });
    await history.close();
    writeFileSync(join(historyRoot, history.projectId, "owner.pid"), "");
    expect((await open(projectDir, historyRoot, { ownerWaitMs: 0 })).projectId).toBe(
      history.projectId,
    );
  });

  it("rewrites a history folder removed while open, so a reopen still has the change", async () => {
    const { history, write, projectDir, historyRoot } = await project({ "index.html": "v1" });
    const earlier = await change(history, you, "Second", () => write("index.html", "v2"));
    rmSync(historyRoot, { recursive: true, force: true });
    const entry = await change(history, you, "Third", () => write("index.html", "v3"));
    await history.close();

    const reopened = await open(projectDir, historyRoot);
    expect(reopened.list().map((kept) => kept.id)).toEqual([earlier.id, entry.id]);
    const hash = reopened.peek(entry.id)!["index.html"]!;
    expect((await reopened.readBlob(hash)).toString()).toBe("v3");
  });

  it("reports a damaged log line and keeps every line around it", async () => {
    const { history, write, projectDir, historyRoot } = await project({ "index.html": "v1" });
    await change(history, you, "Second", () => write("index.html", "v2"));
    await change(history, you, "Third", () => write("index.html", "v3"));
    await history.close();
    const logFile = join(historyRoot, history.projectId, "log.jsonl");
    const lines = readFileSync(logFile, "utf-8").split("\n");
    writeFileSync(logFile, [lines[0], "{not json", ...lines.slice(1)].join("\n"));

    const onError = vi.fn();
    const reopened = await open(projectDir, historyRoot, { onError });
    expect(onError).toHaveBeenCalledOnce();
    expect(String(onError.mock.calls[0]![0])).toMatch(/line 2 /);
    expect(reopened.list().map((kept) => kept.label)).toEqual(["Second", "Third"]);
  });

  it("mints its own id when the project's history-id is anything else, so a project cannot pick where history is written", async () => {
    const projectDir = tempDir("hf-history-project-");
    const historyRoot = tempDir("hf-history-root-");
    const victim = tempDir("hf-history-victim-");
    writeFileSync(join(projectDir, "index.html"), "v1");
    writeFileSync(join(victim, "project.json"), '{"precious":true}');
    mkdirSync(join(projectDir, ".hyperframes"));
    writeFileSync(join(projectDir, ".hyperframes", "history-id"), relative(historyRoot, victim));

    const history = await open(projectDir, historyRoot);
    expect(history.projectId).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
    expect(readdirSync(victim)).toEqual(["project.json"]);
    expect(readFileSync(join(victim, "project.json"), "utf-8")).toBe('{"precious":true}');
    const idFile = join(projectDir, ".hyperframes", "history-id");
    expect(readFileSync(idFile, "utf-8").trim()).toBe(history.projectId);
  });

  it("commits a window that is never closed when the history flushes, so Cmd+Z still reaches its writes", async () => {
    const { history, write, read } = await project({ "index.html": "a" });
    await history.beginWindow(agent, "never closed");
    write("index.html", "b, an outside edit");
    await history.flush();
    expect(history.list()).toHaveLength(1);
    expect(await history.step("back", you)).toMatchObject({
      ok: true,
      entry: { label: "Undid: never closed" },
    });
    expect(read("index.html")).toBe("a");
  });

  it("ends a window idle past its lifetime, so later writes are the outside's", async () => {
    const { history, write } = await project({ "index.html": "a" });
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

  it("keeps the history of a small edit in a project larger than its budget", async () => {
    const { history, write } = await project(
      { "media.bin": Buffer.alloc(4096, 1), "index.html": "a" },
      { budgetBytes: 2048 },
    );
    await change(history, you, "Title", () => write("index.html", "b"));
    expect(history.list()).toHaveLength(1);
  });

  it("past its budget folds the oldest entries away and deletes their bytes, but never past a pin", async () => {
    const { history, write, read } = await project(
      { "index.html": "a".repeat(40) },
      { budgetBytes: 50 },
    );
    const pinned = await change(history, you, "B", () => write("index.html", "b".repeat(40)));
    history.pin(pinned.id, true);
    await change(history, you, "C", () => write("index.html", "c".repeat(40)));
    expect(history.list()).toHaveLength(2);

    history.pin(pinned.id, false);
    const last = await change(history, you, "D", () => write("index.html", "d".repeat(40)));
    expect(history.list().map((entry) => entry.id)).toEqual([last.id]);
    expect(history.peek(pinned.id)).toBeNull();
    await expect(history.readBlob(history.peek(START)!["index.html"]!)).resolves.toEqual(
      Buffer.from("c".repeat(40)),
    );
    expect((await history.undo(last.id, { who: you })).ok).toBe(true);
    expect(read("index.html")).toBe("c".repeat(40));
  });
});

describe("claim: a writer that records after writing", () => {
  it("files the claimed paths' writes as the claimer's entry; other outside writes stay outside, logged first", async () => {
    const { history, write, read } = await project({ "index.html": "A", "notes.md": "n" });
    write("index.html", "B");
    write("notes.md", "agent notes");
    const claimed = await history.claim(you, "Moved Title", ["index.html"]);
    expect(history.list().map((entry) => [entry.who.kind, entry.files[0]!.path])).toEqual([
      ["outside", "notes.md"],
      ["person", "index.html"],
    ]);
    expect(history.list()[1]).toMatchObject({ id: claimed!.id, label: "Moved Title" });
    await history.undo(claimed!.id, { who: you });
    expect(read("index.html")).toBe("A");
    expect(await history.claim(you, "Nothing", ["index.html"]), "nothing left to claim").toBeNull();
  });

  it("merges claims with one coalesceKey into one entry, and Cmd+Z right after undoes all of it", async () => {
    const { history, write, read } = await project({ "index.html": "A" });
    write("index.html", "B");
    const first = await history.claim(you, "Dragged Title", ["./index.html"], {
      coalesceKey: "drag",
    });
    write("index.html", "C");
    const second = await history.claim(you, "Dragged Title", ["index.html"], {
      coalesceKey: "drag",
    });
    expect(second!.id).toBe(first!.id);
    expect(history.list(), "still open for the next write of the drag").toEqual([]);

    expect(await history.step("back", you)).toMatchObject({
      ok: true,
      entry: { label: "Undid: Dragged Title" },
    });
    expect(read("index.html")).toBe("A");
    expect(history.list()[0]).toMatchObject({ id: first!.id, files: [{ path: "index.html" }] });
  });

  it("a coalescing claim whose writes net to nothing returns null and records nothing", async () => {
    const { history, write } = await project({ "index.html": "A" });
    write("index.html", "B");
    expect(
      await history.claim(you, "Dragged Title", ["index.html"], { coalesceKey: "drag" }),
    ).not.toBeNull();
    write("index.html", "A");
    expect(
      await history.claim(you, "Dragged Title", ["index.html"], { coalesceKey: "drag" }),
    ).toBeNull();
    await history.flush();
    expect(history.list()).toEqual([]);
  });

  it("an agent's write seconds before Studio's stays the agent's, cut at the version Studio overwrote", async () => {
    const { history, write, read } = await project({ "index.html": "A" });
    write("index.html", "B");
    await history.claim(you, "sweep", []);
    write("index.html", "C");
    await history.claim(you, "Moved Title", ["index.html"], {
      overwrote: { "index.html": fileContentVersion("B") },
    });
    expect(history.list().map((entry) => [entry.who.kind, entry.label])).toEqual([
      ["outside", "Changed outside the app"],
      ["person", "Moved Title"],
    ]);
    await history.step("back", you);
    expect(read("index.html"), "Cmd+Z undoes only the person's edit").toBe("B");
    await history.step("back", you);
    expect(read("index.html")).toBe("A");
  });

  it("an agent's turn cut by Studio's edit becomes an entry before it and one after, so Cmd+Z walks back in order", async () => {
    const { history, write, read } = await project({ "index.html": "A" });
    const window = await history.beginWindow(agent, "Agent turn");
    write("index.html", "B");
    await history.claim(you, "sweep", []);
    write("index.html", "C");
    await history.claim(you, "Moved Title", ["index.html"], {
      overwrote: { "index.html": fileContentVersion("B") },
    });
    write("index.html", "D");
    expect(await window.close(), "the window still returns the entry it became").toMatchObject({
      id: window.id,
    });
    expect(history.list().map((entry) => entry.label)).toEqual([
      "Agent turn",
      "Moved Title",
      "Agent turn",
    ]);
    for (const expected of ["C", "B", "A"]) {
      expect(await history.step("back", you)).toMatchObject({ ok: true });
      expect(read("index.html")).toBe(expected);
    }
  });

  it("a cut agent turn with nothing after the cut ends as the entry it became at the cut", async () => {
    const { history, write, read } = await project({ "index.html": "A", "b.js": "1" });
    const window = await history.beginWindow(agent, "Agent turn");
    write("index.html", "B");
    await history.claim(you, "sweep", []);
    write("index.html", "C");
    write("b.js", "2");
    await history.claim(you, "Moved Title", ["index.html", "b.js"], {
      overwrote: { "index.html": fileContentVersion("B"), "b.js": fileContentVersion("1") },
    });
    write("b.js", "3");
    await history.claim(you, "Recolored", ["b.js"], {
      overwrote: { "b.js": fileContentVersion("2") },
    });
    const cutAt = history.list()[0]!;
    expect(cutAt).toMatchObject({ label: "Agent turn", who: agent });
    expect(
      await window.close(),
      "close returns the entry the window became at the cut",
    ).toMatchObject({ id: cutAt.id });
    for (const [index, b] of [
      ["C", "2"],
      ["B", "1"],
      ["A", "1"],
    ]) {
      expect(await history.step("back", you)).toMatchObject({ ok: true });
      expect([read("index.html"), read("b.js")]).toEqual([index, b]);
    }
  });

  it("a held drag across an agent's write ends at that write, so Cmd+Z walks back every step", async () => {
    const { history, write, read } = await project({ "index.html": "A" });
    const window = await history.beginWindow(agent, "Agent turn");
    const drag = (overwrote: string) =>
      history.claim(you, "Dragged Title", ["index.html"], {
        coalesceKey: "drag",
        idleMs: 60_000,
        overwrote: { "index.html": fileContentVersion(overwrote) },
      });
    // A claim under the drag's key that names no file: a scan that keeps the drag held.
    const scan = () => history.claim(you, "scan", [], { coalesceKey: "drag" });
    write("index.html", "B");
    await scan();
    write("index.html", "C");
    await drag("B");
    write("index.html", "D");
    await scan();
    write("index.html", "E");
    await drag("D");
    await history.flush();
    await window.close();
    for (const expected of ["D", "C", "B", "A"]) {
      expect(await history.step("back", you)).toMatchObject({ ok: true });
      expect(read("index.html")).toBe(expected);
    }
  });

  it("a held drag across a write made outside ends at that write too", async () => {
    const { history, write, read } = await project({ "index.html": "A" });
    const drag = (overwrote: string) =>
      history.claim(you, "Dragged Title", ["index.html"], {
        coalesceKey: "drag",
        idleMs: 60_000,
        overwrote: { "index.html": fileContentVersion(overwrote) },
      });
    write("index.html", "B");
    await drag("A");
    write("index.html", "C");
    await history.claim(you, "scan", [], { coalesceKey: "drag" });
    write("index.html", "D");
    await drag("C");
    await history.flush();
    expect(history.list().map((entry) => entry.label)).toEqual([
      "Dragged Title",
      "Changed outside the app",
      "Dragged Title",
    ]);
    for (const expected of ["C", "B", "A"]) {
      expect(await history.step("back", you)).toMatchObject({ ok: true });
      expect(read("index.html")).toBe(expected);
    }
  });

  it("a held drag across an agent turn that already closed ends at the turn too", async () => {
    const { history, write, read } = await project({ "index.html": "A" });
    const drag = (overwrote: string) =>
      history.claim(you, "Dragged Title", ["index.html"], {
        coalesceKey: "drag",
        idleMs: 60_000,
        overwrote: { "index.html": fileContentVersion(overwrote) },
      });
    write("index.html", "B");
    await drag("A");
    const window = await history.beginWindow(agent, "Agent turn");
    write("index.html", "C");
    await window.close();
    write("index.html", "D");
    await drag("C");
    await history.flush();
    for (const expected of ["C", "B", "A"]) {
      expect(await history.step("back", you)).toMatchObject({ ok: true });
      expect(read("index.html")).toBe(expected);
    }
  });

  it("a held drag ends when someone else changed a file it holds, even if its next step writes another", async () => {
    const { history, write, read } = await project({ "index.html": "A", "r.js": "1" });
    const drag = (path: string, overwrote: string) =>
      history.claim(you, "Dragged Title", [path], {
        coalesceKey: "drag",
        idleMs: 60_000,
        overwrote: { [path]: fileContentVersion(overwrote) },
      });
    write("index.html", "B");
    await drag("index.html", "A");
    const window = await history.beginWindow(agent, "Agent turn");
    write("index.html", "C");
    write("r.js", "2");
    await window.close();
    write("r.js", "3");
    await drag("r.js", "2");
    await history.flush();
    for (const expected of [
      ["C", "2"],
      ["B", "1"],
      ["A", "1"],
    ]) {
      expect(await history.step("back", you)).toMatchObject({ ok: true });
      expect([read("index.html"), read("r.js")]).toEqual(expected);
    }
  });

  it("a held drag ends when one file of its next step continues and another does not", async () => {
    const { history, write, read } = await project({ "index.html": "A", "r.js": "1" });
    const drag = (overwrote: Record<string, string>) =>
      history.claim(you, "Dragged Title", Object.keys(overwrote), {
        coalesceKey: "drag",
        idleMs: 60_000,
        overwrote: Object.fromEntries(
          Object.entries(overwrote).map(([path, text]) => [path, fileContentVersion(text)]),
        ),
      });
    write("index.html", "B");
    await drag({ "index.html": "A" });
    write("index.html", "C");
    await history.claim(you, "scan", [], { coalesceKey: "drag" });
    write("index.html", "D");
    write("r.js", "2");
    await drag({ "index.html": "C", "r.js": "1" });
    await history.flush();
    for (const expected of [
      ["C", "1"],
      ["B", "1"],
      ["A", "1"],
    ]) {
      expect(await history.step("back", you)).toMatchObject({ ok: true });
      expect([read("index.html"), read("r.js")]).toEqual(expected);
    }
  });

  it("a held claim that deleted a file ends where someone else recreated it", async () => {
    const { history, write, read, has, projectDir } = await project({ "index.html": "A" });
    const claim = (overwrote: string) =>
      history.claim(you, "Edited", ["index.html"], {
        coalesceKey: "edit",
        idleMs: 60_000,
        overwrote: { "index.html": fileContentVersion(overwrote) },
      });
    rmSync(join(projectDir, "index.html"));
    await claim("A");
    write("index.html", "X");
    await history.claim(you, "scan", [], { coalesceKey: "edit" });
    write("index.html", "Y");
    await claim("X");
    await history.flush();
    await history.step("back", you);
    expect(read("index.html")).toBe("X");
    await history.step("back", you);
    expect(has("index.html")).toBe(false);
    await history.step("back", you);
    expect(read("index.html")).toBe("A");
  });

  it("a drag stays one entry when a file it adds midway was cut from an agent's turn", async () => {
    const { history, write } = await project({ "index.html": "A", "b.js": "1" });
    const window = await history.beginWindow(agent, "Agent turn");
    write("b.js", "2");
    await history.claim(you, "scan", []);
    const drag = (paths: string[], overwrote: Record<string, string>) =>
      history.claim(you, "Dragged Title", paths, {
        coalesceKey: "drag",
        idleMs: 60_000,
        overwrote: Object.fromEntries(
          Object.entries(overwrote).map(([path, text]) => [path, fileContentVersion(text)]),
        ),
      });
    write("index.html", "B");
    await drag(["index.html"], { "index.html": "A" });
    write("index.html", "C");
    write("b.js", "3");
    await drag(["index.html", "b.js"], { "index.html": "B", "b.js": "2" });
    await history.flush();
    await window.close();
    expect(history.list().filter((entry) => entry.label === "Dragged Title")).toHaveLength(1);
  });

  it("a cut takes only the cut file's earlier part out of the turn, so undoing the turn reverts its other files", async () => {
    const { history, write, read } = await project({ "index.html": "A", "b.js": "1" });
    const window = await history.beginWindow(agent, "Agent turn");
    write("index.html", "B");
    write("b.js", "2");
    await history.claim(you, "scan", []);
    write("index.html", "C");
    await history.claim(you, "Moved Title", ["index.html"], {
      overwrote: { "index.html": fileContentVersion("B") },
    });
    write("index.html", "D");
    const turn = await window.close();
    expect(history.list()[0]!.files.map((file) => file.path)).toEqual(["index.html"]);
    expect(turn).toMatchObject({ id: window.id });
    expect(turn!.files.map((file) => file.path)).toEqual(["b.js", "index.html"]);
    expect(await history.undo(turn!.id, { who: agent })).toMatchObject({ ok: true });
    expect([read("index.html"), read("b.js")]).toEqual(["C", "1"]);
  });

  it("a drag claimed during an agent turn ends at the turn and is logged before the turn's last part", async () => {
    const { history, write, read } = await project({ "index.html": "A" });
    await dragDuringTurn(history, write);
    await history.flush();
    expect(history.list().map((entry) => entry.label)).toEqual([
      "Agent turn",
      "Dragged Title",
      "Agent turn",
    ]);
    expect(history.next("back")?.label, "the button names the step Cmd+Z takes").toBe("Agent turn");
    for (const expected of ["C", "B", "A"]) {
      expect(await history.step("back", you)).toMatchObject({ ok: true });
      expect(read("index.html")).toBe(expected);
    }
  });

  it("reopens after a drag claimed during an agent turn without inventing an outside change", async () => {
    const { history, write, projectDir, historyRoot } = await project({ "index.html": "A" });
    await dragDuringTurn(history, write);
    await history.close();

    const reopened = await open(projectDir, historyRoot);
    await reopened.flush();
    expect(reopened.list().map((entry) => entry.label)).toEqual([
      "Agent turn",
      "Dragged Title",
      "Agent turn",
    ]);
  });

  it("logs an entry with only its own fields, not its window's timer", async () => {
    const { history, write } = await project({ "index.html": "A" });
    const window = await history.beginWindow(agent, "Agent turn");
    write("index.html", "B");
    await window.close();
    expect(Object.keys(history.list()[0]!).sort()).toEqual([
      "endedAt",
      "files",
      "id",
      "label",
      "pinned",
      "startedAt",
      "undone",
      "who",
    ]);
  });

  it("takes Studio's write out of an agent's open window, and leaves the agent's own writes there", async () => {
    const { history, write } = await project({ "index.html": "A", "a.js": "1" });
    const window = await history.beginWindow(agent, "Agent turn");
    write("a.js", "2");
    write("index.html", "B");
    const claimed = await history.claim(you, "Moved Title", ["index.html"]);
    const entry = await window.close();
    expect(claimed).not.toBeNull();
    expect(entry?.files.map((file) => file.path)).toEqual(["a.js"]);
    expect(history.list().find((item) => item.id === claimed!.id)?.files).toMatchObject([
      { path: "index.html" },
    ]);
  });

  it("a claim under another key that takes nothing still ends the held one", async () => {
    const { history, write } = await project({ "index.html": "A" });
    write("index.html", "B");
    await history.claim(you, "Dragged Title", ["index.html"], { coalesceKey: "drag" });
    expect(
      await history.claim(you, "Nothing", ["index.html"], { coalesceKey: "other" }),
    ).toBeNull();
    expect(history.list()).toMatchObject([{ label: "Dragged Title" }]);
  });

  it("reads no blob outside its store", async () => {
    const { history } = await project({ "index.html": "A" });
    await expect(history.readBlob("../../../../../../../../etc/hostname")).rejects.toThrow(
      "not a history blob",
    );
  });

  it("a claim with another key, or its idle time, ends the coalescing claim", async () => {
    const { history, write } = await project({ "a.html": "A", "b.html": "B" });
    write("a.html", "A2");
    await history.claim(you, "Dragged A", ["a.html"], { coalesceKey: "a", idleMs: 30 });
    await vi.waitFor(() => expect(history.list()).toMatchObject([{ label: "Dragged A" }]));
    write("b.html", "B2");
    await history.claim(you, "Dragged B", ["b.html"], { coalesceKey: "b" });
    write("a.html", "A3");
    await history.claim(you, "Dragged A again", ["a.html"], { coalesceKey: "a" });
    expect(history.list().map((entry) => entry.label)).toEqual(["Dragged A", "Dragged B"]);
  });

  it("an outside write to a claimed path between the write and its claim folds into the claim (the ceiling)", async () => {
    const { history, write } = await project({ "index.html": "A" });
    write("index.html", "B");
    write("index.html", "C");
    await history.claim(you, "Moved Title", ["index.html"]);
    const [entry] = history.list();
    expect(entry).toMatchObject({ who: you, label: "Moved Title" });
    const blob = async (hash: string | null) =>
      hash ? String(await history.readBlob(hash)) : null;
    expect([await blob(entry!.files[0]!.before), await blob(entry!.files[0]!.after)]).toEqual([
      "A",
      "C",
    ]);
  });
});
