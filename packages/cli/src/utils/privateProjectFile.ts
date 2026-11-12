import { realpathSync } from "node:fs";
import { relative } from "node:path";
import { isPrivateProjectFile, realFilePath } from "@hyperframes/studio-server/safe-path";

const ENV_FILE = /^\.env([._-].*|rc)?$/;

export function isEnvOrGitPath(path: string): boolean {
  const segments = path.toLowerCase().split(/[\\/]/);
  return segments.includes(".git") || ENV_FILE.test(segments.at(-1) ?? "");
}

const SYSTEM_DIRS = ["/etc", "/proc", "/sys", "/dev", "/private/etc"];

function inPrivateLocation(projectDir: string, path: string): boolean {
  const posixPath = path.replaceAll("\\", "/");
  if (SYSTEM_DIRS.some((dir) => posixPath === dir || posixPath.startsWith(`${dir}/`))) return true;
  const segmentsPastProjectFolders = relative(projectDir, path)
    .split(/[\\/]/)
    .filter((segment) => segment !== "..");
  return segmentsPastProjectFolders.some((segment) => segment.startsWith("."));
}

/** An existing file outside the project that publish leaves out: env files, Git data, hidden and system folders. */
export function isPrivateOutsideFile(projectDir: string, absPath: string): boolean {
  const realPath = realpathSync(absPath);
  return (
    isEnvOrGitPath(absPath) ||
    isEnvOrGitPath(realPath) ||
    inPrivateLocation(projectDir, absPath) ||
    inPrivateLocation(realFilePath(projectDir), realPath)
  );
}

/** Project files no composition loads, so none is served or uploaded for one: env files, Git data, tool records. */
export function isPrivateCompositionFile(projectDir: string, filePath: string): boolean {
  return (
    isEnvOrGitPath(relative(projectDir, filePath)) ||
    isEnvOrGitPath(relative(realFilePath(projectDir), realFilePath(filePath))) ||
    isPrivateProjectFile(projectDir, filePath)
  );
}
