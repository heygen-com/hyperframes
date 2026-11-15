import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open as openFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

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
 * `classifyHttpFailure`), and an authored http src is downloaded first (a cloud-held
 * project file is read by URL, which the sniff cannot open). So the shapes that land here are a soft-404 or
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
        `(HTML/XML/JSON, or a playlist naming files outside its own folder), not media containers ` +
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
// is a payload padded with NULs. An mp4/mov box header is recognised before
// skipping, since its size byte can read as `<`; MPEG-PS `00 00 01 BA` stops at 0x01.
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

type FileHandle = Awaited<ReturnType<typeof openFile>>;

async function readAt(fh: FileHandle, bytes: number, position: number): Promise<Buffer> {
  const buf = Buffer.alloc(bytes);
  let filled = 0;
  // Looped because a single read can come back short on NFS/FUSE and on
  // FIFOs, which would truncate the window mid-prefix.
  while (filled < buf.length) {
    const { bytesRead } = await fh.read(buf, filled, buf.length - filled, position + filled);
    if (bytesRead === 0) break;
    filled += bytesRead;
  }
  return buf.subarray(0, filled);
}

const OPEN_WITHOUT_WAITING = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0);

/** Opens without waiting on a FIFO or device, and gives null for one. A folder opens, and reading it fails as before. */
async function openRegular(path: string | Buffer): Promise<FileHandle | null> {
  const fh = await openFile(path, OPEN_WITHOUT_WAITING);
  try {
    const stats = await fh.stat();
    if (stats.isFile() || stats.isDirectory()) return fh;
  } catch (error) {
    await fh.close().catch(() => {});
    throw error;
  }
  await fh.close().catch(() => {});
  return null;
}

/** Read up to {@link SNIFF_BYTES} from the front of the file; null when it is not a regular file. */
async function readHead(filePath: string): Promise<Buffer | null> {
  const fh = await openRegular(filePath);
  if (!fh) return null;
  try {
    return await readAt(fh, SNIFF_BYTES, 0);
  } finally {
    await fh.close().catch(() => {});
  }
}

const BMFF_BOX_TYPES = new Set([
  "ftyp",
  "styp",
  "moov",
  "moof",
  "mdat",
  "free",
  "skip",
  "wide",
  "sidx",
  "pdin",
]);

function opensWithMediaBox(head: Buffer): boolean {
  if (head.length < 8) return false;
  const size = head.readUInt32BE(0);
  return (size < 2 || size >= 8) && BMFF_BOX_TYPES.has(head.toString("latin1", 4, 8));
}

function startsWithDocumentByte(head: Buffer): boolean {
  if (opensWithMediaBox(head)) return false;
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
    const head = await readHead(filePath);
    return !head || startsWithDocumentByte(head) || (await playlistLeavesItsFolder(filePath));
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

const MAX_PLAYLIST_BYTES = 8 * 1024 * 1024;
const MAX_PLAYLIST_DEPTH = 8;
const HTTP_URL = /^https?:\/\//i;
const OTHER_SCHEME = /^[a-z][a-z0-9+.-]+:/i;
const DRIVE_PATH = /^[a-z]:[\\/]/i;

// ffmpeg reads a playlist line into a 4096-byte buffer and drops the rest of it.
const MAX_HLS_LINE_BYTES = 4095;
const ATTRIBUTE_GAP = /[\t\n\v\f\r ,]/;

/**
 * Every name an HLS list can open, read as ffmpeg's hls demuxer reads it and also as written.
 * The text is latin1, one character per byte, so a line is cut where ffmpeg cuts it.
 */
function hlsEntries(body: string): string[] {
  const names = new Set<string>();
  for (const raw of body.replaceAll("\0", "\n").split(/[\r\n]/)) {
    for (const whole of new Set([raw, raw.slice(0, MAX_HLS_LINE_BYTES)])) {
      const line = whole.replace(/[\t\v\f ]+$/, "");
      const found = line.startsWith("#") ? attributeUris(line) : [line, line.trim()];
      for (const name of found) if (name) names.add(name);
    }
  }
  return [...names];
}

/** `URI=` values of a tag, split as ffmpeg's `ff_parse_key_value` splits them. */
function attributeUris(line: string): string[] {
  const uris: string[] = [];
  let at = line.indexOf(":") + 1;
  while (at > 0 && at < line.length) {
    while (at < line.length && ATTRIBUTE_GAP.test(line[at]!)) at++;
    const equals = line.indexOf("=", at);
    if (equals < 0) break;
    const [value, next] = attributeValue(line, equals + 1);
    if (line.slice(at, equals).toUpperCase() === "URI") uris.push(value);
    at = next;
  }
  return uris;
}

/** A quoted value drops its quotes and the backslash before any character; a bare one ends at a space or comma. */
function attributeValue(line: string, at: number): [string, number] {
  if (line[at] !== '"') {
    let end = at;
    while (end < line.length && !ATTRIBUTE_GAP.test(line[end]!)) end++;
    return [line.slice(at, end), end];
  }
  let value = "";
  let index = at + 1;
  for (; index < line.length && line[index] !== '"'; index++) {
    if (line[index] === "\\") {
      if (index + 1 >= line.length) break;
      index++;
    }
    value += line[index];
  }
  return [value, line[index] === '"' ? index + 1 : index];
}

const UTF8_BOM = "\xEF\xBB\xBF";

function playlistEntries(text: string): string[] | undefined {
  const body = (text.startsWith(UTF8_BOM) ? text.slice(UTF8_BOM.length) : text).trimStart();
  if (body.startsWith("#EXTM3U")) return hlsEntries(body);
  if (/^ffconcat\s+version/i.test(body)) {
    return body.split(/\r?\n/).flatMap((raw) => {
      const match = /^\s*file\s+(.*)$/.exec(raw);
      if (!match) return [];
      const value = match[1]!.trim();
      return [value.startsWith("'") ? value.slice(1, -1).replace(/\\(.)/g, "$1") : value];
    });
  }
  return undefined;
}

function entryLeavesFolder(entry: string, base: string, folder: string): boolean {
  if (HTTP_URL.test(entry)) return false;
  if (OTHER_SCHEME.test(entry) && !DRIVE_PATH.test(entry)) return true;
  return [entry, percentDecoded(entry)].some((path) => {
    if (isAbsolute(path) || DRIVE_PATH.test(path) || path.startsWith("\\")) return true;
    const inside = relative(folder, resolve(base, path));
    return (
      inside === ".." || inside.startsWith("../") || inside.startsWith("..\\") || isAbsolute(inside)
    );
  });
}

/** `%XX` escapes decoded to the byte they name, kept as latin1 like every other name here. */
function percentDecoded(value: string): string {
  return value.replace(/%([0-9a-f]{2})/gi, (_escape, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

/** Paths are walked as latin1 strings, one character per byte, and opened by those bytes. */
const asBytes = (path: string): string => Buffer.from(path).toString("latin1");

interface Walk {
  folder: string;
  seen: Set<string>;
  verdicts: Map<string, boolean>;
}

/**
 * True for an HLS or ffconcat list naming a file outside its folder; ffmpeg would open it. Never throws.
 * `placedAt` is where the file will live when it is read from elsewhere first (a download not yet published).
 */
export async function playlistLeavesItsFolder(
  filePath: string,
  placedAt = filePath,
): Promise<boolean> {
  const placed = asBytes(resolve(placedAt));
  const walk: Walk = { folder: dirname(placed), seen: new Set(), verdicts: new Map() };
  try {
    return await listLeaves(asBytes(resolve(filePath)), placed, walk, 0);
  } catch {
    return false;
  }
}

const MAX_ID3_TAGS = 16;

function isId3Header(head: Buffer): boolean {
  return (
    head.length >= 10 &&
    head.toString("latin1", 0, 3) === "ID3" &&
    head[3] !== 0xff &&
    head[4] !== 0xff &&
    head.subarray(6, 10).every((byte) => byte < 0x80)
  );
}

/** Where the text starts: ffmpeg skips leading ID3v2 tags before it probes or parses a file. -1 past {@link MAX_ID3_TAGS}. */
async function textStart(fh: FileHandle, first: Buffer): Promise<number> {
  let offset = 0;
  let head = first;
  for (let tags = 0; tags <= MAX_ID3_TAGS; tags++) {
    if (!isId3Header(head)) return offset;
    const size = (head[6]! << 21) | (head[7]! << 14) | (head[8]! << 7) | head[9]!;
    offset += 10 + size + (head[5]! & 0x10 ? 10 : 0);
    head = await readAt(fh, 10, offset);
  }
  return -1;
}

function startsAsPlaylist(head: Buffer): boolean {
  const text = head
    .toString("utf8")
    .replace(/^\uFEFF/, "")
    .trimStart();
  return text.startsWith("#EXTM3U") || /^ffconcat\s+version/i.test(text);
}

/** The list's text as latin1, null when the file is not a list, true when it must be refused unread. One open. */
async function readList(path: string): Promise<string | null | true> {
  const fh = await openRegular(Buffer.from(path, "latin1"));
  if (!fh) return true;
  try {
    const first = await readAt(fh, SNIFF_BYTES, 0);
    const start = await textStart(fh, first);
    if (start < 0) return true;
    if (!startsAsPlaylist(start === 0 ? first : await readAt(fh, SNIFF_BYTES, start))) return null;
    const body = await readAt(fh, MAX_PLAYLIST_BYTES + 1, start);
    return body.length > MAX_PLAYLIST_BYTES ? true : body.toString("latin1");
  } finally {
    await fh.close().catch(() => {});
  }
}

const isMissing = (error: unknown): boolean =>
  ["ENOENT", "ENOTDIR", "ENAMETOOLONG"].includes(
    (error as NodeJS.ErrnoException | null)?.code ?? "",
  );

/** Every list a list names is read too, against the top list's folder. A nested file that exists but cannot be read is refused. */
async function listLeaves(
  readPath: string,
  path: string,
  walk: Walk,
  depth: number,
): Promise<boolean> {
  const text = await readList(readPath).catch((error: unknown) =>
    depth > 0 && !isMissing(error) ? true : null,
  );
  if (text === null) return false;
  if (text === true || depth >= MAX_PLAYLIST_DEPTH) return true;
  if (walk.seen.has(path)) return false;
  walk.seen.add(path);
  for (const entry of playlistEntries(text) ?? []) {
    if (await entryLeaves(entry, dirname(path), walk, depth)) return true;
  }
  return false;
}

async function entryLeaves(
  entry: string,
  base: string,
  walk: Walk,
  depth: number,
): Promise<boolean> {
  if (entryLeavesFolder(entry, base, walk.folder)) return true;
  if (HTTP_URL.test(entry)) return false;
  for (const local of new Set([entry, percentDecoded(entry)])) {
    const nested = resolve(base, local);
    let verdict = walk.verdicts.get(nested);
    if (verdict === undefined) {
      verdict = await listLeaves(nested, nested, walk, depth + 1);
      walk.verdicts.set(nested, verdict);
    }
    if (verdict) return true;
  }
  return false;
}
