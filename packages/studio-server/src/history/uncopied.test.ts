import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openProjectHistory, type ProjectHistory } from "./projectHistory";
import type { HistoryWho } from "./historyLog";

const you: HistoryWho = { kind: "person", name: "You" };
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

async function open(projectDir: string, historyRoot: string) {
  const history = await openProjectHistory({ projectDir, historyRoot, quietMs: 30 });
  cleanup.push(() => history.close());
  return history;
}

function blobBytes(historyRoot: string, history: ProjectHistory): number {
  const dir = join(historyRoot, history.projectId, "blobs");
  return readdirSync(dir).reduce(
    (sum, shard) =>
      sum +
      readdirSync(join(dir, shard)).reduce(
        (inner, name) => inner + statSync(join(dir, shard, name)).size,
        0,
      ),
    0,
  );
}

async function project(files: Record<string, string | Buffer>) {
  const projectDir = tempDir("hf-uncopied-project-");
  const historyRoot = tempDir("hf-uncopied-root-");
  const write = (path: string, content: string | Buffer) => {
    mkdirSync(join(projectDir, path, ".."), { recursive: true });
    writeFileSync(join(projectDir, path), content);
  };
  for (const [path, content] of Object.entries(files)) write(path, content);
  const history = await open(projectDir, historyRoot);
  return { projectDir, historyRoot, history, write };
}

describe("project history and media files", () => {
  it("copies no bytes of a video that was there when history opened", async () => {
    const { history, historyRoot } = await project({
      "index.html": "A",
      "assets/camera.mp4": Buffer.alloc(50 * MiB, 3),
    });
    await vi.waitFor(() => expect(history.peek("start")).toHaveProperty(["assets/camera.mp4"]), {
      timeout: 10_000,
    });
    expect(blobBytes(historyRoot, history)).toBeLessThan(1024);
  });

  it("leaves GIF render outputs out of project history", async () => {
    const { history, historyRoot, projectDir, write } = await project({ "index.html": "A" });
    const render = await history.beginWindow(you, "Export GIF");
    write("renders/export.gif", Buffer.alloc(2 * MiB, 7));
    const entry = await render.close();
    expect(entry?.files ?? []).toEqual([]);
    expect(history.peek("start")).not.toHaveProperty(["renders/export.gif"]);
    expect(statSync(join(projectDir, "renders/export.gif")).size).toBe(2 * MiB);
    expect(blobBytes(historyRoot, history)).toBeLessThan(1024);
  });

  it("copies no bytes of media written or replaced while history is open", async () => {
    const { history, historyRoot, write } = await project({ "index.html": "A" });
    const window = await history.beginWindow(you, "Render");
    write("out.mp4", Buffer.alloc(20 * MiB, 1));
    write("voice.wav", Buffer.alloc(5 * MiB, 2));
    await window.close();
    const again = await history.beginWindow(you, "Render again");
    write("out.mp4", Buffer.alloc(20 * MiB, 9));
    const entry = await again.close();
    expect(entry?.files.map((file) => file.path)).toEqual(["out.mp4"]);
    expect(blobBytes(historyRoot, history)).toBeLessThan(1024);
  });

  it("still copies a text edit and says plainly that a media version is not kept", async () => {
    const { history, historyRoot, write } = await project({
      "index.html": "A",
      "clip.mp4": Buffer.alloc(2 * MiB, 1),
    });
    await vi.waitFor(() => expect(history.peek("start")).toHaveProperty(["clip.mp4"]), {
      timeout: 10_000,
    });
    const edit = await history.beginWindow(you, "Edit");
    write("index.html", "B");
    write("clip.mp4", Buffer.alloc(2 * MiB, 2));
    const entry = (await edit.close())!;
    expect(blobBytes(historyRoot, history)).toBeLessThan(2048);
    await expect(history.undo(entry.id, { who: you })).rejects.toThrow(/clip\.mp4 is not kept/);
  });

  it("reclaims media copies an older version left, and keeps every text copy", async () => {
    const { history, historyRoot, projectDir } = await project({
      "index.html": "A",
      "clip.mp4": Buffer.alloc(2 * MiB, 5),
    });
    await vi.waitFor(() => expect(history.peek("start")).toHaveProperty(["clip.mp4"]), {
      timeout: 10_000,
    });
    await history.close();
    const media = Buffer.alloc(2 * MiB, 5);
    const hash = createHash("sha256").update(media).digest("hex");
    const planted = join(historyRoot, history.projectId, "blobs", hash.slice(0, 2));
    mkdirSync(planted, { recursive: true });
    writeFileSync(join(planted, hash), media);
    expect(blobBytes(historyRoot, history)).toBeGreaterThanOrEqual(2 * MiB);

    const reopened = await open(projectDir, historyRoot);
    await reopened.flush();
    expect(blobBytes(historyRoot, reopened)).toBeLessThan(1024);
    expect(await reopened.readBlob(reopened.peek("start")!["index.html"]!)).toEqual(
      Buffer.from("A"),
    );
  });

  it("keeps TypeScript source edits undoable, and reclaim leaves their copies", async () => {
    const { history, historyRoot, projectDir, write } = await project({
      "index.html": "A",
      "setup.ts": "export const a = 1;",
      "intro.mts": "export const b = 1;",
    });
    await history.flush();
    const edit = await history.beginWindow(you, "Edit");
    write("setup.ts", "export const a = 2;");
    write("intro.mts", "export const b = 2;");
    const entry = (await edit.close())!;
    expect(blobBytes(historyRoot, history)).toBeGreaterThan(40);
    await history.close();
    const reopened = await open(projectDir, historyRoot);
    expect(blobBytes(historyRoot, reopened)).toBeGreaterThan(40);
    expect((await reopened.undo(entry.id, { who: you })).ok).toBe(true);
    expect(readFileSync(join(projectDir, "setup.ts"), "utf-8")).toBe("export const a = 1;");
  });
});
