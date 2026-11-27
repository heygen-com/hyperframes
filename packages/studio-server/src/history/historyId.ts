import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, utimesSync } from "node:fs";
import { mkdir, readFile, stat, utimes } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { replaceFileAtomically, replaceFileAtomicallyAsync } from "@hyperframes/core/atomic-file";
import { mkdirOwnedWithinProjectAsync } from "../helpers/safePath.js";

export const ID_PATH = join(".hyperframes", "history-id");
/** The only shape minted here; the id is project content and becomes a path, so nothing else is trusted. */
const ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const isHistoryId = (name: string) => ID_SHAPE.test(name);

export function readId(projectDir: string): string | null {
  try {
    const id = readFileSync(join(projectDir, ID_PATH), "utf-8").trim();
    return ID_SHAPE.test(id) ? id : null;
  } catch {
    return null;
  }
}

export async function readIdOffThread(projectDir: string): Promise<string | null> {
  try {
    const id = (await readFile(join(projectDir, ID_PATH), "utf-8")).trim();
    return ID_SHAPE.test(id) ? id : null;
  } catch {
    return null;
  }
}

export async function statOffThread(path: string) {
  try {
    return await stat(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw error;
  }
}

export type FolderIdentity = { ino: number; birthtimeMs: number };

export const sameFolder = (a: FolderIdentity, b: FolderIdentity) =>
  a.ino === b.ino && a.birthtimeMs === b.birthtimeMs;

export async function isRecordedFolder(
  historyDir: string,
  folder: FolderIdentity,
): Promise<boolean> {
  const was = await readRecordOffThread(historyDir);
  if (typeof was?.ino === "number")
    return sameFolder({ ino: was.ino, birthtimeMs: was.born ?? NaN }, folder);
  const unreadableSo0878KeptTheId = typeof was?.dir !== "string";
  if (unreadableSo0878KeptTheId) return true;
  return !(await isCopyOf0878Folder(was!.dir as string, basename(historyDir), folder));
}

type ProjectRecord = { dir?: unknown; ino?: unknown; born?: number; dev?: unknown };

export function readRecord(historyDir: string): ProjectRecord | null {
  try {
    return JSON.parse(readFileSync(join(historyDir, "project.json"), "utf-8"));
  } catch {
    return null;
  }
}

export async function readRecordOffThread(historyDir: string): Promise<ProjectRecord | null> {
  try {
    return JSON.parse(await readFile(join(historyDir, "project.json"), "utf-8"));
  } catch {
    return null;
  }
}

async function isCopyOf0878Folder(
  recordedDir: string,
  id: string,
  folder: FolderIdentity,
): Promise<boolean> {
  let there;
  try {
    there = await statOffThread(recordedDir);
  } catch {
    return false;
  }
  return !!there && !sameFolder(there, folder) && (await readIdOffThread(recordedDir)) === id;
}

/**
 * The project's history id, kept in the project so a rename or move keeps its history; only the folder its history
 * was recorded for keeps it (isRecordedFolder). An id file that cannot be read is refused, never replaced.
 */
export async function projectHistoryId(projectDir: string, historyRoot: string): Promise<string> {
  const dir = resolve(projectDir);
  const folder = await stat(dir);
  let id = await readIdOffThread(dir);
  if (!id && (await statOffThread(join(dir, ID_PATH))))
    throw new HistoryIdError(
      `${join(dir, ID_PATH)} holds no history id this version can read; move it aside to start anew.`,
    );
  if (
    !id ||
    ((await statOffThread(join(historyRoot, id))) &&
      !(await isRecordedFolder(join(historyRoot, id), folder)))
  ) {
    id = randomUUID();
    await mkdirOwnedWithinProjectAsync(dir, join(dir, ".hyperframes"));
    await replaceFileAtomicallyAsync(join(dir, ID_PATH), `${id}\n`);
  }
  await recordProjectOffThread(join(historyRoot, id), dir, folder);
  return id;
}

export class HistoryIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HistoryIdError";
  }
}

type Folder = FolderIdentity & { dev: number };

const recordOf = (dir: string, folder: Folder) => ({
  dir,
  ino: folder.ino,
  born: folder.birthtimeMs,
  dev: folder.dev,
});

const sameRecord = (was: ProjectRecord | null, record: ReturnType<typeof recordOf>) =>
  was?.dir === record.dir &&
  was.ino === record.ino &&
  was.born === record.born &&
  was.dev === record.dev;

function markUsed(historyDir: string): void {
  const now = new Date();
  try {
    utimesSync(join(historyDir, "project.json"), now, now);
  } catch {
    return;
  }
}

export function recordProject(historyDir: string, dir: string, folder: Folder): void {
  const record = recordOf(dir, folder);
  if (sameRecord(readRecord(historyDir), record)) return markUsed(historyDir);
  mkdirSync(historyDir, { recursive: true });
  replaceFileAtomically(join(historyDir, "project.json"), JSON.stringify(record), 0o644);
}

async function recordProjectOffThread(
  historyDir: string,
  dir: string,
  folder: Folder,
): Promise<void> {
  const record = recordOf(dir, folder);
  if (sameRecord(await readRecordOffThread(historyDir), record)) {
    const now = new Date();
    await utimes(join(historyDir, "project.json"), now, now).catch(() => undefined);
    return;
  }
  await mkdir(historyDir, { recursive: true });
  await replaceFileAtomicallyAsync(join(historyDir, "project.json"), JSON.stringify(record), 0o644);
}
