import { createHash } from "node:crypto";

const SINGLE_PATH_SEGMENT = /^(?!\.{1,2}$)[^/\\:]+$/;

/** The one path segment a media id names on disk: an id that already is one plain segment maps to
 * itself, and any other id to a readable form plus a digest of the whole id. */
export function mediaIdPathSegment(id: string): string {
  if (SINGLE_PATH_SEGMENT.test(id)) return id;
  const readable = id.replace(/[/\\:]/g, "_").replace(/^\.+$/, "_");
  const digest = createHash("sha256").update(id).digest("hex").slice(0, 12);
  return `${readable}~${digest}`;
}
