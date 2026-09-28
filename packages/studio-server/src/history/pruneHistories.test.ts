import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { ID_PATH, readId } from "./historyId.js";
import { openProjectHistory } from "./projectHistory.js";
import { KEEP_GONE_PROJECT_HISTORY_MS, pruneGoneProjectHistories } from "./pruneHistories.js";

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const DAY_MS = 24 * 60 * 60 * 1000;

async function projectWithHistory(
  historyRoot: string,
  {
    at = Date.now(),
    projectDir = tempDir("hf-prune-project-"),
    pruneGoneProjectsBudgetMs = undefined as number | undefined,
  } = {},
) {
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, "index.html"), "<h1>A</h1>");
  const history = await openProjectHistory({
    projectDir,
    historyRoot,
    now: () => at,
    pruneGoneProjectsBudgetMs,
  });
  // Lets the open's own daily prune scan first, so it cannot race the test's.
  await new Promise((settle) => setImmediate(settle));
  return { projectDir, history, id: readId(projectDir)! };
}

function editRecord(
  historyRoot: string,
  id: string,
  edit: (record: Record<string, unknown>) => Record<string, unknown>,
) {
  const file = join(historyRoot, id, "project.json");
  writeFileSync(file, JSON.stringify(edit(JSON.parse(readFileSync(file, "utf-8")))));
}

const prunedIds = async (...args: Parameters<typeof pruneGoneProjectHistories>) =>
  (await pruneGoneProjectHistories(...args)).map((pruned) => pruned.id);

describe("pruneGoneProjectHistories", () => {
  it("in a dry run reports what would go, with its folder and size, and removes nothing", async () => {
    const historyRoot = tempDir("hf-prune-root-");
    const gone = await projectWithHistory(historyRoot);
    await gone.history.close();
    rmSync(gone.projectDir, { recursive: true, force: true });

    const [pruned, ...rest] = await pruneGoneProjectHistories(historyRoot, { dryRun: true });
    expect(rest).toEqual([]);
    expect(pruned).toMatchObject({ id: gone.id, projectDir: gone.projectDir });
    expect(pruned!.bytes).toBeGreaterThan(0);
    expect(existsSync(join(historyRoot, gone.id))).toBe(true);
  });

  it("removes a deleted project's history once no process holds it, and keeps a live project's", async () => {
    const historyRoot = tempDir("hf-prune-root-");
    const gone = await projectWithHistory(historyRoot);
    const kept = await projectWithHistory(historyRoot);
    rmSync(gone.projectDir, { recursive: true, force: true });

    expect(await prunedIds(historyRoot)).toEqual([]);
    await gone.history.close();
    expect(await prunedIds(historyRoot)).toEqual([gone.id]);

    expect(existsSync(join(historyRoot, gone.id))).toBe(false);
    expect(existsSync(join(historyRoot, kept.id))).toBe(true);
    await kept.history.close();
  });

  it("keeps a gone project's history outside the temp folder until it has gone unused for 14 days", async () => {
    const historyRoot = tempDir("hf-prune-root-");
    const gone = await projectWithHistory(historyRoot);
    await gone.history.close();
    rmSync(gone.projectDir, { recursive: true, force: true });
    const elsewhere = { tempDir: historyRoot };

    expect(await prunedIds(historyRoot, elsewhere)).toEqual([]);
    const later = Date.now() + KEEP_GONE_PROJECT_HISTORY_MS;
    expect(await prunedIds(historyRoot, { ...elsewhere, now: later })).toEqual([gone.id]);
  });

  it("prunes when a history opens a day after the last full prune", async () => {
    const historyRoot = tempDir("hf-prune-root-");
    const start = Date.now();
    const gone = await projectWithHistory(historyRoot, { at: start });
    await gone.history.close();
    rmSync(gone.projectDir, { recursive: true, force: true });

    const cli = await projectWithHistory(historyRoot, {
      at: start + DAY_MS,
      pruneGoneProjectsBudgetMs: 0,
    });
    expect(existsSync(join(historyRoot, gone.id))).toBe(true);
    await cli.history.close();
    const next = await projectWithHistory(historyRoot, { at: start + DAY_MS });
    await vi.waitFor(() => expect(existsSync(join(historyRoot, gone.id))).toBe(false));
    await next.history.close();
  });

  it("finishes an interrupted removal and leaves folders that are not histories alone", async () => {
    const historyRoot = tempDir("hf-prune-root-");
    const leftover = join(historyRoot, ".pruned-leftover");
    mkdirSync(join(leftover, "blobs"), { recursive: true });
    writeFileSync(join(leftover, "blobs", "b"), "bytes");
    const copy = join(historyRoot, "backup");
    mkdirSync(copy);
    writeFileSync(join(copy, "project.json"), JSON.stringify({ dir: join(historyRoot, "gone") }));

    expect(await prunedIds(historyRoot)).toEqual([]);
    expect(existsSync(leftover)).toBe(false);
    expect(existsSync(copy)).toBe(true);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "lets go of a history it could not move away",
    async () => {
      const historyRoot = tempDir("hf-prune-root-");
      const gone = await projectWithHistory(historyRoot);
      await gone.history.close();
      rmSync(gone.projectDir, { recursive: true, force: true });
      const errors: unknown[] = [];

      chmodSync(historyRoot, 0o500);
      try {
        expect(await prunedIds(historyRoot, { onError: (error) => errors.push(error) })).toEqual(
          [],
        );
      } finally {
        chmodSync(historyRoot, 0o700);
      }
      expect(errors).toHaveLength(1);
      expect(existsSync(join(historyRoot, gone.id, "owner.pid"))).toBe(false);
    },
  );

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "reports a history it cannot check and still prunes the rest",
    async () => {
      const historyRoot = tempDir("hf-prune-root-");
      const locked = tempDir("hf-prune-locked-");
      const hidden = await projectWithHistory(historyRoot, { projectDir: join(locked, "project") });
      await hidden.history.close();
      const gone = await projectWithHistory(historyRoot);
      await gone.history.close();
      rmSync(gone.projectDir, { recursive: true, force: true });
      const errors: unknown[] = [];

      chmodSync(locked, 0o000);
      try {
        const later = Date.now() + KEEP_GONE_PROJECT_HISTORY_MS;
        const onError = (error: unknown) => errors.push(error);
        expect(await prunedIds(historyRoot, { now: later, onError })).toEqual([gone.id]);
      } finally {
        chmodSync(locked, 0o700);
      }
      expect(errors).toHaveLength(1);
      expect(existsSync(join(historyRoot, hidden.id))).toBe(true);
    },
  );

  it("keeps a gone project's history while the disk that held it is not here", async () => {
    const historyRoot = tempDir("hf-prune-root-");
    const onDrive = await projectWithHistory(historyRoot, {
      projectDir: join(tempDir("hf-prune-drive-"), "project"),
    });
    const deleted = await projectWithHistory(historyRoot, {
      projectDir: join(tempDir("hf-prune-tree-"), "project"),
    });
    const mountPoint = await projectWithHistory(historyRoot);
    await Promise.all([onDrive, deleted, mountPoint].map(({ history }) => history.close()));
    for (const { id } of [onDrive, mountPoint])
      editRecord(historyRoot, id, (record) => ({ ...record, dev: Number(record.dev) + 1 }));
    rmSync(dirname(onDrive.projectDir), { recursive: true, force: true });
    // What an unmounted drive leaves at its mount point: the folder, without the project in it.
    rmSync(join(mountPoint.projectDir, ".hyperframes"), { recursive: true, force: true });
    rmSync(dirname(deleted.projectDir), { recursive: true, force: true });

    const later = Date.now() + KEEP_GONE_PROJECT_HISTORY_MS;
    expect(await prunedIds(historyRoot, { tempDir: historyRoot, now: later })).toEqual([
      deleted.id,
    ]);
  });

  it("keeps a history recorded without its disk once the project's parent is gone too", async () => {
    const historyRoot = tempDir("hf-prune-root-");
    const parentGone = await projectWithHistory(historyRoot, {
      projectDir: join(tempDir("hf-prune-parent-"), "project"),
    });
    const parentKept = await projectWithHistory(historyRoot);
    await Promise.all([parentGone.history.close(), parentKept.history.close()]);
    for (const { id } of [parentGone, parentKept])
      editRecord(historyRoot, id, ({ dev: _dev, ...record }) => record);
    rmSync(dirname(parentGone.projectDir), { recursive: true, force: true });
    rmSync(parentKept.projectDir, { recursive: true, force: true });

    const later = Date.now() + KEEP_GONE_PROJECT_HISTORY_MS;
    expect(await prunedIds(historyRoot, { tempDir: historyRoot, now: later })).toEqual([
      parentKept.id,
    ]);
  });

  it("removes the history of a folder that now holds another project", async () => {
    const historyRoot = tempDir("hf-prune-root-");
    const replaced = await projectWithHistory(historyRoot);
    await replaced.history.close();
    writeFileSync(join(replaced.projectDir, ID_PATH), "00000000-0000-4000-8000-000000000000\n");

    expect(await prunedIds(historyRoot)).toEqual([replaced.id]);
  });

  it("keeps the history of a project whose id file cannot be read", async () => {
    const historyRoot = tempDir("hf-prune-root-");
    const unreadable = await projectWithHistory(historyRoot);
    await unreadable.history.close();
    mkdirSync(join(unreadable.projectDir, ".hyperframes"), { recursive: true });
    writeFileSync(join(unreadable.projectDir, ID_PATH), "not an id\n");

    expect(await prunedIds(historyRoot)).toEqual([]);
    expect(existsSync(join(historyRoot, unreadable.id))).toBe(true);
  });
});
