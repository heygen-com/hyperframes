import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
  isEnvOrGitPath,
  isPrivateOutsideFile,
  linksOutside,
} from "@hyperframes/studio-server/outside-file";
import { isPrivateProjectFile, realFilePath } from "@hyperframes/studio-server/safe-path";

export { isEnvOrGitPath, isPrivateOutsideFile, linksOutside };

export function linksToPrivateOutsideFile(projectDir: string, filePath: string): boolean {
  return linksOutside(projectDir, filePath) && isPrivateOutsideFile(projectDir, filePath);
}

const RECEIVED_RECORD = join(".hyperframes", "received-files.json");

interface ReceivedRecord {
  root: string;
  projectDirFromRoot: string;
  listed: unknown;
}

function nearestReceivedRecordAtOrAbove(projectDir: string): ReceivedRecord | null {
  let start: string;
  try {
    start = realpathSync(projectDir);
  } catch {
    start = resolve(projectDir);
  }
  for (let dir = start; ; ) {
    const projectDirFromRoot = relative(dir, start).split(sep).join("/");
    try {
      const listed: unknown = JSON.parse(readFileSync(join(dir, RECEIVED_RECORD), "utf-8")).files;
      return { root: dir, projectDirFromRoot, listed };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR")
        return { root: dir, projectDirFromRoot, listed: undefined };
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function receivedFiles(projectDir: string): (path: string) => boolean {
  const record = nearestReceivedRecordAtOrAbove(projectDir);
  if (!record) return () => false;
  if (!Array.isArray(record.listed)) return () => true;
  const files = new Set(record.listed.map((path) => String(path).normalize("NFC")));
  const keyOf = (path: string) =>
    (record.projectDirFromRoot ? `${record.projectDirFromRoot}/${path}` : path).normalize("NFC");
  return (path) => files.has(keyOf(path));
}

/** Project files no composition loads, so none is served or uploaded for one: env files, Git data, tool records. */
export function isPrivateCompositionFile(projectDir: string, filePath: string): boolean {
  return (
    isEnvOrGitPath(relative(projectDir, filePath)) ||
    isEnvOrGitPath(relative(realFilePath(projectDir), realFilePath(filePath))) ||
    isPrivateProjectFile(projectDir, filePath)
  );
}
