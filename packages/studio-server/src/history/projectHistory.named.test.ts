// @vitest-environment node
// An undo or a restore never deletes a file that a page it leaves in the project still names.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openProjectHistory } from "./projectHistory";
import type { HistoryWho } from "./historyLog";

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

async function project(files: Record<string, string>) {
  const projectDir = tempDir("hf-history-named-");
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(projectDir, path)), { recursive: true });
    writeFileSync(join(projectDir, path), content);
  };
  for (const [path, content] of Object.entries(files)) write(path, content);
  const historyRoot = tempDir("hf-history-root-");
  const open = async () => {
    const opened = await openProjectHistory({ projectDir, historyRoot });
    cleanup.push(() => opened.close());
    return opened;
  };
  const history = await open();
  const reopen = async () => (await history.close(), open());
  const read = (path: string) => readFileSync(join(projectDir, path), "utf-8");
  const has = (path: string) => existsSync(join(projectDir, path));
  const remove = (path: string) => rmSync(join(projectDir, path));
  return { history, write, read, has, remove, reopen };
}

const SONG = '<audio id="a1" src="assets/song.mp3"></audio>';
const SCENE =
  '<template><div data-composition-id="scene"><audio id="a2" src="../assets/song.mp3"></audio></div></template>';

const NOTES_SCENE =
  '<template><div data-composition-id="notes"><a href="../assets/notes.txt">notes</a></div></template>';

type History = Awaited<ReturnType<typeof openProjectHistory>>;

/** An edit, then an upload a later page of another author's plays; Cmd+Z twice keeps the upload and undoes the edit. */
async function pastAnUploadAndBack(
  history: History,
  write: (path: string, content: string) => void,
) {
  write("index.html", "after");
  await history.claim(you, "Edited", ["index.html"]);
  write("assets/song.mp3", "mp3");
  await history.claim(you, "Uploaded", ["assets/song.mp3"]);
  write("compositions/scene.html", SCENE);
  await history.claim(agent, "Music in a scene", ["compositions/scene.html"]);
  expect(await history.step("back", you)).toMatchObject({ ok: true });
  expect(await history.step("back", you)).toMatchObject({ ok: true });
}

/** Cmd+Shift+Z twice: the edit comes back, then the kept upload's undo is redone and the upload is in effect again. */
async function redoBoth(history: History) {
  expect(await history.step("forward", you)).toMatchObject({ ok: true });
  expect(history.next("forward", you)?.label).toBe("Undid: Uploaded");
  const redo = await history.step("forward", you);
  expect(redo).toMatchObject({ ok: true, entry: { label: "Redid: Uploaded" } });
  expect(history.list().find((entry) => entry.label === "Uploaded")?.undone).toBe(false);
}

describe("undo keeps a file a page still names", () => {
  it("Cmd+Z of a drop keeps its file while a later page of the agent's still plays it", async () => {
    const { history, write, read, has } = await project({ "index.html": "<h1>Hi</h1>" });
    write("assets/song.mp3", "mp3");
    write("index.html", `<h1>Hi</h1>${SONG}`);
    await history.claim(you, "Dropped on timeline", ["assets/song.mp3", "index.html"]);
    write("compositions/scene.html", SCENE);
    await history.claim(agent, "Music in a scene", ["compositions/scene.html"]);

    expect(await history.step("back", you)).toMatchObject({ ok: true });
    expect(read("index.html")).toBe("<h1>Hi</h1>");
    expect(has("assets/song.mp3")).toBe(true);
    expect(read("compositions/scene.html")).toBe(SCENE);
  });

  it("a run's Undo keeps a file it made while a later page of the person's still plays it", async () => {
    const { history, write, has } = await project({ "index.html": "<h1>Hi</h1>" });
    write("assets/song.mp3", "mp3");
    write("index.html", `<h1>Hi</h1>${SONG}`);
    await history.claim(agent, "Made music", ["assets/song.mp3", "index.html"]);
    const [made] = history.list();
    write("compositions/scene.html", SCENE);
    await history.claim(you, "Edited in Studio", ["compositions/scene.html"]);

    expect(await history.undo(made!.id, { who: you })).toMatchObject({ ok: true });
    expect(has("assets/song.mp3")).toBe(true);
  });

  it("an undo still deletes a file it made once no page left names it", async () => {
    const { history, write, read, has } = await project({ "index.html": "<h1>Hi</h1>" });
    write("assets/song.mp3", "mp3");
    write("index.html", `<h1>Hi</h1>${SONG}`);
    await history.claim(you, "Dropped on timeline", ["assets/song.mp3", "index.html"]);

    expect(await history.step("back", you)).toMatchObject({ ok: true });
    expect(read("index.html")).toBe("<h1>Hi</h1>");
    expect(has("assets/song.mp3")).toBe(false);
  });

  // fails without the fix: the undo that kept the upload recorded no file, so no redo reached it and the upload
  // stayed undone.
  it("Cmd+Z steps past an upload it may not delete, reaches the edit before it, and redoes both", async () => {
    const { history, write, read, has } = await project({ "index.html": "before" });
    await pastAnUploadAndBack(history, write);
    expect(read("index.html")).toBe("before");
    expect(has("assets/song.mp3")).toBe(true);
    await redoBoth(history);
    expect(read("index.html")).toBe("after");
    expect(has("assets/song.mp3")).toBe(true);
  });

  it("the upload an undo kept is still redone after the project is closed and opened again", async () => {
    const { history, write, reopen } = await project({ "index.html": "before" });
    await pastAnUploadAndBack(history, write);
    await redoBoth(await reopen());
  });

  // fails without the fix: the redo kept the file a page names, but the next undo compared it against the deletion
  // that did not happen and stopped with a conflict before the earlier edit.
  it("after a redo that kept a file a page names, Cmd+Z steps past it to the edit before", async () => {
    const { history, write, read, has, remove } = await project({
      "index.html": "before",
      "assets/notes.txt": "notes",
    });
    write("index.html", "after");
    await history.claim(you, "Edited", ["index.html"]);
    remove("assets/notes.txt");
    await history.claim(you, "Deleted notes", ["assets/notes.txt"]);
    expect(await history.step("back", you)).toMatchObject({ ok: true });
    expect(read("assets/notes.txt")).toBe("notes");
    write("compositions/scene.html", NOTES_SCENE);
    await history.claim(agent, "Notes in a scene", ["compositions/scene.html"]);
    expect(await history.step("forward", you)).toMatchObject({ ok: true });
    expect(has("assets/notes.txt")).toBe(true);

    expect(await history.step("back", you)).toMatchObject({ ok: true });
    expect(await history.step("back", you)).toMatchObject({ ok: true });
    expect(read("index.html")).toBe("before");
    expect(read("assets/notes.txt")).toBe("notes");
  });

  it("an undo keeps a page another page names, and the files that page names", async () => {
    const { history, write, has } = await project({ "index.html": "<h1>Hi</h1>" });
    write("compositions/scene.html", SCENE);
    write("assets/song.mp3", "mp3");
    await history.claim(agent, "Scene with music", ["compositions/scene.html", "assets/song.mp3"]);
    const [made] = history.list();
    write("index.html", '<h1>Hi</h1><div data-composition-src="compositions/scene.html"></div>');
    await history.claim(you, "Edited in Studio", ["index.html"]);

    expect(await history.undo(made!.id, { who: you })).toMatchObject({ ok: true });
    expect(has("compositions/scene.html")).toBe(true);
    expect(has("assets/song.mp3")).toBe(true);
  });

  it("a page naming a longer file that exists does not keep the shorter one", async () => {
    const { history, write, has } = await project({
      "index.html": '<img src="assets/a.png&backup.png">',
      "assets/a.png&backup.png": "png",
    });
    write("assets/a.png", "png");
    await history.claim(you, "Uploaded", ["assets/a.png"]);

    expect(await history.step("back", you)).toMatchObject({ ok: true });
    expect(has("assets/a.png")).toBe(false);
  });
});

const NOTES =
  '<template><div data-composition-id="notes"><a href="../assets/notes.txt">n</a></div></template>';

describe("a step over files an undo kept", () => {
  /** An upload another author's page names, undone (so kept), then revised by that author. */
  async function keptThenRevised() {
    const opened = await project({ "index.html": "<h1>Hi</h1>" });
    const { history, write } = opened;
    write("assets/notes.txt", "first");
    await history.claim(you, "Uploaded", ["assets/notes.txt"]);
    write("compositions/notes.html", NOTES);
    await history.claim(agent, "Notes in a scene", ["compositions/notes.html"]);
    expect(await history.step("back", you)).toMatchObject({ ok: true });
    write("assets/notes.txt", "revised");
    await history.claim(agent, "Revised notes", ["assets/notes.txt"]);
    return opened;
  }

  // fails without the fix: the kept file skipped the conflict check, so redo put "first" back over "revised".
  it("redo of a kept upload stops at another author's later edit, and keep-later-edits keeps it", async () => {
    const { history, read } = await keptThenRevised();
    expect(await history.step("forward", you)).toMatchObject({ ok: false });
    expect(read("assets/notes.txt")).toBe("revised");
    const undid = history.list().find((entry) => entry.label === "Undid: Uploaded")!;
    expect(await history.undo(undid.id, { who: you, mode: "keep-later-edits" })).toMatchObject({
      ok: true,
    });
    expect(read("assets/notes.txt")).toBe("revised");
  });

  it("the same later edit stops the redo after the project is reopened", async () => {
    const { read, reopen } = await keptThenRevised();
    expect(await (await reopen()).step("forward", you)).toMatchObject({ ok: false });
    expect(read("assets/notes.txt")).toBe("revised");
  });

  // fails without the fix: the step back compared the deleted file against what an older redo had kept.
  it("after a later redo really deletes a kept file, Cmd+Z restores it without a conflict", async () => {
    const { history, write, read, has, remove } = await project({
      "index.html": "<h1>Hi</h1>",
      "assets/notes.txt": "notes",
    });
    remove("assets/notes.txt");
    await history.claim(you, "Deleted notes", ["assets/notes.txt"]);
    expect(await history.step("back", you)).toMatchObject({ ok: true });
    write("compositions/notes.html", NOTES);
    await history.claim(agent, "Notes in a scene", ["compositions/notes.html"]);
    expect(await history.step("forward", you)).toMatchObject({ ok: true });
    expect(has("assets/notes.txt")).toBe(true);
    expect(await history.step("back", you)).toMatchObject({ ok: true });
    write("compositions/notes.html", "<template></template>");
    await history.claim(agent, "Notes gone", ["compositions/notes.html"]);
    expect(await history.step("forward", you)).toMatchObject({ ok: true });
    expect(has("assets/notes.txt")).toBe(false);

    expect(await history.step("back", you)).toMatchObject({ ok: true });
    expect(read("assets/notes.txt")).toBe("notes");
  });

  // fails without the fix: the redo changed no file and recorded none, so Cmd+Z had nothing of the person's to step to.
  it("a person who undoes and redoes an agent's kept upload can step back over it", async () => {
    const { history, write } = await project({ "index.html": "<h1>Hi</h1>" });
    write("assets/song.mp3", "mp3");
    await history.claim(agent, "Made music", ["assets/song.mp3"]);
    const [made] = history.list();
    write("compositions/scene.html", SCENE);
    await history.claim(agent, "Music in a scene", ["compositions/scene.html"]);
    const undid = await history.undo(made!.id, { who: you });
    expect(undid).toMatchObject({ ok: true });
    expect(await history.step("forward", you)).toMatchObject({ ok: true });
    expect(history.next("back", you)?.id).toBe(made!.id);
  });

  // fails without the fix: "constructor" read the empty record's inherited value, a conflict with no newer change.
  it("undoing an edit to a file named like an object's own key is no conflict", async () => {
    const { history, write, read } = await project({ constructor: "a" });
    write("constructor", "b");
    await history.claim(you, "Edited", ["constructor"]);
    expect(await history.step("back", you)).toMatchObject({ ok: true });
    expect(read("constructor")).toBe("a");
  });
});
