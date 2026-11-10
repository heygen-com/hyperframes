import { createHash } from "node:crypto";

const SINGLE_PATH_SEGMENT = /^(?!\.{1,2}$)[^/\\:]+$/;

/**
 * The single directory or file-name segment that stands for a media element id on disk.
 *
 * Media ids come from composition markup, so one can carry separators or be `.`/`..`. An id that
 * is already one plain segment is returned unchanged; any other id keeps a readable form plus a
 * digest of the full id, so distinct ids never share a path and every caller derives the same one.
 */
export function mediaIdPathSegment(id: string): string {
  if (SINGLE_PATH_SEGMENT.test(id)) return id;
  const readable = id.replace(/[/\\:]/g, "_").replace(/^\.+$/, "_");
  const digest = createHash("sha256").update(id).digest("hex").slice(0, 12);
  return `${readable}~${digest}`;
}
