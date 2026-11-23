import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { realpathOff, resolveExistingWithinProjectOff } from "@hyperframes/core/safe-path";
import { basename, dirname, join, relative, sep } from "node:path";
import { isPrivateProjectPath } from "./safePath.js";

// Null for any failure, as `existsSync` answers false: an unreadable folder stays "not found", never a refusal.
export const statOrNull = (path: string): Promise<Stats | null> => stat(path).catch(() => null);

export const folderGoneOff = (dir: string): Promise<boolean> =>
  stat(dir).then(
    () => false,
    (error: NodeJS.ErrnoException) => error.code === "ENOENT" || error.code === "ENOTDIR",
  );

/** The real path, or for a missing path its nearest folder's plus the rest; throws for one that will not resolve. */
export async function realFilePathOff(filePath: string): Promise<string> {
  try {
    return await realpathOff(filePath);
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
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
  const unresolvable = null;
  const real = await Promise.all([realFilePathOff(projectDir), realFilePathOff(filePath)]).catch(
    () => unresolvable,
  );
  return real === unresolvable || isPrivateProjectPath(rel(real[0], real[1]));
}

export async function resolveExistingProjectFileOff(
  base: string,
  relativePath: string,
): Promise<string | null> {
  const file = await resolveExistingWithinProjectOff(base, relativePath);
  return file === null || (await isPrivateProjectFileOff(base, file)) ? null : file;
}
