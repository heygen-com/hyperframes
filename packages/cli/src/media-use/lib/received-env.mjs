// The media-use scripts run without the CLI's packages installed, so they keep this copy of the CLI's received-files
// rule (receivedFiles and receivedRecordStatus in packages/cli/src/utils/privateProjectFile.ts), read-only and for one
// file. receivedEnv.parity.test.ts runs both over the same projects.
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

const RECEIVED_RECORD = join(".hyperframes", "received-files.json");
const RECEIVED_CONTENT = "received-content.json";
const RECEIVED_STATE_ENV = "HYPERFRAMES_RECEIVED_STATE_FILE";
const MAX_RECORD_BYTES = 16 * 1024 * 1024;
const SHA256 = /^[0-9a-f]{64}$/;
const WALK_MAX_ENTRIES = 20_000;
const WALK_MAX_MS = 2_000;
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;
const NON_BLOCK = constants.O_NONBLOCK ?? 0;
const CODE_FILE = new Set([".html", ".htm", ".xhtml", ".css", ".js", ".mjs", ".cjs", ".svg"]);

function realpath(path) {
  try {
    return realpathSync.native(path);
  } catch (error) {
    if (error.code === "EISDIR") return realpathSync(path);
    throw error;
  }
}

function walkStart(projectDir) {
  try {
    return realpath(projectDir);
  } catch {
    return resolve(projectDir);
  }
}

function realFilePath(filePath) {
  try {
    return realpath(filePath);
  } catch {
    const dir = dirname(filePath);
    return dir === filePath ? filePath : join(realFilePath(dir), basename(filePath));
  }
}

const isAtOrUnder = (path, folder) => {
  const inside = relative(folder, path);
  return (
    inside === "" || (inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside))
  );
};

const isOutside = (fromDir) =>
  fromDir === ".." || fromDir.startsWith(`..${sep}`) || isAbsolute(fromDir);

function fileIdentity(path) {
  try {
    const stat = lstatSync(path, { bigint: true });
    return stat.ino === 0n ? null : `${stat.dev}:${stat.ino}`;
  } catch {
    return null;
  }
}

function recordKind(dir) {
  const path = join(dir, RECEIVED_RECORD);
  let found;
  try {
    found = lstatSync(path, { throwIfNoEntry: false });
  } catch (error) {
    return error.code === "ENOTDIR" ? "absent" : "unknown";
  }
  if (!found) return "absent";
  try {
    return statSync(path).isFile() ? "file" : "other";
  } catch {
    return "other";
  }
}

const strongest = (a, b) => (a === "all" ? a : b);

function hostEntry(value) {
  const { path, received, dev, ino } = value ?? {};
  if (typeof path !== "string" || !isAbsolute(path)) throw new Error("path is not absolute");
  if (received !== "expected" && received !== "all") throw new Error("unknown state");
  const identity = typeof dev === "string" && typeof ino === "string" && ino !== "0";
  return { path, received, ...(identity ? { dev, ino } : {}) };
}

function parseHostStates(text) {
  const projects = JSON.parse(text)?.projects;
  if (!Array.isArray(projects)) throw new Error("projects is not a list");
  const states = { unreadable: false, byPath: new Map(), byIdentity: new Map() };
  for (const value of projects) {
    const { path, received, dev, ino } = hostEntry(value);
    const key = walkStart(path);
    states.byPath.set(key, strongest(states.byPath.get(key), received));
    if (dev !== undefined && ino !== undefined) {
      const identity = `${dev}:${ino}`;
      states.byIdentity.set(identity, strongest(states.byIdentity.get(identity), received));
    }
  }
  return states;
}

function hostStates() {
  const file = process.env[RECEIVED_STATE_ENV];
  if (!file) return null;
  try {
    return parseHostStates(readFileSync(file, "utf-8"));
  } catch {
    return { unreadable: true, byPath: new Map(), byIdentity: new Map() };
  }
}

function hostState(dir, states) {
  if (!states) return undefined;
  if (states.unreadable) return "all";
  const named = states.byPath.get(dir);
  if (named || states.byIdentity.size === 0) return named;
  const identity = fileIdentity(dir);
  return identity === null ? undefined : states.byIdentity.get(identity);
}

function allReceivedAround(start, states) {
  if (!states) return false;
  if (states.unreadable) return true;
  const overlaps = [...states.byPath].some(
    ([path, state]) => state === "all" && (isAtOrUnder(path, start) || isAtOrUnder(start, path)),
  );
  if (overlaps) return true;
  for (let dir = start; ; dir = dirname(dir)) {
    if (hostState(dir, states) === "all") return true;
    if (dirname(dir) === dir) return false;
  }
}

function readRecord(dir, ownFolder, states) {
  const kind = recordKind(dir);
  if (kind === "absent" && hostState(dir, states) !== undefined) return { listed: undefined };
  if (kind === "absent" || (kind === "unknown" && !ownFolder)) return null;
  if (kind !== "file") return { listed: undefined };
  try {
    return { listed: JSON.parse(readFileSync(join(dir, RECEIVED_RECORD), "utf-8")).files };
  } catch {
    return { listed: undefined };
  }
}

function recordsAtOrAbove(start, states) {
  const records = [];
  for (let dir = start; ; ) {
    const record = readRecord(dir, dir === start, states);
    if (record)
      records.push({
        file: join(dir, RECEIVED_RECORD),
        root: dir,
        projectDirFromRoot: relative(dir, start).split(sep).join("/"),
        ...record,
      });
    const parent = dirname(dir);
    if (parent === dir) return records;
    dir = parent;
  }
}

function nestedRecord(start, dir, record) {
  const folder = relative(start, dir).split(sep).join("/");
  const listed = Array.isArray(record.listed)
    ? record.listed.map((entry) => (folder ? `${folder}/${String(entry)}` : String(entry)))
    : undefined;
  return { file: join(dir, RECEIVED_RECORD), root: start, projectDirFromRoot: "", listed };
}

// The parsers' projectPathSegments: a segment as a case-insensitive file system or Windows opens it.
const pathSegments = (relPath) =>
  relPath
    .normalize("NFKC")
    .toUpperCase()
    .toLowerCase()
    .replace(/\p{Default_Ignorable_Code_Point}/gu, "")
    .split(/[\\/]/)
    .map((segment) => (segment.split(":", 1)[0] ?? "").replace(/[. ]+$/, ""));

const GIT_AND_PACKAGE_FOLDERS = new Set([".git", "node_modules"]);
const STUDIO_FOLDERS = [".hyperframes/prepared-assets", ".hyperframes/requests"];
const DOWNLOADS = ".hyperframes/prepared-assets/downloads";

// The CLI walks a records folder only where Studio keeps loaded assets: its prepared-assets and requests folders.
function mayHoldLoadedFiles(start, folder) {
  const segments = pathSegments(relative(start, folder).split(sep).join("/"));
  if (GIT_AND_PACKAGE_FOLDERS.has(segments.at(-1) ?? "")) return false;
  if (!segments.includes(".hyperframes")) return true;
  if (segments.length === 1) return true;
  const path = `${segments.join("/")}/`;
  const inStudioFolder = STUDIO_FOLDERS.some((folder) => path.startsWith(`${folder}/`));
  const hidden = segments.slice(1).some((segment) => segment.startsWith("."));
  return inStudioFolder && !path.startsWith(`${DOWNLOADS}/`) && !hidden;
}

function recordsBelow(start, states) {
  const deadline = Date.now() + WALK_MAX_MS;
  let seen = 0;
  const records = [];
  const pending = [start];
  for (let dir = pending.pop(); dir !== undefined; dir = pending.pop()) {
    let folders;
    try {
      folders = readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(dir, entry.name))
        .filter((folder) => mayHoldLoadedFiles(start, folder));
    } catch {
      return null;
    }
    seen += folders.length;
    if (seen > WALK_MAX_ENTRIES || Date.now() > deadline) return null;
    const record = dir === start ? null : readRecord(dir, true, states);
    if (record) records.push(nestedRecord(start, dir, record));
    pending.push(...folders);
  }
  return records;
}

function receivedRecords(start) {
  const states = hostStates();
  const below = recordsBelow(start, states);
  if (!below) return null;
  const records = [...recordsAtOrAbove(start, states), ...below];
  if (allReceivedAround(start, states))
    records.push({ file: process.env[RECEIVED_STATE_ENV] ?? "", root: start, listed: undefined });
  return records;
}

// A plain file's text, or null for a link, a device or a missing file; `whole` is false past `maxBytes`.
function readPlainTail(path, maxBytes) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | NO_FOLLOW | NON_BLOCK);
  } catch {
    return null;
  }
  try {
    const stats = fstatSync(fd);
    const named = lstatSync(path);
    const same = named.ino === stats.ino && named.dev === stats.dev;
    if (!stats.isFile() || !named.isFile() || !same) return null;
    const length = Math.min(stats.size, maxBytes);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, stats.size - length);
    return { text: buffer.toString("utf8"), whole: length === stats.size };
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

function contentRecordKind(dir) {
  let path = dir;
  for (const [index, part] of [".hyperframes", RECEIVED_CONTENT].entries()) {
    path = join(path, part);
    try {
      const stats = lstatSync(path, { throwIfNoEntry: false });
      if (!stats) return "absent";
      if (!(index === 1 ? stats.isFile() : stats.isDirectory())) return "other";
    } catch {
      return "other";
    }
  }
  return "file";
}

// The received content hashes kept beside the record in `dir`; null when that file cannot be read.
function receivedContentHashes(dir) {
  let records;
  try {
    records = lstatSync(join(dir, ".hyperframes")).isDirectory() ? join(dir, ".hyperframes") : null;
  } catch {
    records = null;
  }
  const read = records ? readPlainTail(join(records, RECEIVED_CONTENT), MAX_RECORD_BYTES) : null;
  if (read === null) return contentRecordKind(dir) === "absent" ? [] : null;
  let saved;
  try {
    saved = read.whole ? JSON.parse(read.text) : null;
  } catch {
    saved = null;
  }
  if (saved === null || typeof saved !== "object" || Array.isArray(saved)) return null;
  const listed = Array.isArray(saved.hashes) ? saved.hashes : [];
  return listed.filter((hash) => typeof hash === "string" && SHA256.test(hash));
}

function contentHash(path) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | NO_FOLLOW | NON_BLOCK);
  } catch {
    return null;
  }
  try {
    const stat = fstatSync(fd);
    const hashable =
      stat.isFile() &&
      (stat.size <= MAX_RECORD_BYTES || CODE_FILE.has(extname(path).toLowerCase()));
    return hashable ? createHash("sha256").update(readFileSync(fd)).digest("hex") : null;
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

function listedIn(record, projectDir, start, path) {
  const listed = record.listed.map((entry) => String(entry).normalize("NFC"));
  const key = (record.projectDirFromRoot ? `${record.projectDirFromRoot}/${path}` : path).normalize(
    "NFC",
  );
  if (listed.includes(key)) return true;
  const identity = fileIdentity(join(projectDir, path));
  if (identity === null) return false;
  return listed
    .map((entry) => join(record.root, entry))
    .some((file) => isAtOrUnder(file, start) && fileIdentity(file) === identity);
}

function onDisk(path) {
  try {
    return lstatSync(path, { throwIfNoEntry: false }) !== undefined;
  } catch {
    return false;
  }
}

/** "unchecked" when the project's folders are too many to scan, "received" when the CLI's rule counts
 * `<projectDir>/<path>` as received, else null. */
export function receivedFileState(projectDir, path) {
  const start = walkStart(projectDir);
  const records = receivedRecords(start);
  if (records === null) return "unchecked";
  if (records.some((record) => !Array.isArray(record.listed))) return "received";
  const hashes = new Set();
  for (const folder of new Set(records.map((record) => dirname(dirname(record.file))))) {
    const found = receivedContentHashes(folder);
    if (found === null) return "received";
    for (const hash of found) hashes.add(hash);
  }
  if (records.some((record) => listedIn(record, projectDir, start, path))) return "received";
  const listedInProject = records
    .flatMap((record) => record.listed.map((entry) => join(record.root, String(entry))))
    .filter((file) => isAtOrUnder(file, start));
  const file = join(projectDir, path);
  const linksOutside = isOutside(relative(realFilePath(projectDir), realFilePath(file)));
  const goneFile = listedInProject.some((listed) => !onDisk(listed));
  if (goneFile && (CODE_FILE.has(extname(path).toLowerCase()) || linksOutside)) return "received";
  return hashes.size > 0 && hashes.has(contentHash(file) ?? "") ? "received" : null;
}
