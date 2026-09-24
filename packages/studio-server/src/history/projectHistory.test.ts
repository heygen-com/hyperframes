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
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openProjectHistory, type ProjectHistory } from "./projectHistory";
import { START, type HistoryWho } from "./historyLog";

const you: HistoryWho = { kind: "person", name: "You" };
const agent: HistoryWho = { kind: "agent", name: "Agent" };
const cleanup: Array<() => unknown> = [];

afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

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

  it("takes over the lock of an owner that died without closing", async () => {
    const { history, projectDir, historyRoot } = await project({ "index.html": "v1" });
    await history.close();
    const dead = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"]);
    writeFileSync(join(historyRoot, history.projectId, "owner.pid"), dead.stdout);
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
  it("files the claimed paths' writes as the claimer's entry; other outside writes stay outside", async () => {
    const { history, write, read } = await project({ "index.html": "A", "notes.md": "n" });
    write("index.html", "B");
    write("notes.md", "agent notes");
    const claimed = await history.claim(you, "Moved Title", ["index.html"]);
    expect(history.list()).toMatchObject([
      { id: claimed!.id, who: you, label: "Moved Title", files: [{ path: "index.html" }] },
    ]);
    await history.flush();
    expect(history.list().map((entry) => [entry.who.kind, entry.files[0]!.path])).toEqual([
      ["person", "index.html"],
      ["outside", "notes.md"],
    ]);
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
