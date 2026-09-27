import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { replaceFileAtomically } from "../helpers/atomicFile.js";

export const ID_PATH = join(".hyperframes", "history-id");
/** The only shape minted here; the id is project content and becomes a path, so nothing else is trusted. */
const ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function readId(projectDir: string): string | null {
  try {
    const id = readFileSync(join(projectDir, ID_PATH), "utf-8").trim();
    return ID_SHAPE.test(id) ? id : null;
  } catch {
    return null;
  }
}

export type FolderIdentity = { ino: number; birthtimeMs: number };

export const sameFolder = (a: FolderIdentity, b: FolderIdentity) =>
  a.ino === b.ino && a.birthtimeMs === b.birthtimeMs;

export function isRecordedFolder(historyDir: string, folder: FolderIdentity): boolean {
  const was = readRecord(historyDir);
  if (typeof was?.ino === "number") return sameFolder({ ino: was.ino, birthtimeMs: was.born ?? NaN }, folder);
  const unreadableSo0878KeptTheId = typeof was?.dir !== "string";
  if (unreadableSo0878KeptTheId) return true;
  return !isCopyOf0878Folder(was!.dir as string, basename(historyDir), folder);
}

function readRecord(historyDir: string): { dir?: unknown; ino?: unknown; born?: number } | null {
  try {
    return JSON.parse(readFileSync(join(historyDir, "project.json"), "utf-8"));
  } catch {
    return null;
  }
}

function isCopyOf0878Folder(recordedDir: string, id: string, folder: FolderIdentity): boolean {
  const there = statSync(recordedDir, { throwIfNoEntry: false });
  return !!there && !sameFolder(there, folder) && readId(recordedDir) === id;
}

/**
 * The project's history id, kept in the project so a rename or move keeps its history; only the folder its history
 * was recorded for keeps it (isRecordedFolder). An id file that cannot be read is refused, never replaced.
 */
export function projectHistoryId(projectDir: string, historyRoot: string): string {
  const dir = resolve(projectDir);
  const folder = statSync(dir);
  let id = readId(dir);
  if (!id && existsSync(join(dir, ID_PATH)))
    throw new HistoryIdError(
      `${join(dir, ID_PATH)} holds no history id this version can read; move it aside to start anew.`,
    );
  if (
    !id ||
    (existsSync(join(historyRoot, id)) && !isRecordedFolder(join(historyRoot, id), folder))
  ) {
    id = randomUUID();
    mkdirSync(join(dir, ".hyperframes"), { recursive: true });
    writeFileSync(join(dir, ID_PATH), `${id}\n`);
  }
  recordProject(join(historyRoot, id), dir, folder);
  return id;
}

export class HistoryIdError extends Error {}

export function recordProject(historyDir: string, dir: string, folder: FolderIdentity): void {
  const record = { dir, ino: folder.ino, born: folder.birthtimeMs };
  mkdirSync(historyDir, { recursive: true });
  replaceFileAtomically(join(historyDir, "project.json"), JSON.stringify(record), 0o644);
}
