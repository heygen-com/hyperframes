import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open as openFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { isPrivateFileUnder, isStudioPrivatePath } from "@hyperframes/core/safe-path";

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

/** A file ffmpeg reads as text art, which it would draw into video frames. */
export class TextArtMediaError extends NotMediaPayloadError {
  constructor() {
    super([]);
    this.message = "Media source is a text file, not a media container";
  }
}

/** A playlist naming a file outside its own folder or private in it, which ffmpeg would open. */
export class PlaylistLeavesFolderError extends NotMediaPayloadError {
  constructor() {
    super([]);
    this.message = "Media source is a playlist naming files outside its own folder";
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

/** Read up to {@link SNIFF_BYTES} from where ffmpeg starts reading (past ID3v2 tags), with the length from there; null when it is not a regular file or its tags never end. */
async function readHead(filePath: string): Promise<{ head: Buffer; fileSize: number } | null> {
  const fh = await openRegular(filePath);
  if (!fh) return null;
  try {
    const { size } = await fh.stat();
    const first = await readAt(fh, SNIFF_BYTES, 0);
    const start = await textStart(fh, first);
    if (start < 0) return null;
    const head = start === 0 ? first : await readAt(fh, SNIFF_BYTES, start);
    return { head, fileSize: size - start };
  } finally {
    await fh.close().catch(() => {});
  }
}

const FIRST_BOX_TYPES = new Set([
  "ftyp",
  "styp",
  "free",
  "skip",
  "wide",
  "uuid",
  "pdin",
  "moov",
  "mdat",
  "moof",
]);
const BOX_TYPE = /^[\x21-\x7e\xa9][\x21-\x7e]{3}$/;

/** A box's declared length, from its 64-bit size when its size is 1; -1 when shorter than its own header. */
function boxLength(head: Buffer, offset: number): number {
  const size = head.readUInt32BE(offset);
  if (size !== 1) return size >= 8 ? size : -1;
  if (offset + 16 > head.length) return -1;
  const largeSize = Number(head.readBigUInt64BE(offset + 8));
  return largeSize >= 16 ? largeSize : -1;
}

/** Where the box at `offset` ends, or -1 when no box header with a printable type that fits the file is there. */
function boxEnd(head: Buffer, offset: number, fileSize: number): number {
  if (offset + 8 > head.length || !BOX_TYPE.test(head.toString("latin1", offset + 4, offset + 8))) {
    return -1;
  }
  if (head.readUInt32BE(offset) === 0) return fileSize;
  const length = boxLength(head, offset);
  return length >= 0 && offset + length <= fileSize ? offset + length : -1;
}

/** An mp4/mov opening: a box an mp4 or QuickTime file can start with, then boxes that each fit the file, as far as the sniff window holds their headers. */
function opensWithMediaBox(head: Buffer, fileSize: number): boolean {
  if (!FIRST_BOX_TYPES.has(head.toString("latin1", 4, 8))) return false;
  let offset = boxEnd(head, 0, fileSize);
  while (offset >= 0 && offset < fileSize && offset + 16 <= head.length) {
    offset = boxEnd(head, offset, fileSize);
  }
  return offset >= 0;
}

function startsWithDocumentByte(head: Buffer, fileSize: number): boolean {
  if (opensWithMediaBox(head, fileSize)) return false;
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
    const sniffed = await readHead(filePath);
    return (
      !sniffed ||
      startsWithDocumentByte(sniffed.head, sniffed.fileSize) ||
      (await playlistLeavesItsFolder(filePath))
    );
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

const IMAGE_SNIFF_BYTES = 64 * 1024;
function withoutLeadingBlanks(text: string): string {
  let at = 0;
  while (at < text.length && (text[at] === "\0" || /\s/.test(text[at]!))) at++;
  return text.slice(at);
}

/** The head as text: UTF-16 behind its byte order mark is decoded, anything else read byte per character. */
function headText(head: Buffer): string {
  const [first, second] = head;
  if (first === 0xff && second === 0xfe) return head.subarray(2).toString("utf16le");
  if (first === 0xfe && second === 0xff) {
    return Buffer.from(head.subarray(2, head.length - (head.length % 2)))
      .swap16()
      .toString("utf16le");
  }
  return head.toString("latin1", byteOrderMarkLength(head));
}

function afterMarker(text: string, from: number, end: string): string | null {
  const at = text.indexOf(end, from);
  return at < 0 ? null : text.slice(at + end.length);
}

/** The text after a doctype, whose internal subset in brackets may itself hold `>`. */
function afterDoctype(text: string): string | null {
  for (let at = 9; at < text.length; at++) {
    if (text[at] === ">") return text.slice(at + 1);
    if (text[at] === "[") at = text.indexOf("]", at);
    if (at < 0) return null;
  }
  return null;
}

/** The text after one leading prolog, comment or doctype; null when none opens it or it never ends. */
function afterProlog(text: string): string | null {
  if (text.startsWith("<?")) return afterMarker(text, 2, "?>");
  if (text.startsWith("<!--")) return afterMarker(text, 4, "-->");
  return /^<!doctype\b/i.test(text) ? afterDoctype(text) : null;
}

/** Whether markup opens as an SVG; a prolog that runs past the window of a longer file is given the benefit of the doubt. */
function opensWithSvgRoot(markup: string, complete: boolean): boolean {
  let rest = withoutLeadingBlanks(markup);
  for (let next = afterProlog(rest); next !== null; next = afterProlog(rest)) {
    rest = withoutLeadingBlanks(next);
  }
  return /^<svg[\s/>]/i.test(rest) || (!complete && /^<[?!]/.test(rest));
}

/**
 * True when an `<img>` src opens as JSON or markup other than an SVG image, after the ID3v2 tags, byte order mark
 * and blanks ffmpeg and a browser skip. A binary image passes. Like {@link isNotMediaPayload}, never throws.
 */
export async function isNotImagePayload(filePath: string): Promise<boolean> {
  try {
    const fh = await openRegular(filePath);
    if (!fh) return true;
    try {
      const start = await textStart(fh, await readAt(fh, SNIFF_BYTES, 0));
      if (start < 0) return true;
      const head = await readAt(fh, IMAGE_SNIFF_BYTES, start);
      const text = withoutLeadingBlanks(headText(head));
      if (text.startsWith("{") || text.startsWith("[")) return true;
      return text.startsWith("<") && !opensWithSvgRoot(text, head.length < IMAGE_SNIFF_BYTES);
    } finally {
      await fh.close().catch(() => {});
    }
  } catch {
    return false;
  }
}

const MAX_PLAYLIST_BYTES = 8 * 1024 * 1024;
const MAX_PLAYLIST_DEPTH = 8;
// The whole walk, nested lists included, is refused past these, so its cost never depends on what a list holds.
const MAX_WALK_BYTES = 2 * MAX_PLAYLIST_BYTES;
const MAX_WALK_ENTRIES = 50_000;
const HTTP_URL = /^https?:\/\//i;
const COLON_IN_FIRST_SEGMENT = /^[^/\\?#]*:/;
const FOLDER_CUT_AT_QUERY_OR_FRAGMENT = /[?#]/;
// ffmpeg reads a name with no path before its query or fragment as the list's own path plus that suffix.
const NO_PATH = /^(?:[?#]|$)/;

// ffmpeg reads a list line into a 4096-byte buffer, so a longer line would name something else: it is refused unread.
const MAX_LIST_LINE_BYTES = 4095;
const ATTRIBUTE_GAP = /[\t\n\v\f\r ,]/;
const TRAILING_HLS_BLANK = /[\t\v\f ]/;

function withoutTrailing(line: string, isBlank: RegExp): string {
  let end = line.length;
  while (end > 0 && isBlank.test(line[end - 1]!)) end--;
  return line.slice(0, end);
}

/** The names one line can open: ffmpeg opens one, the walk checks all, and refuses the list when none is there. */
type Entry = string[];

/**
 * Every entry an HLS list can open, read as ffmpeg's hls demuxer reads it; true when a line is too long to read
 * whole. The text is latin1, one character per byte, so a line's length is its length in bytes.
 */
function hlsEntries(body: string): Entry[] | true {
  const entries = new Map<string, Entry>();
  for (const raw of body.replaceAll("\0", "\n").split(/[\r\n]/)) {
    if (raw.length > MAX_LIST_LINE_BYTES) return true;
    const line = withoutTrailing(raw, TRAILING_HLS_BLANK);
    const found = line.startsWith("#")
      ? attributeUris(line).map((uri) => [uri])
      : line
        ? [[line, line.trim()]]
        : [];
    for (const names of found.map((entry) => [...new Set(entry)])) {
      entries.set(names.join("\n"), names);
    }
  }
  return [...entries.values()];
}

// ffmpeg's concat demuxer ends a line at LF, CR or NUL; only LF and CR LF end one here, so any other CR or NUL refuses.
const LONE_CR = /\r(?!\n)/;
const CONCAT_KEYWORD = /^[\t ]*([^\t ]*)[\t ]*/;
// The `file` values `av_get_token` reads as written: a bare run with no quote or backslash, or one single-quoted run.
const CONCAT_FILE_VALUE = /^(?:'([^']+)'|([^\t '\\]+))[\t ]*$/;

/** The name an ffconcat line opens; undefined for a line that opens none; true for one ffmpeg may read otherwise. */
function concatFileName(line: string): string | true | undefined {
  const keyword = CONCAT_KEYWORD.exec(line)!;
  if (keyword[1] === "option") return true;
  if (keyword[1] !== "file") return undefined;
  const value = CONCAT_FILE_VALUE.exec(line.slice(keyword[0].length));
  return value ? (value[1] ?? value[2]!) : true;
}

function concatEntries(body: string): Entry[] | true {
  if (LONE_CR.test(body) || body.includes("\0")) return true;
  const entries: Entry[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (line.length > MAX_LIST_LINE_BYTES) return true;
    const name = concatFileName(line);
    if (name === true) return true;
    if (name !== undefined) entries.push([name]);
  }
  return entries;
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

/** The entries a list can open; true when it must be refused unread; undefined when the text is no list. */
function playlistEntries(text: string): Entry[] | true | undefined {
  const body = (text.startsWith(UTF8_BOM) ? text.slice(UTF8_BOM.length) : text).trimStart();
  if (body.startsWith("#EXTM3U")) return hlsEntries(body);
  if (/^ffconcat\s+version/i.test(body)) return concatEntries(body);
  return undefined;
}

function entryLeavesFolder(entry: string, base: string, folder: string): boolean {
  if (HTTP_URL.test(entry)) return false;
  if (FOLDER_CUT_AT_QUERY_OR_FRAGMENT.test(base)) return true;
  return [entry, percentDecoded(entry)].some((path) => {
    if (NO_PATH.test(path) || COLON_IN_FIRST_SEGMENT.test(path)) return true;
    if (isAbsolute(path) || path.startsWith("\\")) return true;
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

/** A nested name that is not there: ffmpeg opens nothing by it. An entry naming nothing that is there is refused. */
const MISSING = Symbol("missing");
type Verdict = boolean | typeof MISSING;

interface Walk {
  folder: string;
  seen: Set<string>;
  verdicts: Map<string, Verdict>;
  bytes: number;
  entries: number;
}

/**
 * True for an HLS or ffconcat list naming a file outside its folder or private in it; ffmpeg would open it.
 * `placedAt` is where the file will live when it is read from elsewhere first (a download not yet published).
 */
export async function playlistLeavesItsFolder(
  filePath: string,
  placedAt = filePath,
): Promise<boolean> {
  const placed = asBytes(resolve(placedAt));
  const walk: Walk = {
    folder: dirname(placed),
    seen: new Set(),
    verdicts: new Map(),
    bytes: 0,
    entries: 0,
  };
  try {
    return (await listLeaves(asBytes(resolve(filePath)), placed, walk, 0)) === true;
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

const id3End = (head: Buffer, offset: number): number =>
  offset + 10 + ((head[6]! << 21) | (head[7]! << 14) | (head[8]! << 7) | head[9]!);

/** Where the text starts: ffmpeg skips leading ID3v2 tags before it probes or parses a file. -1 past {@link MAX_ID3_TAGS}. */
async function textStart(fh: FileHandle, first: Buffer): Promise<number> {
  let offset = 0;
  let head = first;
  for (let tags = 0; tags <= MAX_ID3_TAGS; tags++) {
    if (!isId3Header(head)) return offset;
    offset = id3End(head, offset) + (head[5]! & 0x10 ? 10 : 0);
    head = await readAt(fh, 10, offset);
  }
  return -1;
}

const MAX_TEXT_STARTS = 64;

/** Every offset a list may be read from: ffmpeg's probe counts a tag's footer, its demuxer only for a clean v2.4 tag. */
async function textStarts(fh: FileHandle, first: Buffer): Promise<number[] | null> {
  const starts = new Set<number>();
  let tagged = [0];
  for (let tags = 0; tagged.length > 0; tags++) {
    if (tags > MAX_ID3_TAGS || tagged.length + starts.size > MAX_TEXT_STARTS) return null;
    tagged = await pastTags(fh, first, tagged, starts);
  }
  return [...starts];
}

async function pastTags(
  fh: FileHandle,
  first: Buffer,
  offsets: number[],
  starts: Set<number>,
): Promise<number[]> {
  const next = new Set<number>();
  for (const offset of offsets) {
    const head = offset === 0 ? first : await readAt(fh, 10, offset);
    if (!isId3Header(head)) starts.add(offset);
    else for (const footer of footers(head)) next.add(id3End(head, offset) + footer);
  }
  return [...next];
}

const footers = (head: Buffer): number[] => (head[5]! & 0x10 ? [0, 10] : [0]);

// Encrypted segments and keys open with random bytes, so only a real document signature counts.
const MANIFEST_SIGNATURE = /^<(\?xml|MPD\b|!DOCTYPE|html\b|SmoothStreamingMedia\b)/i;

function opensAsManifest(head: Buffer): boolean {
  return MANIFEST_SIGNATURE.test(withoutLeadingBlanks(headText(head)));
}

function startsAsPlaylist(head: Buffer): boolean {
  const text = head
    .toString("utf8")
    .replace(/^\uFEFF/, "")
    .trimStart();
  return text.startsWith("#EXTM3U") || /^ffconcat\s+version/i.test(text);
}

/** The list's text as latin1, null when the file is not a list, true when it must be refused unread (a document, when `nested`). One open. */
async function readList(path: string, nested: boolean): Promise<string | null | true> {
  const fh = await openRegular(Buffer.from(path, "latin1"));
  if (!fh) return true;
  try {
    return await listText(fh, nested);
  } finally {
    await fh.close().catch(() => {});
  }
}

async function listText(fh: FileHandle, nested: boolean): Promise<string | null | true> {
  const first = await readAt(fh, SNIFF_BYTES, 0);
  const starts = await textStarts(fh, first);
  if (!starts) return true;
  // ffmpeg's probe and demuxer can read a tagged list from different bytes, so a list behind a tag is refused.
  if (starts.length > 1 || starts[0] !== 0) return (await taggedList(fh, starts, nested)) || null;
  if (!startsAsPlaylist(first)) return nested && opensAsManifest(first) ? true : null;
  const body = await readAt(fh, MAX_PLAYLIST_BYTES + 1, 0);
  return body.length > MAX_PLAYLIST_BYTES ? true : body.toString("latin1");
}

async function taggedList(fh: FileHandle, starts: number[], nested: boolean): Promise<boolean> {
  for (const start of starts) {
    const head = await readAt(fh, SNIFF_BYTES, start);
    if (startsAsPlaylist(head) || (nested && opensAsManifest(head))) return true;
  }
  return false;
}

const isMissing = (error: unknown): boolean =>
  ["ENOENT", "ENOTDIR", "ENAMETOOLONG"].includes(
    (error as NodeJS.ErrnoException | null)?.code ?? "",
  );

/** A list's entries, counted against the walk's budget; true when the list or the walk must be refused. */
function budgetedEntries(text: string, walk: Walk): Entry[] | true {
  walk.bytes += text.length;
  const entries = playlistEntries(text) ?? [];
  if (entries === true) return true;
  walk.entries += entries.length;
  return walk.bytes > MAX_WALK_BYTES || walk.entries > MAX_WALK_ENTRIES ? true : entries;
}

/** Every list a list names is read too, against the top list's folder. A nested file that cannot be read is refused. */
async function listLeaves(
  readPath: string,
  path: string,
  walk: Walk,
  depth: number,
): Promise<Verdict> {
  const text = await readList(readPath, depth > 0).catch((error: unknown) =>
    depth === 0 ? null : isMissing(error) ? MISSING : true,
  );
  if (text === null) return false;
  if (text === MISSING) return MISSING;
  if (text === true || depth >= MAX_PLAYLIST_DEPTH) return true;
  if (walk.seen.has(path)) return false;
  walk.seen.add(path);
  const entries = budgetedEntries(text, walk);
  if (entries === true) return true;
  for (const entry of entries) {
    if (await entryLeaves(entry, dirname(path), walk, depth)) return true;
  }
  return false;
}

async function entryLeaves(
  entry: Entry,
  base: string,
  walk: Walk,
  depth: number,
): Promise<boolean> {
  if (entry.some((name) => entryLeavesFolder(name, base, walk.folder))) return true;
  const local = entry.filter((name) => !HTTP_URL.test(name));
  let found = local.length === 0;
  for (const nested of new Set(local.flatMap((name) => [name, percentDecoded(name)]))) {
    const path = resolve(base, nested);
    if (isPrivateFileUnder(walk.folder, path, isStudioPrivatePath)) return true;
    const verdict = await nestedVerdict(path, walk, depth);
    if (verdict === true) return true;
    found ||= verdict === false;
  }
  return !found;
}

async function nestedVerdict(path: string, walk: Walk, depth: number): Promise<Verdict> {
  let verdict = walk.verdicts.get(path);
  if (verdict === undefined) {
    verdict = await listLeaves(path, path, walk, depth + 1);
    walk.verdicts.set(path, verdict);
  }
  return verdict;
}
