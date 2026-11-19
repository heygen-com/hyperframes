// A route's reads of a project's folder, off the event loop: a drive that stops answering holds one request, not all.
import type { Stats } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { isPrivateProjectPath } from "./safePath.js";

const isGone = (error: unknown): boolean => {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
};

export async function statOrNull(path: string): Promise<Stats | null> {
  try {
    return await stat(path);
  } catch (error) {
    if (isGone(error)) return null;
    throw error;
  }
}

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
