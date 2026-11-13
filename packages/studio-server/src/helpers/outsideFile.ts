import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, sep } from "node:path";
import { MIME_TYPES } from "./mime.js";
import { AUDIO_EXTS, CONVERTIBLE_IMAGE_EXTS, VIDEO_EXTS } from "./mediaExtensions.js";
import { realFilePath } from "./safePath.js";

export { AUDIO_EXTS, CONVERTIBLE_IMAGE_EXTS, VIDEO_EXTS };

const COPIED_TYPE = /^(?:image|video|audio|font)\/|^text\/(?:css|javascript);/;

/** What an upload copies from outside the project: the preview server's image, video, audio, font, CSS and JS types,
 * and the media cloud render re-encodes or converts. */
export const OUTSIDE_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  ...Object.entries(MIME_TYPES)
    .filter(([, type]) => COPIED_TYPE.test(type))
    .map(([extension]) => extension),
  ...VIDEO_EXTS,
  ...AUDIO_EXTS,
  ...CONVERTIBLE_IMAGE_EXTS,
]);

const hasCopiedType = (path: string) => OUTSIDE_FILE_EXTENSIONS.has(extname(path).toLowerCase());

export const isCopiedOutsideFileType = (absPath: string): boolean =>
  hasCopiedType(absPath) && hasCopiedType(realFilePath(absPath));

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

/** `blocklisted`: a private location; `received`: reached from an imported file; `file_type`: not a type uploads copy. */
export type LeftOutReason = "blocklisted" | "received" | "file_type";

const WHY: Record<LeftOutReason, string> = {
  blocklisted: "which is outside the project in a private location",
  received: "which leads outside the project and came in with an imported project",
  file_type: "which is outside the project and is not an image, video, audio, font, CSS or JS file",
};

export function leftOutWarning(
  file: string,
  reference: string,
  reason: LeftOutReason,
  from: "upload" | "render" = "upload",
): string {
  const warning = `${file} references ${reference}, ${WHY[reason]}; it was left out of the ${from}.`;
  return reason === "file_type" ? `${warning} Move it into the project to include it.` : warning;
}
