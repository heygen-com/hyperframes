import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
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
  try {
    const was = JSON.parse(readFileSync(join(historyDir, "project.json"), "utf-8"));
    return sameFolder({ ino: was.ino, birthtimeMs: was.born }, folder);
  } catch {
    return false;
  }
}

/**
 * The project's history id, kept in the project so a rename or move keeps its history. Where history exists under it,
 * only the recorded folder keeps it: same inode and creation time, since an inode alone is reused after a delete.
 */
export function projectHistoryId(projectDir: string, historyRoot: string): string {
  const dir = resolve(projectDir);
  const folder = statSync(dir);
  let id = readId(dir);
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

export function recordProject(historyDir: string, dir: string, folder: FolderIdentity): void {
  const record = { dir, ino: folder.ino, born: folder.birthtimeMs };
  mkdirSync(historyDir, { recursive: true });
  replaceFileAtomically(join(historyDir, "project.json"), JSON.stringify(record), 0o644);
}
