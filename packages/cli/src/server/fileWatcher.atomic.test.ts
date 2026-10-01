// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { replaceFileAtomically } from "@hyperframes/core/atomic-file";
import { openProjectHistory } from "@hyperframes/studio-server";
import { createProjectWatcher } from "./fileWatcher.js";

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function watchedProject() {
  const dir = tempDir("hf-watch-atomic-");
  const index = join(dir, "index.html");
  writeFileSync(index, "<h1>Hello</h1>");
  const watcher = createProjectWatcher(dir);
  const heard: string[] = [];
  watcher.addListener((path) => heard.push(path));
  cleanup.push(() => watcher.close());
  return { dir, index, heard };
}

// Past the watcher's 300 ms burst window, so every event of the write has been delivered.
const quiet = () => new Promise((settle) => setTimeout(settle, 600));

async function heardOnly(heard: string[], path: string) {
  await vi.waitFor(() => expect(heard).toContain(path));
  await quiet();
  expect(new Set(heard)).toEqual(new Set([path]));
}

describe("the project watcher, on a real file system", () => {
  it("hears a save only as the file it replaced, never its temp file", async () => {
    const { index, heard } = watchedProject();
    replaceFileAtomically(index, "<h1>Bye</h1>");
    await heardOnly(heard, "index.html");
  });

  it("hears a history step's write only as the file it restored, never its temp file", async () => {
    const { dir, index, heard } = watchedProject();
    const history = await openProjectHistory({
      projectDir: dir,
      historyRoot: tempDir("hf-hist-"),
      quietMs: 30,
    });
    cleanup.push(() => history.close());
    writeFileSync(index, "<h1>Bye</h1>");
    history.noteChange("index.html");
    await vi.waitFor(() => expect(history.list()).toHaveLength(1));
    await quiet();
    heard.length = 0;

    const undone = await history.undo(history.list()[0]!.id, {
      who: { kind: "person", name: "You" },
    });
    expect(undone).toMatchObject({ ok: true });
    expect(readFileSync(index, "utf-8")).toBe("<h1>Hello</h1>");
    await heardOnly(heard, "index.html");
  });
});
