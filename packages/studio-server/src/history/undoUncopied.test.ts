import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openBlobStore } from "./blobStore";
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

async function change(history: ProjectHistory, label: string, writes: () => void) {
  const window = await history.beginWindow(you, label);
  writes();
  const entry = await window.close();
  if (!entry) throw new Error("the window recorded nothing");
  return entry;
}

async function project() {
  const projectDir = tempDir("hf-undo-media-project-");
  const historyRoot = tempDir("hf-undo-media-root-");
  writeFileSync(join(projectDir, "index.html"), "A");
  const history = await open(projectDir, historyRoot);
  const media = join(projectDir, "join.mp4");
  return { projectDir, historyRoot, history, media };
}

describe("undoing a change that made or replaced media", () => {
  it("keeps the made file's bytes, so redo brings the same file back", async () => {
    const { history, media } = await project();
    const bytes = Buffer.alloc(2 * MiB, 7);
    const made = await change(history, "Place join", () => writeFileSync(media, bytes));

    const undone = await history.undo(made.id, { who: you });
    expect(existsSync(media)).toBe(false);

    const redone = await history.undo(undone.ok ? undone.entry!.id : "", { who: you });
    expect(redone).toMatchObject({ ok: true });
    expect(readFileSync(media).equals(bytes)).toBe(true);
  });

  it("still brings the file back after the history is closed and opened again", async () => {
    const { history, media, projectDir, historyRoot } = await project();
    const bytes = Buffer.alloc(2 * MiB, 9);
    const made = await change(history, "Place join", () => writeFileSync(media, bytes));
    const undone = await history.undo(made.id, { who: you });
    await history.close();

    const reopened = await open(projectDir, historyRoot);
    const redone = await reopened.undo(undone.ok ? undone.entry!.id : "", { who: you });
    expect(redone).toMatchObject({ ok: true });
    expect(readFileSync(media).equals(bytes)).toBe(true);
  });

  it("keeps the bytes a restore overwrites, so undoing the restore returns them", async () => {
    const { history, media, projectDir } = await project();
    const first = Buffer.alloc(2 * MiB, 1);
    const second = Buffer.alloc(2 * MiB, 2);
    const made = await change(history, "Place join", () => writeFileSync(media, first));
    await history.undo(made.id, { who: you });
    await change(history, "New join", () => writeFileSync(media, second));
    mkdirSync(join(projectDir, "x"), { recursive: true });

    const restored = await history.restore(made.id, you);
    expect(readFileSync(media).equals(first)).toBe(true);

    const back = await history.undo(restored!.id, { who: you });
    expect(back).toMatchObject({ ok: true });
    expect(readFileSync(media).equals(second)).toBe(true);
  });

  it("does not spend the set-aside bytes when an old version is only checked out", async () => {
    const { history, media } = await project();
    const bytes = Buffer.alloc(2 * MiB, 3);
    const made = await change(history, "Place join", () => writeFileSync(media, bytes));
    const undone = await history.undo(made.id, { who: you });

    await history.checkout(made.id, "after", tempDir("hf-undo-media-out-"));

    const redone = await history.undo(undone.ok ? undone.entry!.id : "", { who: you });
    expect(redone).toMatchObject({ ok: true });
    expect(readFileSync(media).equals(bytes)).toBe(true);
  });

  it("brings back two files with the same bytes made in one change", async () => {
    const { history, projectDir } = await project();
    const bytes = Buffer.alloc(2 * MiB, 4);
    const made = await change(history, "Place joins", () => {
      writeFileSync(join(projectDir, "a.mp4"), bytes);
      writeFileSync(join(projectDir, "b.mp4"), bytes);
    });
    const undone = await history.undo(made.id, { who: you });

    const redone = await history.undo(undone.ok ? undone.entry!.id : "", { who: you });
    expect(redone).toMatchObject({ ok: true });
    for (const name of ["a.mp4", "b.mp4"])
      expect(readFileSync(join(projectDir, name)).equals(bytes)).toBe(true);
  });

  it("does not fold the history away when the media it keeps is larger than the budget", async () => {
    const projectDir = tempDir("hf-undo-media-project-");
    const historyRoot = tempDir("hf-undo-media-root-");
    writeFileSync(join(projectDir, "index.html"), "A");
    const history = await openProjectHistory({ projectDir, historyRoot, budgetBytes: MiB });
    cleanup.push(() => history.close());
    const media = join(projectDir, "join.mp4");
    const bytes = Buffer.alloc(2 * MiB, 5);
    const made = await change(history, "Place join", () => writeFileSync(media, bytes));

    const undone = await history.undo(made.id, { who: you });
    const redone = await history.undo(undone.ok ? undone.entry!.id : "", { who: you });

    expect(redone).toMatchObject({ ok: true });
    expect(readFileSync(media).equals(bytes)).toBe(true);
    expect(history.list().length).toBeGreaterThanOrEqual(3);
  });
});

describe("the same bytes at two paths in separate entries", () => {
  it("brings both files back through undo and redo in any order", async () => {
    const { history, projectDir } = await project();
    const bytes = Buffer.alloc(2 * MiB, 8);
    const first = await change(history, "Place a", () =>
      writeFileSync(join(projectDir, "a.mp4"), bytes),
    );
    const second = await change(history, "Place b", () =>
      writeFileSync(join(projectDir, "b.mp4"), bytes),
    );
    const undoneSecond = await history.undo(second.id, { who: you });
    const undoneFirst = await history.undo(first.id, { who: you });

    const redoneFirst = await history.undo(undoneFirst.ok ? undoneFirst.entry!.id : "", {
      who: you,
    });
    const redoneSecond = await history.undo(undoneSecond.ok ? undoneSecond.entry!.id : "", {
      who: you,
    });

    expect([redoneFirst, redoneSecond]).toMatchObject([{ ok: true }, { ok: true }]);
    for (const name of ["a.mp4", "b.mp4"])
      expect(readFileSync(join(projectDir, name)).equals(bytes)).toBe(true);
  });
});

describe("the set-aside store beside the blobs", () => {
  async function stores() {
    const home = tempDir("hf-aside-home-");
    const source = join(home, "join.mp4");
    writeFileSync(source, Buffer.alloc(2 * MiB, 6));
    const blobs = await openBlobStore(join(home, "blobs"));
    const hash = await blobs.reference(source);
    return { home, source, blobs, hash };
  }

  it("keeps a copied blob of the same bytes when the set-aside copy is released", async () => {
    const { home, source, blobs, hash } = await stores();
    await blobs.keep("join.mp4", source, false);
    const copy = join(home, "backup.txt");
    writeFileSync(copy, readFileSync(source));

    expect(await blobs.put(copy)).toBe(hash);
    await blobs.release([[hash, "join.mp4"]]);

    expect(blobs.has(hash)).toBe(true);
    expect((await blobs.read(hash)).length).toBe(2 * MiB);
  });

  it("counts for no bytes and no size until it is released", async () => {
    const { source, blobs, hash } = await stores();
    await blobs.keep("join.mp4", source, true);

    expect([blobs.has(hash), blobs.bytes(), blobs.size(hash)]).toEqual([true, 0, 0]);
    expect(existsSync(source)).toBe(false);
  });

  it("leaves only the finished copy in the set-aside folder", async () => {
    const { home, source, blobs, hash } = await stores();
    await blobs.keep("join.mp4", source, false);

    const aside = join(home, "aside");
    expect(readdirSync(aside)).toEqual([hash.slice(0, 2)]);
    expect(readdirSync(join(aside, hash.slice(0, 2)))).toEqual([hash]);
  });

  it("opens past a temp file a crash left mid-copy, and clears it", async () => {
    const { home, source, blobs, hash } = await stores();
    await blobs.keep("join.mp4", source, false);
    const leftovers = [join(home, "blobs", "incoming-1234"), join(home, "aside", "incoming-5678")];
    for (const leftover of leftovers) writeFileSync(leftover, "half a copy");

    const reopened = await openBlobStore(join(home, "blobs"));

    expect(reopened.has(hash)).toBe(true);
    expect(leftovers.some((leftover) => existsSync(leftover))).toBe(false);
  });

  it("still fails the open when the folder cannot be read", async () => {
    const { home } = await stores();
    const blobsDir = join(home, "blobs");
    chmodSync(blobsDir, 0o111);
    cleanup.push(() => chmodSync(blobsDir, 0o755));

    await expect(openBlobStore(blobsDir)).rejects.toMatchObject({ code: "EACCES" });
  });
});
