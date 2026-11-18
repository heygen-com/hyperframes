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
  const history = await openProjectHistory({
    projectDir,
    historyRoot: tempDir("hf-history-root-"),
  });
  cleanup.push(() => history.close());
  const read = (path: string) => readFileSync(join(projectDir, path), "utf-8");
  const has = (path: string) => existsSync(join(projectDir, path));
  return { history, write, read, has };
}

const SONG = '<audio id="a1" src="assets/song.mp3"></audio>';
const SCENE =
  '<template><div data-composition-id="scene"><audio id="a2" src="../assets/song.mp3"></audio></div></template>';

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
});
