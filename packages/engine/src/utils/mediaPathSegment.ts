import { createHash } from "node:crypto";

const PLAIN_SEGMENT = /^(?!\.{1,2}$)[^/\\:]+$/;
const GENERATED_SUFFIX = /~[0-9a-f]{12}$/;
const READABLE_MAX_BYTES = 64;

/**
 * The one path segment a media id names on disk. A plain segment maps to itself. Any other id,
 * including a plain one that already ends like a generated name, maps to a byte-capped readable
 * form plus a digest of the whole id, so the two namespaces never meet.
 */
export function mediaIdPathSegment(id: string): string {
  if (PLAIN_SEGMENT.test(id) && !GENERATED_SUFFIX.test(id)) return id;
  const readable = truncateUtf8(id.replace(/[/\\:]/g, "_"), READABLE_MAX_BYTES);
  const digest = createHash("sha256").update(id).digest("hex").slice(0, 12);
  return `${readable}~${digest}`;
}

function truncateUtf8(text: string, maxBytes: number): string {
  let bytes = 0;
  let out = "";
  for (const char of text) {
    bytes += Buffer.byteLength(char, "utf8");
    if (bytes > maxBytes) break;
    out += char;
  }
  return out;
}
