import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openProjectHistory, type ProjectHistory } from "./projectHistory";
import type { HistoryWho } from "./historyLog";

const agent: HistoryWho = { kind: "agent", name: "Framey" };
const MiB = 1024 ** 2;
const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A project whose `name` was already on disk, `size` bytes of 1s, when its history first opened. */
async function projectWith(name: string, size: number) {
  const projectDir = tempDir("hf-old-bytes-project-");
  const historyRoot = tempDir("hf-old-bytes-root-");
  writeFileSync(join(projectDir, "index.html"), "A");
  const file = join(projectDir, name);
  const old = Buffer.alloc(size, 1);
  writeFileSync(file, old);
  const history = await openProjectHistory({ projectDir, historyRoot, quietMs: 30 });
  cleanup.push(() => history.close());
  return { history, file, old };
}

/** An agent step that replaces `file` right after it begins, as Desktop's watcher reports it. */
async function replaced(history: ProjectHistory, file: string, size: number) {
  const window = await history.beginWindow(agent, "Replace it");
  writeFileSync(file, Buffer.alloc(size, 2));
  history.noteChange(file);
  return window.close();
}

// fails without the fix: the step began before the file's first copy landed, so the replace was never recorded
// and its old bytes were lost.
describe("an agent step that replaces a file the project had when its history opened", () => {
  it("brings back a 40 MB image replaced before its first copy would have landed", async () => {
    const { history, file, old } = await projectWith("cover.png", 40 * MiB);
    const entry = await replaced(history, file, 40 * MiB);
    expect(entry).toMatchObject({ label: "Replace it", who: agent });
    expect(await history.undo(entry!.id, { who: agent, mode: "back-to-before" })).toMatchObject({
      ok: true,
    });
    expect(readFileSync(file).equals(old)).toBe(true);
  });

  it("records a replaced video as the agent's change, whose old version is not kept", async () => {
    const { history, file } = await projectWith("talk.mp4", 2 * MiB);
    const entry = await replaced(history, file, 2 * MiB);
    expect(entry).toMatchObject({ label: "Replace it", who: agent });
    await expect(history.undo(entry!.id, { who: agent, mode: "back-to-before" })).rejects.toThrow(
      "An earlier version of talk.mp4 is not kept",
    );
  });
});
