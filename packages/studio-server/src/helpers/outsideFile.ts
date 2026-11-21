import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, sep } from "node:path";
import { MIME_TYPES } from "./mime.js";
import {
  AUDIO_EXTS,
  CONVERTIBLE_IMAGE_EXTS,
  isControlByte,
  MEDIA_INPUT_ARGS,
  mediaInputArgs,
  startsAsMediaPlaylist,
  VIDEO_EXTS,
} from "./mediaExtensions.js";
import { realFilePath } from "./safePath.js";

export {
  AUDIO_EXTS,
  CONVERTIBLE_IMAGE_EXTS,
  MEDIA_INPUT_ARGS,
  mediaInputArgs,
  startsAsMediaPlaylist,
  VIDEO_EXTS,
};

const COPIED_TYPE = /^(?:image|video|audio|font)\/|^text\/(?:css|javascript);/;

const extensionsOf = (type: RegExp) =>
  Object.entries(MIME_TYPES)
    .filter(([, mime]) => type.test(mime))
    .map(([extension]) => extension);

/** What a local render brings in from outside the project: the preview server's image, video, audio, font, CSS and
 * JS types, and the media cloud render re-encodes or converts. */
const OUTSIDE_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  ...extensionsOf(COPIED_TYPE),
  ...VIDEO_EXTS,
  ...AUDIO_EXTS,
  ...CONVERTIBLE_IMAGE_EXTS,
]);

const SCRIPT_EXTENSIONS: ReadonlySet<string> = new Set(extensionsOf(/^text\/javascript;/));

/** What an upload copies from outside the project: the same types without scripts. */
export const UPLOADED_OUTSIDE_FILE_EXTENSIONS: ReadonlySet<string> = new Set(
  [...OUTSIDE_FILE_EXTENSIONS].filter((extension) => !SCRIPT_EXTENSIONS.has(extension)),
);

const TYPESCRIPT_OR_TRANSPORT_STREAM = new Set([".ts", ".mts"]);
const TS_SYNC_BYTE = 0x47;

const TS_PACKETS = [
  { size: 188, offset: 0 },
  { size: 192, offset: 4 },
];

function readRegularFileHead(path: string, length: number): Buffer | null {
  let fd: number;
  try {
    // A FIFO would wait for a writer on a blocking open; fstat refuses it first.
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch {
    return null;
  }
  try {
    if (!fstatSync(fd).isFile()) return null;
    const head = Buffer.alloc(length);
    return head.subarray(0, readSync(fd, head, 0, length, 0));
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

function startsAsTransportStream(path: string): boolean {
  const head = readRegularFileHead(path, 4 * 192);
  if (!head?.some(isControlByte)) return false;
  return TS_PACKETS.some(({ size, offset }) => {
    const starts = [];
    for (let at = offset; at < head.length; at += size) starts.push(at);
    return starts.length >= 2 && starts.every((at) => head[at] === TS_SYNC_BYTE);
  });
}

function isCopiedType(absPath: string, extensions: ReadonlySet<string>): boolean {
  const names = [absPath, realFilePath(absPath)].map((path) => extname(path).toLowerCase());
  if (!names.every((extension) => extensions.has(extension))) return false;
  const ambiguous = names.some((extension) => TYPESCRIPT_OR_TRANSPORT_STREAM.has(extension));
  return !ambiguous || startsAsTransportStream(absPath);
}

export const isCopiedOutsideFileType = (absPath: string): boolean =>
  isCopiedType(absPath, OUTSIDE_FILE_EXTENSIONS);

export const isUploadedOutsideFileType = (absPath: string): boolean =>
  isCopiedType(absPath, UPLOADED_OUTSIDE_FILE_EXTENSIONS);

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

/** `blocklisted`: a private location; `received`: reached from an imported file; `file_type`: not a type uploads copy; `network_share`: on another computer; `script`: a script a local render was not told to run; `not_approved`: the person has not approved uploading it. */
export type LeftOutReason =
  | "blocklisted"
  | "received"
  | "file_type"
  | "private"
  | "network_share"
  | "script"
  | "not_approved";

const WHY: Record<Exclude<LeftOutReason, "file_type">, string> = {
  private: "which holds secrets or tool data",
  blocklisted: "which is outside the project in a private location",
  received: "which leads outside the project and came in with an imported project",
  network_share: "which is on another computer's network share or is a Windows device path",
  script: "which is a script outside the project",
  not_approved: "which is outside the project and was not approved for upload",
};

export const INCLUDE_OUTSIDE_FILES_HINT = "Pass --include-outside-files to upload it.";

const COPIED_TYPES = {
  upload: "an image, video, audio, font or CSS file",
  render: "an image, video, audio, font, CSS or JS file",
};

export function leftOutWarning(
  file: string,
  reference: string,
  reason: LeftOutReason,
  from: "upload" | "render" = "upload",
): string {
  const why =
    reason === "file_type"
      ? `which is outside the project and is not ${COPIED_TYPES[from]}`
      : WHY[reason];
  const warning = `${file} references ${reference}, ${why}; it was left out of the ${from}.`;
  if (reason === "file_type") return `${warning} Move it into the project to include it.`;
  if (reason === "not_approved") return `${warning} ${INCLUDE_OUTSIDE_FILES_HINT}`;
  if (reason !== "script") return warning;
  return `${warning} Move it into the project, or pass --include-outside-files to hyperframes render, to run it.`;
}
