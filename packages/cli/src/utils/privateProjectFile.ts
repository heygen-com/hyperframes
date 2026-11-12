import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { isPrivateProjectFile, realFilePath } from "@hyperframes/studio-server/safe-path";

const ENV_FILE = /^\.env([._-].*|rc)?$/;

export function isEnvOrGitPath(path: string): boolean {
  const segments = path.toLowerCase().split(/[\\/]/);
  return segments.includes(".git") || ENV_FILE.test(segments.at(-1) ?? "");
}

const SYSTEM_DIRS = ["/etc", "/proc", "/sys", "/dev", "/private/etc"];

const isOutside = (fromDir: string) =>
  fromDir === ".." || fromDir.startsWith(`..${sep}`) || isAbsolute(fromDir);

function inPrivateLocation(projectDir: string, path: string): boolean {
  const posixPath = path.replaceAll("\\", "/");
  if (SYSTEM_DIRS.some((dir) => posixPath === dir || posixPath.startsWith(`${dir}/`))) return true;
  const fromParent = relative(dirname(projectDir), path);
  return (
    (isOutside(fromParent) ? path : fromParent).split(/[\\/]/).some((s) => s.startsWith(".")) ||
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
  const parent = dirname(projectDir);
  return (
    folder !== null && (homeAppDataFolder(parent) !== folder || isOutside(relative(parent, path)))
  );
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

export const linksOutside = (projectDir: string, filePath: string): boolean =>
  isOutside(relative(realFilePath(projectDir), realFilePath(filePath)));

export function linksToPrivateOutsideFile(projectDir: string, filePath: string): boolean {
  return linksOutside(projectDir, filePath) && isPrivateOutsideFile(projectDir, filePath);
}

export function receivedFiles(projectDir: string): (path: string) => boolean {
  let listed: unknown;
  try {
    listed = JSON.parse(
      readFileSync(join(projectDir, ".hyperframes", "received-files.json"), "utf-8"),
    ).files;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return () => false;
  }
  if (!Array.isArray(listed)) return () => true;
  const files = new Set(listed.map((path) => String(path).normalize("NFC")));
  return (path) => files.has(path.normalize("NFC"));
}

/** Project files no composition loads, so none is served or uploaded for one: env files, Git data, tool records. */
export function isPrivateCompositionFile(projectDir: string, filePath: string): boolean {
  return (
    isEnvOrGitPath(relative(projectDir, filePath)) ||
    isEnvOrGitPath(relative(realFilePath(projectDir), realFilePath(filePath))) ||
    isPrivateProjectFile(projectDir, filePath)
  );
}
