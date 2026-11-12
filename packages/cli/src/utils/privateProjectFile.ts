import { homedir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
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
  return (
    segmentsPastProjectFolders.some((segment) => segment.startsWith(".")) ||
    inHomeAppData(projectDir, path)
  );
}

function isUnder(path: string, ...dir: string[]): boolean {
  const lowerPath = path.toLowerCase();
  const lowerDir = join(homedir(), ...dir).toLowerCase();
  return lowerPath === lowerDir || lowerPath.startsWith(`${lowerDir}${sep}`);
}

const CLOUD_DRIVE_FOLDERS = ["Mobile Documents", "CloudStorage"];

function homeAppDataFolder(path: string): string | null {
  if (isUnder(path, "AppData")) return "AppData";
  const cloudDrive = CLOUD_DRIVE_FOLDERS.some((folder) => isUnder(path, "Library", folder));
  if (isUnder(path, "Library") && !cloudDrive) return "Library";
  return null;
}

function inHomeAppData(projectDir: string, path: string): boolean {
  const folder = homeAppDataFolder(path);
  return folder !== null && homeAppDataFolder(projectDir) !== folder;
}

/** An existing file outside the project that publish leaves out: env files, Git data, hidden, system and app-data folders. */
export function isPrivateOutsideFile(projectDir: string, absPath: string): boolean {
  const realPath = realFilePath(absPath);
  return (
    isEnvOrGitPath(absPath) ||
    isEnvOrGitPath(realPath) ||
    inPrivateLocation(projectDir, absPath) ||
    inPrivateLocation(realFilePath(projectDir), realPath)
  );
}

export function linksToPrivateOutsideFile(projectDir: string, filePath: string): boolean {
  const fromProject = relative(realFilePath(projectDir), realFilePath(filePath));
  const outside =
    fromProject === ".." || fromProject.startsWith(`..${sep}`) || isAbsolute(fromProject);
  return outside && isPrivateOutsideFile(projectDir, filePath);
}

/** Project files no composition loads, so none is served or uploaded for one: env files, Git data, tool records. */
export function isPrivateCompositionFile(projectDir: string, filePath: string): boolean {
  return (
    isEnvOrGitPath(relative(projectDir, filePath)) ||
    isEnvOrGitPath(relative(realFilePath(projectDir), realFilePath(filePath))) ||
    isPrivateProjectFile(projectDir, filePath)
  );
}
