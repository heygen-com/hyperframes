import type { Stats } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { isPrivateProjectPath } from "./safePath.js";

// Null for any failure, as `existsSync` answers false: an unreadable folder stays "not found", never a refusal.
export const statOrNull = (path: string): Promise<Stats | null> => stat(path).catch(() => null);

export const folderGoneOff = (dir: string): Promise<boolean> =>
  stat(dir).then(
    () => false,
    (error: NodeJS.ErrnoException) => error.code === "ENOENT" || error.code === "ENOTDIR",
  );

/** The real path; for a path not there (yet, or any more), the nearest existing folder's real path plus the rest. */
export async function realFilePathOff(filePath: string): Promise<string> {
  try {
    return await realpath(filePath);
  } catch {
    const dir = dirname(filePath);
    return dir === filePath ? filePath : join(await realFilePathOff(dir), basename(filePath));
  }
}

export async function isPrivateProjectFileOff(
  projectDir: string,
  filePath: string,
): Promise<boolean> {
  const rel = (from: string, to: string) => relative(from, to).split(sep).join("/");
  if (isPrivateProjectPath(rel(projectDir, filePath))) return true;
  const [realDir, realFile] = await Promise.all([
    realFilePathOff(projectDir),
    realFilePathOff(filePath),
  ]);
  return isPrivateProjectPath(rel(realDir, realFile));
}
