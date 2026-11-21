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
const KEPT_RECORDS = "received-records";
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

function addNamed(map, key, received, path) {
  const known = map.get(key);
  map.set(key, {
    received: strongest(known?.received, received),
    paths: [...(known?.paths ?? []), path],
  });
}

function hostEntry(value) {
  const { path, received, dev, ino } = value ?? {};
  if (typeof path !== "string" || !isAbsolute(path)) throw new Error("path is not absolute");
  if (received !== "expected" && received !== "all") throw new Error("unknown state");
  const identity = typeof dev === "string" && typeof ino === "string" && ino !== "0";
  return { path, received, ...(identity ? { dev, ino } : {}) };
}

function parseHostStates(file, text) {
  const projects = JSON.parse(text)?.projects;
  if (!Array.isArray(projects)) throw new Error("projects is not a list");
  const states = { file, unreadable: false, byPath: new Map(), byIdentity: new Map() };
  for (const value of projects) {
    const { path, received, dev, ino } = hostEntry(value);
    addNamed(states.byPath, walkStart(path), received, path);
    if (dev !== undefined && ino !== undefined)
      addNamed(states.byIdentity, `${dev}:${ino}`, received, path);
  }
  return states;
}

function hostStates() {
  const file = process.env[RECEIVED_STATE_ENV];
  if (!file) return null;
  try {
    return parseHostStates(file, readFileSync(file, "utf-8"));
  } catch {
    return { file, unreadable: true, byPath: new Map(), byIdentity: new Map() };
  }
}

function hostState(dir, states) {
  if (!states) return undefined;
  if (states.unreadable) return "all";
  const named = states.byPath.get(dir)?.received;
  if (named || states.byIdentity.size === 0) return named;
  const identity = fileIdentity(dir);
  return identity === null ? undefined : states.byIdentity.get(identity)?.received;
}

function folderBirth(dir) {
  try {
    return String(lstatSync(dir, { bigint: true }).birthtimeNs);
  } catch {
    return "";
  }
}

// Each path the state file names the project by; one found only by dev and ino carries the folder's identity.
function namings(dir, states) {
  const byPath = new Set(states.byPath.get(dir)?.paths);
  const found = [...byPath].map((path) => ({ path }));
  const identity = states.byIdentity.size === 0 ? null : fileIdentity(dir);
  const named = identity === null ? undefined : states.byIdentity.get(identity);
  if (!named) return found;
  const kept = `${identity}:${folderBirth(dir)}`;
  const moved = [...new Set(named.paths)].filter((path) => !byPath.has(path));
  return [...found, ...moved.map((path) => ({ path, identity: kept }))];
}

function keptFilesIn(kept, { path, identity }) {
  if (kept.project !== path) return "all";
  if (identity !== undefined && kept.identity !== identity) return "all";
  const { files } = kept;
  if (kept.doubted === true || !Array.isArray(files)) return "all";
  return files.every((entry) => typeof entry === "string") ? files : "all";
}

function keptFilesFor(naming, text) {
  try {
    return keptFilesIn(JSON.parse(text) ?? {}, naming);
  } catch {
    return "all";
  }
}

// The host's kept copy of the record for one naming: its files, "all" when it cannot be trusted, null when absent.
function hostKeptRecord(stateFile, naming) {
  const name = `${createHash("sha256").update(naming.path).digest("hex")}.json`;
  const file = join(dirname(stateFile), KEPT_RECORDS, name);
  try {
    if (!lstatSync(file, { throwIfNoEntry: false })) return null;
  } catch (error) {
    return error.code === "ENOTDIR" ? null : { file, files: "all" };
  }
  const read = readPlainTail(file, MAX_RECORD_BYTES) ?? readPlainTail(file, MAX_RECORD_BYTES);
  if (!read?.whole) return onDisk(file) ? { file, files: "all" } : null;
  return { file, files: keptFilesFor(naming, read.text) };
}

function withEntriesHostKept(dir, listed, states) {
  if (!states || hostState(dir, states) !== "expected") return { listed };
  const copies = namings(dir, states).flatMap(
    (naming) => hostKeptRecord(states.file, naming) ?? [],
  );
  const unread = copies.find((copy) => copy.files === "all");
  if (unread) return { listed, unreadKeptCopy: unread.file };
  const present = new Set(listed.map(String));
  const kept = copies.flatMap((copy) => copy.files);
  const back = [...new Set(kept)].filter(
    (entry) => !present.has(entry) && onDisk(join(dir, entry)),
  );
  return { listed: back.length === 0 ? listed : [...listed, ...back] };
}

function allReceivedAtOrAbove(start, states) {
  for (let dir = start; ; dir = dirname(dir)) {
    if (hostState(dir, states) === "all") return true;
    if (dirname(dir) === dir) return false;
  }
}

function allReceivedAround(start, states) {
  if (!states) return false;
  if (states.unreadable) return true;
  const overlaps = [...states.byPath].some(
    ([path, { received }]) =>
      received === "all" && (isAtOrUnder(path, start) || isAtOrUnder(start, path)),
  );
  return overlaps || allReceivedAtOrAbove(start, states);
}

function readRecordAsWritten(dir, ownFolder, states) {
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

function readRecord(dir, ownFolder, states) {
  const record = readRecordAsWritten(dir, ownFolder, states);
  return record && Array.isArray(record.listed)
    ? withEntriesHostKept(dir, record.listed, states)
    : record;
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
  const nested = { file: join(dir, RECEIVED_RECORD), root: start, projectDirFromRoot: "", listed };
  return record.unreadKeptCopy ? { ...nested, unreadKeptCopy: record.unreadKeptCopy } : nested;
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

// The parsers' isStudioPrivatePath (packages/parsers/src/privatePath.ts), which the CLI's walk uses to skip folders.
const STUDIO_FILES = new Set([
  ".hyperframes/studio-motion.json",
  ".hyperframes/studio-manual-edits.json",
]);
const STUDIO_FOLDERS = [".hyperframes/prepared-assets", ".hyperframes/requests"];
const UNCONVERTED_PREVIEW_DOWNLOADS = ".hyperframes/prepared-assets/downloads";
const CREDENTIAL_FILES = new Set([
  ".npmrc",
  ".yarnrc",
  ".yarnrc.yml",
  ".pypirc",
  "pip.conf",
  "pip.ini",
  ".netrc",
  "_netrc",
  ".git-credentials",
  ".gitconfig",
  ".mcp.json",
  "credentials.json",
  "serviceaccountkey.json",
  "service-account.json",
  "service_account.json",
]);
const CREDENTIAL_FOLDERS = new Set([
  ".ssh",
  ".aws",
  ".gnupg",
  ".docker",
  ".kube",
  ".azure",
  ".claude",
  ".codex",
  ".cursor",
  ".agents",
  ".gemini",
  ".vscode",
  ".idea",
]);
const CREDENTIAL_CONFIG_FOLDERS = new Set(["gcloud", "gh"]);
const KEY_FILE =
  /^(?:id_(?:rsa|dsa|ecdsa|ed25519).*|.*\.(?:pem|key|p12|pfx|p8|ppk|jks|keystore|kdbx))$/;
const SECRET_STORE_FILE = /\.(?:tfstate(?:\.backup)?|tfvars(?:\.json)?)$/;
const MEDIA_FOLDER = ".media";
const BUILD_OUTPUT_FOLDERS = new Set([
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".vercel",
  ".netlify",
  ".wrangler",
  ".astro",
  ".turbo",
]);
const LOADED_ASSET_TYPE =
  /.\.(?:png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?|heic|heif|mp4|m4v|mov|webm|mkv|mxf|avi|mp3|wav|m4a|aac|ogg|oga|opus|flac|woff2?|ttf|otf|css|m?js|cjs)$/;

const isVcsOrSecretPath = (relPath) =>
  pathSegments(relPath).some((segment) => segment === ".git" || segment.startsWith(".env"));

function isCredentialOrToolStatePath(relPath) {
  const segments = pathSegments(relPath);
  const name = segments.at(-1) ?? "";
  return (
    CREDENTIAL_FILES.has(name) ||
    KEY_FILE.test(name) ||
    SECRET_STORE_FILE.test(name) ||
    segments.some(
      (segment, at) =>
        CREDENTIAL_FOLDERS.has(segment) ||
        (segment === ".config" && CREDENTIAL_CONFIG_FOLDERS.has(segments[at + 1] ?? "")),
    )
  );
}

function isStudioOwnFile(path) {
  if (
    path === UNCONVERTED_PREVIEW_DOWNLOADS ||
    path.startsWith(`${UNCONVERTED_PREVIEW_DOWNLOADS}/`)
  )
    return false;
  return (
    STUDIO_FILES.has(path) ||
    STUDIO_FOLDERS.some((folder) => path === folder || path.startsWith(`${folder}/`))
  );
}

function isStudioPrivatePath(relPath) {
  if (isVcsOrSecretPath(relPath) || isCredentialOrToolStatePath(relPath)) return true;
  const segments = pathSegments(relPath);
  const inside = !isAbsolute(relPath) && !/^\.\.[. ]*$/.test(relPath.split(/[\\/]/, 1)[0] ?? "");
  const name = segments.at(-1) ?? "";
  const loadedType = !name.startsWith(".") && LOADED_ASSET_TYPE.test(name);
  return segments.some((segment, at) => {
    const atRoot = segments.slice(0, at).every((before) => before === "");
    if (segment === ".hyperframes")
      return !atRoot || !isStudioOwnFile(segments.slice(at).join("/"));
    if (BUILD_OUTPUT_FOLDERS.has(segment)) return inside;
    const mediaFolder = atRoot && segment === MEDIA_FOLDER;
    return inside && segment.startsWith(".") && !mediaFolder && !loadedType;
  });
}

const GIT_AND_PACKAGE_FOLDERS = new Set([".git", "node_modules"]);

function mayHoldLoadedFiles(start, folder) {
  const rel = relative(start, folder).split(sep).join("/");
  const segments = pathSegments(rel);
  if (GIT_AND_PACKAGE_FOLDERS.has(segments.at(-1) ?? "")) return false;
  if (!segments.includes(".hyperframes")) return true;
  return segments.length === 1 || !isStudioPrivatePath(rel);
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

function receivedRecords(start, atOrAboveOnly) {
  const states = hostStates();
  const below = atOrAboveOnly ? [] : recordsBelow(start, states);
  if (!below) return null;
  const records = [...recordsAtOrAbove(start, states), ...below];
  const everyFile = (file) => ({ file, root: start, listed: undefined });
  records.push(...records.flatMap(({ unreadKeptCopy }) => unreadKeptCopy ?? []).map(everyFile));
  const all = atOrAboveOnly
    ? states !== null && (states.unreadable || allReceivedAtOrAbove(start, states))
    : allReceivedAround(start, states);
  if (all) records.push(everyFile(process.env[RECEIVED_STATE_ENV] ?? ""));
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

// Every received content hash beside the records; null when one of those stores cannot be read.
function receivedHashes(records) {
  const hashes = new Set();
  for (const folder of new Set(records.map((record) => dirname(dirname(record.file))))) {
    const found = receivedContentHashes(folder);
    if (found === null) return null;
    for (const hash of found) hashes.add(hash);
  }
  return hashes;
}

/** "unchecked" when the project's folders are too many to scan, "received" when the CLI's rule counts
 * `<projectDir>/<path>` as received, else null. With `atOrAboveOnly`, for a file in a folder above the one a script
 * works in, only records and host state at or above that folder count: never a sibling's or a subfolder's. */
export function receivedFileState(projectDir, path, { atOrAboveOnly = false } = {}) {
  const start = walkStart(projectDir);
  const records = receivedRecords(start, atOrAboveOnly);
  if (records === null) return "unchecked";
  if (records.some((record) => !Array.isArray(record.listed))) return "received";
  const hashes = receivedHashes(records);
  if (hashes === null) return "received";
  if (records.some((record) => listedIn(record, projectDir, start, path))) return "received";
  const file = join(projectDir, path);
  if (hashes.size > 0 && hashes.has(contentHash(file) ?? "")) return "received";
  return !atOrAboveOnly && mayBeGoneFile(records, projectDir, start, path) ? "received" : null;
}

// The CLI's rule for a listed file that is gone: a page, script or a link out of the project may have taken its place.
function mayBeGoneFile(records, projectDir, start, path) {
  const listedInProject = records
    .flatMap((record) => record.listed.map((entry) => join(record.root, String(entry))))
    .filter((file) => isAtOrUnder(file, start));
  if (!listedInProject.some((listed) => !onDisk(listed))) return false;
  if (CODE_FILE.has(extname(path).toLowerCase())) return true;
  return isOutside(relative(realFilePath(projectDir), realFilePath(join(projectDir, path))));
}
