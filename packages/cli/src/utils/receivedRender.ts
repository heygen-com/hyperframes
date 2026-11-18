import { closeSync, openSync, readdirSync, readSync, statSync, type Dirent } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { isPathInside, terminalText } from "@hyperframes/core";
import { namesAnotherNetworkRoot } from "@hyperframes/parsers/asset-resolution";
import { linksOutside, mayHoldLoadedFiles, receivedRecordStatus } from "./privateProjectFile.js";
import { contentHash } from "./receivedContent.js";
import { walkBudget } from "./walkBudget.js";
import {
  htmlReferences,
  cssReferences,
  isFile,
  isPageOrStylesheet,
  readHead,
  realOrNull,
  referencePath,
  type Reference,
} from "./fileReferences.js";

const MAX_SCANNED_FILES = 500;

interface OutsideReferences {
  assets: Set<string>;
  compositions: Set<string>;
  complete: boolean;
}

function referencesIn(found: OutsideReferences, file: string): Reference[] {
  const read = readHead(file);
  if (read === null || !read.whole) found.complete = false;
  if (read === null) return [];
  return /\.css$/i.test(file) ? cssReferences(read.text) : htmlReferences(read.text);
}

const noteOutside = (found: OutsideReferences, ref: Reference) =>
  (ref.composition ? found.compositions : found.assets).add(ref.raw);

function noteReference(
  found: OutsideReferences,
  ref: Reference,
  path: string,
  projectDir: string,
): string | null {
  try {
    if (linksOutside(projectDir, path)) {
      noteOutside(found, ref);
      return null;
    }
  } catch {
    found.complete = false;
    return null;
  }
  return ref.follow && isPageOrStylesheet(path) ? path : null;
}

function scanFile(found: OutsideReferences, file: string, projectDir: string): string[] {
  const next: string[] = [];
  for (const ref of referencesIn(found, file)) {
    const path = referencePath(ref, file, projectDir);
    if (path === null) continue;
    if (namesAnotherNetworkRoot(projectDir, path)) {
      noteOutside(found, ref);
      continue;
    }
    if (!isFile(path)) continue;
    const follow = noteReference(found, ref, path, projectDir);
    if (follow !== null) next.push(follow);
  }
  return next;
}

// Names the references outside the project in the entry and the compositions and stylesheets it pulls in; only the notice reads it.
function outsideReferences(projectDir: string, entryFile: string): OutsideReferences {
  const found: OutsideReferences = {
    assets: new Set(),
    compositions: new Set(),
    complete: true,
  };
  const visited = new Set<string>();
  const pending = [resolve(projectDir, entryFile)];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (!isPathInside(file, projectDir)) continue;
    const real = realOrNull(file);
    if (real === null || visited.has(real)) continue;
    if (visited.size >= MAX_SCANNED_FILES) {
      found.complete = false;
      break;
    }
    visited.add(real);
    pending.push(...scanFile(found, file, projectDir));
  }
  return found;
}

function refusedReferences(found: OutsideReferences): string {
  const parts: string[] = [];
  if (found.assets.size > 0) parts.push(` It leaves out ${[...found.assets].join(", ")}.`);
  if (found.compositions.size > 0) {
    parts.push(
      ` It stops on the compositions ${[...found.compositions].join(", ")}; move them into the project to render them.`,
    );
  }
  if (!found.complete) parts.push(" Some files could not be checked for references.");
  return parts.join("");
}

const SIGNATURE_BYTES = 16;

const ascii = (bytes: Buffer, at: number, text: string) =>
  bytes.toString("latin1", at, at + text.length) === text;
const startsWith = (bytes: Buffer, ...values: number[]) =>
  values.every((value, index) => bytes[index] === value);
const isoMedia = (bytes: Buffer) =>
  ["ftyp", "moov", "mdat", "wide", "free", "skip"].some((box) => ascii(bytes, 4, box));
const riff = (form: string) => (bytes: Buffer) => ascii(bytes, 0, "RIFF") && ascii(bytes, 8, form);
const ebml = (bytes: Buffer) => startsWith(bytes, 0x1a, 0x45, 0xdf, 0xa3);
const mpegAudio = (bytes: Buffer) =>
  ascii(bytes, 0, "ID3") || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0);
const adts = (bytes: Buffer) =>
  ascii(bytes, 0, "ADIF") || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xf6) === 0xf0);
const avif = (bytes: Buffer) =>
  ascii(bytes, 4, "ftyp") && ["avif", "avis", "mif1"].some((brand) => ascii(bytes, 8, brand));

// Each media, font or image extension and the leading bytes a file of that type starts with.
const MEDIA_SIGNATURES: Record<string, (bytes: Buffer) => boolean> = {
  ".mp4": isoMedia,
  ".m4v": isoMedia,
  ".m4a": isoMedia,
  ".mov": isoMedia,
  ".webm": ebml,
  ".mkv": ebml,
  ".mp3": mpegAudio,
  ".wav": riff("WAVE"),
  ".ogg": (bytes) => ascii(bytes, 0, "OggS"),
  ".flac": (bytes) => ascii(bytes, 0, "fLaC"),
  ".aac": adts,
  ".png": (bytes) => startsWith(bytes, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
  ".jpg": (bytes) => startsWith(bytes, 0xff, 0xd8, 0xff),
  ".jpeg": (bytes) => startsWith(bytes, 0xff, 0xd8, 0xff),
  ".gif": (bytes) => ascii(bytes, 0, "GIF87a") || ascii(bytes, 0, "GIF89a"),
  ".webp": riff("WEBP"),
  ".avif": avif,
  ".woff": (bytes) => ascii(bytes, 0, "wOFF"),
  ".woff2": (bytes) => ascii(bytes, 0, "wOF2"),
  ".ttf": (bytes) => startsWith(bytes, 0x00, 0x01, 0x00, 0x00) || ascii(bytes, 0, "true"),
  ".otf": (bytes) => ascii(bytes, 0, "OTTO"),
};

function firstBytes(path: string): Buffer | null {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const head = Buffer.alloc(SIGNATURE_BYTES);
    return head.subarray(0, readSync(fd, head, 0, SIGNATURE_BYTES, 0));
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function isMediaFontOrImage(path: string): boolean {
  const matches = MEDIA_SIGNATURES[extname(path).toLowerCase()];
  const bytes = matches && isFile(path) ? firstBytes(path) : null;
  return bytes !== null && matches !== undefined && matches(bytes);
}

interface Target {
  identity: string;
  isDirectory: boolean;
}

const NOTHING_THERE = new Set(["ENOENT", "ENOTDIR", "ELOOP"]);

// What a path reaches with links followed; "missing" when nothing can be read through it, null when its identity is unknown.
function targetOf(path: string): Target | "missing" | null {
  try {
    const stat = statSync(path, { bigint: true });
    if (stat.ino === 0n) return null;
    return { identity: `${stat.dev}:${stat.ino}`, isDirectory: stat.isDirectory() };
  } catch (error) {
    return NOTHING_THERE.has((error as NodeJS.ErrnoException).code ?? "") ? "missing" : null;
  }
}

function receivedIdentities(listed: string[]): Set<string> | null {
  const identities = new Set<string>();
  for (const path of listed) {
    const target = targetOf(path);
    if (target === null || target === "missing" || target.isDirectory) return null;
    identities.add(target.identity);
  }
  return identities;
}

function listDir(dir: string): Dirent[] | null {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
}

export const isMediaName = (path: string): boolean =>
  MEDIA_SIGNATURES[extname(path).toLowerCase()] !== undefined;

// A linked folder is checked when it leads to a folder inside the project, which the walk lists under its own name.
function linkedFolderChecked(path: string, realProjectDir: string): boolean {
  const real = realOrNull(path);
  return real !== null && isPathInside(real, realProjectDir);
}

// The entry's path when it reaches a received file under a name that is not media; undefined when that cannot be told.
function receivedAlias(
  dir: string,
  entry: Dirent,
  received: ReadonlySet<string>,
  realProjectDir: string,
): string | null | undefined {
  const path = join(dir, entry.name);
  if (isMediaName(path) && !entry.isSymbolicLink()) return null;
  const target = targetOf(path);
  if (target === "missing") return null;
  if (target === null) return undefined;
  if (target.isDirectory) return linkedFolderChecked(path, realProjectDir) ? null : undefined;
  return !isMediaName(path) && received.has(target.identity) ? path : null;
}

interface AliasWalk {
  received: ReadonlySet<string>;
  realProjectDir: string;
  pending: string[];
  aliases: string[];
}

// Queues the folder's subfolders and records its aliases; false when an entry cannot be checked.
function walkListing(walk: AliasWalk, dir: string, listing: Dirent[]): boolean {
  for (const entry of listing) {
    if (entry.isDirectory()) {
      walk.pending.push(join(dir, entry.name));
      continue;
    }
    const alias = receivedAlias(dir, entry, walk.received, walk.realProjectDir);
    if (alias === undefined) return false;
    if (alias !== null) walk.aliases.push(alias);
  }
  return true;
}

// Project files that reach a received file, links followed, under a name that is not media; null when the walk could not check every file, including one through a linked folder that leads outside the project.
function nonMediaAliases(projectDir: string, received: ReadonlySet<string>): string[] | null {
  const withinBudget = walkBudget();
  const realProjectDir = realOrNull(projectDir) ?? projectDir;
  const walk: AliasWalk = { received, realProjectDir, pending: [projectDir], aliases: [] };
  for (let dir = walk.pending.pop(); dir !== undefined; dir = walk.pending.pop()) {
    const listing = listDir(dir);
    if (listing === null || !withinBudget(listing.length)) return null;
    if (!walkListing(walk, dir, listing)) return null;
  }
  return walk.aliases;
}

interface Refusal {
  reason: string;
  alwaysWarn: boolean;
}

const READS_NOTHING_OUTSIDE = "so the render reads nothing outside the project.";

function holderIn(
  dir: string,
  listing: Dirent[],
  walk: { projectDir: string; known: Set<string>; pending: string[] },
) {
  for (const entry of listing) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (mayHoldLoadedFiles(walk.projectDir, path)) walk.pending.push(path);
    } else if (entry.isFile() && !isMediaName(path) && walk.known.has(contentHash(path) ?? "")) {
      return path;
    }
  }
  return undefined;
}

function receivedContentHolder(projectDir: string, hashes: string[]): string | null | undefined {
  if (hashes.length === 0) return undefined;
  const withinBudget = walkBudget();
  const walk = { projectDir, known: new Set(hashes), pending: [projectDir] };
  for (let dir = walk.pending.pop(); dir !== undefined; dir = walk.pending.pop()) {
    const listing = listDir(dir);
    if (listing === null || !withinBudget(listing.length)) return null;
    const holder = holderIn(dir, listing, walk);
    if (holder !== undefined) return holder;
  }
  return undefined;
}

function receivedContentRefusal(projectDir: string, hashes: string[]): Refusal | null {
  const holder = receivedContentHolder(projectDir, hashes);
  if (holder === undefined) return null;
  if (holder === null) {
    const reason = `Could not check every project file for content that came from someone else, ${READS_NOTHING_OUTSIDE}`;
    return { reason, alwaysWarn: true };
  }
  const shown = relative(realOrNull(projectDir) ?? projectDir, holder);
  const reason = `${shown} holds the content of a file that came from someone else, ${READS_NOTHING_OUTSIDE}`;
  return { reason, alwaysWarn: false };
}

function nonMediaRefusal(listed: string[], shown: (path: string) => string): Refusal | null {
  const nonMedia = listed.find((path) => !isMediaFontOrImage(path));
  if (nonMedia === undefined) return null;
  const what = isFile(nonMedia)
    ? "is not a media, font or image file"
    : "is gone but still listed; take its line out of the received-files record that lists it to clear this";
  const reason = `${shown(nonMedia)} came from someone else and ${what}, ${READS_NOTHING_OUTSIDE}`;
  return { reason, alwaysWarn: false };
}

function receivedRefusal(
  projectDir: string,
  record: { path: string; listed: string[] | null; hashes: string[] } | "unchecked",
): Refusal | null {
  const shown = (path: string) => relative(realOrNull(projectDir) ?? projectDir, path);
  if (record === "unchecked") {
    const reason = `Could not check every project folder for a received-files record, ${READS_NOTHING_OUTSIDE}`;
    return { reason, alwaysWarn: true };
  }
  if (record.listed === null) {
    return { reason: `Could not read ${record.path}, ${READS_NOTHING_OUTSIDE}`, alwaysWarn: true };
  }
  const listedRefusal = nonMediaRefusal(record.listed, shown);
  if (listedRefusal !== null) return listedRefusal;
  const contentRefusal = receivedContentRefusal(projectDir, record.hashes);
  if (contentRefusal !== null || record.listed.length === 0) return contentRefusal;
  const received = receivedIdentities(record.listed);
  const aliases = received === null ? null : nonMediaAliases(projectDir, received);
  if (aliases === null) {
    const reason = `Could not check every project file for another name of a received file, ${READS_NOTHING_OUTSIDE}`;
    return { reason, alwaysWarn: true };
  }
  const [alias] = aliases;
  if (alias === undefined) return null;
  const reason = `${shown(alias)} is another name for a file that came from someone else, ${READS_NOTHING_OUTSIDE}`;
  return { reason, alwaysWarn: false };
}

/** False when a received-files record of the project, an ancestor or a folder under the project cannot be read or found, lists a received file that is not positively media, a font or an image by extension and leading bytes, or a project file reaches a received file under another kind of name; `warn` then says why and names the references outside the project it refuses. */
export function outsideAssetsAllowed(
  projectDir: string,
  entryFile: string | undefined,
  warn: (line: string) => void,
): boolean {
  const absProjectDir = resolve(projectDir);
  const record = receivedRecordStatus(absProjectDir);
  const refusal = record === null ? null : receivedRefusal(absProjectDir, record);
  if (refusal === null) return true;
  const refused = refusedReferences(outsideReferences(absProjectDir, entryFile ?? "index.html"));
  if (refusal.alwaysWarn || refused !== "") warn(terminalText(`${refusal.reason}${refused}`));
  return false;
}
