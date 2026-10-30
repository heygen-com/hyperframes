import { extname } from "node:path";
import type { HistoryLog } from "./historyLog.js";

const MEDIA_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".m4v",
  ".webm",
  ".mkv",
  ".avi",
  ".mxf",
  ".m2ts",
  ".mp3",
  ".wav",
  ".aac",
  ".m4a",
  ".flac",
  ".ogg",
  ".opus",
]);
const COPY_NOTHING_ABOVE_BYTES = 64 * 1024 ** 2;

/** Video, audio and any file over 64 MiB are hashed in place, never copied into history. */
export const isUncopied = (path: string, size: number): boolean =>
  size > COPY_NOTHING_ABOVE_BYTES || MEDIA_EXTENSIONS.has(extname(path).toLowerCase());

/** Hashes whose every reference in the log is a file that is no longer copied: their old blobs can go. */
export function uncopiedOnlyHashes(log: HistoryLog, sizeOf: (hash: string) => number): string[] {
  const copied = new Set<string>();
  const uncopied = new Set<string>();
  const note = (path: string, hash: string | null) => {
    if (hash) (isUncopied(path, sizeOf(hash)) ? uncopied : copied).add(hash);
  };
  for (const [path, hash] of log.baseline) note(path, hash);
  for (const entry of log.entries)
    for (const file of entry.files) {
      note(file.path, file.before);
      note(file.path, file.after);
    }
  return [...uncopied].filter((hash) => !copied.has(hash));
}
