// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { open as openFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fileContentVersion, hashOfVersion } from "../helpers/fileVersion";
import { SETTLE_MS } from "./blobStore";
import type { HistoryWho } from "./historyLog";
import { openProjectHistory, type ProjectHistory } from "./projectHistory";

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

async function project(options = {}) {
  const projectDir = tempDir("hf-history-project-");
  const historyRoot = tempDir("hf-history-root-");
  writeFileSync(join(projectDir, "index.html"), "<h1>Hello</h1>");
  const history = await openProjectHistory({ projectDir, historyRoot, ...options });
  cleanup.push(() => history.close());
  const write = (content: string) => writeFileSync(join(projectDir, "index.html"), content);
  const read = () => readFileSync(join(projectDir, "index.html"), "utf-8");
  return { projectDir, history, write, read, index: join(projectDir, "index.html") };
}

describe("a file an outside save has emptied but not yet written", () => {
  const sha = (text: string) => hashOfVersion(fileContentVersion(text));
  const kept = (history: ProjectHistory) =>
    history.list().map((entry) => [entry.label, entry.files.map((file) => file.after)]);
  const outside = "Changed outside the app";

  /** A project whose clock stops at index.html's last change, as a sweep right after that change sees it. */
  async function saving() {
    let clock: number | undefined;
    const opened = await project({ now: () => clock ?? Date.now() });
    const changedNow = () => {
      const { mtimeMs, ctimeMs } = statSync(opened.index);
      clock = Math.max(mtimeMs, ctimeMs);
    };
    const later = (ms: number) => (clock = (clock ?? Date.now()) + ms);
    return { ...opened, changedNow, later };
  }

  it("files no empty version for a save paused between emptying the file and writing it", async () => {
    const { history, index, read, changedNow } = await saving();
    const save = await openFile(index, "w");
    changedNow();
    await history.flush();
    await history.claim(you, "Another file", []);
    await save.write("<h1>Saved</h1>");
    await save.close();
    await history.claim(you, "Edited", ["index.html"]);
    expect(kept(history)).toEqual([["Edited", [sha("<h1>Saved</h1>")]]]);
    await history.step("back", you);
    expect(read()).toBe("<h1>Hello</h1>");
  });

  it("files a save paused after its first bytes as it stands: only an empty file waits", async () => {
    const { history, index, changedNow } = await saving();
    const save = await openFile(index, "w");
    await save.write("<h1>Sa");
    changedNow();
    await history.flush();
    await save.write("ved</h1>");
    await save.close();
    await history.claim(you, "Edited", ["index.html"]);
    expect(kept(history)).toEqual([
      [outside, [sha("<h1>Sa")]],
      ["Edited", [sha("<h1>Saved</h1>")]],
    ]);
  });

  it("records a file emptied for good by the next sweep, once it has been quiet a moment", async () => {
    const { history, index, changedNow, later } = await saving();
    await (await openFile(index, "w")).close();
    changedNow();
    await history.flush();
    expect(kept(history)).toEqual([]);
    later(SETTLE_MS);
    await vi.waitFor(
      () => expect(history.next("back", you)?.files.map((file) => file.after)).toEqual([sha("")]),
      { timeout: 5000, interval: 20 },
    );
  });

  it("records an empty save the moment a claim names it", async () => {
    const { history, write, changedNow } = await saving();
    write("");
    changedNow();
    await history.claim(you, "Cleared", ["index.html"]);
    expect(kept(history)).toEqual([["Cleared", [sha("")]]]);
  });

  it("files a window's empty write in that window, ended at once by close or flush", async () => {
    const { history, write, changedNow } = await saving();
    const closed = await history.beginWindow(agent, "Closed turn");
    write("");
    changedNow();
    await closed.close();
    write("<h1>Two</h1>");
    await history.claim(you, "Typed", ["index.html"]);
    await history.beginWindow(agent, "Flushed turn");
    write("");
    changedNow();
    await history.flush();
    expect(kept(history)).toEqual([
      ["Closed turn", [sha("")]],
      ["Typed", [sha("<h1>Two</h1>")]],
      ["Flushed turn", [sha("")]],
    ]);
  });

  it("still sees a file emptied just before an undo, and refuses to write over it", async () => {
    const { history, write, read, changedNow } = await saving();
    const window = await history.beginWindow(you, "Your edit");
    write("v2");
    const mine = await window.close();
    if (!mine) throw new Error("the window recorded nothing");
    write("");
    changedNow();
    expect((await history.undo(mine.id, { who: you })).ok).toBe(false);
    expect(read()).toBe("");
  });
});
