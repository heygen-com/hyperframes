import { createHash } from "node:crypto";
import { open as openFile } from "node:fs/promises";

export const NOT_MEDIA_PAYLOAD = "NOT_MEDIA_PAYLOAD" as const;

/** Cap the joined fingerprint list so the message stays bounded. */
const MAX_LISTED_FINGERPRINTS = 8;

/**
 * Thrown when a file behind a `<video>`/`<audio>` src is a text document
 * (HTML, XML, SVG, JSON) rather than a media container.
 *
 * Motivating incident: STUDIO-5433 — an authoring bug produced an a-roll
 * element whose src pointed at a `streamed-preview.html` URL that downloaded
 * to a legitimate 6.5 KB `<!DOCTYPE html>` page instead of the expected MP4.
 * ffprobe's `[mov,mp4,m4a,3gp,3g2,mj2 @ ...] moov atom not found` masked the
 * cause (the `mov,mp4,…` prefix is ffprobe's demuxer probe order, not the
 * file's true format), so the alert routed as an ffmpeg/codec bug.
 *
 * Only a 2xx response reaches this classifier. `downloadToTemp` rejects a
 * 404/410 as `http_not_found` before writing a byte (urlDownloader.ts
 * `classifyHttpFailure`), and every ffprobe input is local — an http src is
 * downloaded first. So the shapes that land here are a soft-404 or
 * interstitial HTML body, an S3/CloudFront error document, or a JSON API error
 * body, each served with a success status.
 *
 * Deliberately says nothing about *why* the payload is a document: an
 * unresolved nested-composition URL and a CDN error page served with a 200
 * both land here, and naming only the first sends on-call after the wrong
 * cause.
 *
 * Message discipline mirrors `AssetMediaTypeMismatchError`: bounded text with
 * hashed element correlation keys, never the authored src or the payload's own
 * bytes — producer forwards `error.message` to API clients.
 */
export class NotMediaPayloadError extends Error {
  readonly code = NOT_MEDIA_PAYLOAD;
  readonly owner = "user" as const;
  readonly retryable = false as const;
  readonly elementFingerprints: readonly string[];

  constructor(elementFingerprints: readonly string[]) {
    const listed = elementFingerprints.slice(0, MAX_LISTED_FINGERPRINTS).join(",");
    const elided = elementFingerprints.length - MAX_LISTED_FINGERPRINTS;
    super(
      `${elementFingerprints.length} media source(s) are text documents ` +
        `(HTML/XML/JSON), not media containers ` +
        `[elements=${listed}${elided > 0 ? `,+${elided}` : ""}]. Either an unresolved ` +
        "nested-composition preview URL was authored as a media src, or the source answered with " +
        "an error page or API error body carrying a success status.",
    );
    this.name = "NotMediaPayloadError";
    this.elementFingerprints = elementFingerprints;
  }
}

/** Stable, bounded correlation key. Never the raw element id or source. */
export function fingerprintElementId(elementId: string): string {
  return createHash("sha256").update(elementId).digest("hex").slice(0, 16);
}

const SNIFF_BYTES = 512;
// `<` opens HTML/XML/SVG and an S3 `<Error>` body; `{` and `[` open a JSON API
// error body, which some gateways return with a 200.
const DOCUMENT_OPENING_BYTES = new Set([0x3c, 0x7b, 0x5b]);
// NUL is skippable so UTF-16-encoded text (`3C 00 68 00 …`) is caught, and so
// is a payload padded with NULs. No supported container is defeated by this:
// mp4/mov open with a box size whose first non-NUL byte is the size itself, and
// MPEG-PS `00 00 01 BA` stops at 0x01.
const SKIPPABLE_LEADING_BYTES = new Set([0x00, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20]);
const BYTE_ORDER_MARKS = [
  Buffer.from([0xef, 0xbb, 0xbf]), // UTF-8
  Buffer.from([0xff, 0xfe]), // UTF-16 LE
  Buffer.from([0xfe, 0xff]), // UTF-16 BE
];

function byteOrderMarkLength(head: Buffer): number {
  for (const mark of BYTE_ORDER_MARKS) {
    if (head.length >= mark.length && head.subarray(0, mark.length).equals(mark)) {
      return mark.length;
    }
  }
  return 0;
}

/** Read up to {@link SNIFF_BYTES} from the front of the file. */
async function readHead(filePath: string): Promise<Buffer> {
  const fh = await openFile(filePath, "r");
  try {
    const buf = Buffer.alloc(SNIFF_BYTES);
    let filled = 0;
    // Looped because a single read can come back short on NFS/FUSE and on
    // FIFOs, which would truncate the window mid-prefix.
    while (filled < buf.length) {
      const { bytesRead } = await fh.read(buf, filled, buf.length - filled, filled);
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    return buf.subarray(0, filled);
  } finally {
    await fh.close().catch(() => {});
  }
}

function startsWithDocumentByte(head: Buffer): boolean {
  for (let index = byteOrderMarkLength(head); index < head.length; index++) {
    const byte = head[index];
    if (byte === undefined) break;
    if (SKIPPABLE_LEADING_BYTES.has(byte)) continue;
    return DOCUMENT_OPENING_BYTES.has(byte);
  }
  // Empty or all-whitespace: not this classifier's call.
  return false;
}

/**
 * True when the file's first meaningful byte opens a text document (`<`, `{`,
 * `[`) rather than a media container. BOM- and whitespace-tolerant.
 *
 * Three bytes replace an allowlist of document shapes: `<!doctype`, `<html`,
 * `<?xml`, a prolog-less `<svg`, an S3 `<Error>` body, and a JSON
 * `{"detail": "requested file not found"}` all start with one of them, and no
 * container this pipeline supports does — mp4/mov start with a box size,
 * Matroska/WebM `1A 45 DF A3`, Ogg `OggS`, RIFF `RIFF`, MPEG-TS `0x47`, FLAC
 * `fLaC`, ADTS `FF Fx`, MP3 `ID3`. An allowlist would need a new entry every
 * time a new payload shape shows up in production.
 *
 * Never throws: this is a classifier, not a gate. An unreadable file (EACCES,
 * EISDIR, a temp file evicted between `existsSync` and here) reports "not a
 * document" so the real probe still produces the real error, exactly as it did
 * before the sniff existed.
 */
export async function isNotMediaPayload(filePath: string): Promise<boolean> {
  try {
    return startsWithDocumentByte(await readHead(filePath));
  } catch {
    return false;
  }
}

/**
 * Throw {@link NotMediaPayloadError} if `filePath` is a text document.
 *
 * Only for sources whose element type can never legitimately be one —
 * `<video>` and `<audio>`. An `<img>` src may be an SVG, which ffprobe reads
 * through its `svg_pipe` demuxer, so image sources must not be sniffed.
 */
export async function assertMediaPayload(filePath: string, elementId: string): Promise<void> {
  if (await isNotMediaPayload(filePath)) {
    throw new NotMediaPayloadError([fingerprintElementId(elementId)]);
  }
}
