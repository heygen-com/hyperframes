import {
  closeSync,
  fstatSync,
  type Dirent,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  isEnvOrGitPath,
  isPrivateOutsideFile,
  linksOutside,
} from "@hyperframes/studio-server/outside-file";
import { isPrivateProjectFile, realFilePath } from "@hyperframes/studio-server/safe-path";
import {
  isCredentialOrToolStatePath,
  isStudioPrivatePath,
  projectPathSegments,
  realpath,
} from "@hyperframes/core/safe-path";
import { registryRoot } from "../registry/publication.js";
import { readPlainTail, recordFolder, writeRecord } from "./projectRecords.js";
import { walkBudget } from "./walkBudget.js";
import {
  contentHash,
  isCodeFile,
  readReceivedContent,
  type ReceivedContent,
  receivedContentFile,
  writeReceivedContent,
} from "./receivedContent.js";

export { isEnvOrGitPath, isPrivateOutsideFile, linksOutside };

export function linksToPrivateOutsideFile(projectDir: string, filePath: string): boolean {
  return linksOutside(projectDir, filePath) && isPrivateOutsideFile(projectDir, filePath);
}

const RECEIVED_RECORD = join(".hyperframes", "received-files.json");
const RECEIVED_RECORD_LOCK = `${RECEIVED_RECORD}.lock`;
const LOCK_WAIT_MS = 2_000;
const LOCK_STALE_MS = 10_000;
const LOCK_CLOCK_SLACK_MS = 1_000;

interface ReceivedRecord {
  file: string;
  root: string;
  projectDirFromRoot: string;
  listed: unknown;
  unreadKeptCopy?: string;
}

interface ReadRecord {
  listed: unknown;
  unreadKeptCopy?: string;
}

type RecordKind = "absent" | "file" | "other" | "unknown";

function recordKind(dir: string): RecordKind {
  const path = join(dir, RECEIVED_RECORD);
  let found;
  try {
    found = lstatSync(path, { throwIfNoEntry: false });
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOTDIR" ? "absent" : "unknown";
  }
  if (!found) return "absent";
  try {
    return statSync(path).isFile() ? "file" : "other";
  } catch {
    return "other";
  }
}

export const RECEIVED_STATE_ENV = "HYPERFRAMES_RECEIVED_STATE_FILE";

type HostState = "expected" | "all";

interface Named {
  received: HostState;
  paths: string[];
}

interface HostStates {
  file: string;
  unreadable: boolean;
  byPath: Map<string, Named>;
  byIdentity: Map<string, Named>;
}

let hostStatesCache: { key: string; states: HostStates } | undefined;

function addNamed(map: Map<string, Named>, key: string, received: HostState, path: string): void {
  const known = map.get(key);
  map.set(key, {
    received: known?.received === "all" ? "all" : received,
    paths: [...(known?.paths ?? []), path],
  });
}

interface HostEntry {
  path: string;
  received: HostState;
  dev?: string;
  ino?: string;
}

function hostEntry(value: unknown): HostEntry {
  const { path, received, dev, ino } = (value ?? {}) as Record<string, unknown>;
  if (typeof path !== "string" || !isAbsolute(path)) throw new Error("path is not absolute");
  if (received !== "expected" && received !== "all") throw new Error("unknown state");
  return {
    path,
    received,
    ...(typeof dev === "string" && typeof ino === "string" && ino !== "0" ? { dev, ino } : {}),
  };
}

function parseHostStates(file: string, text: string): HostStates {
  const projects: unknown = JSON.parse(text)?.projects;
  if (!Array.isArray(projects)) throw new Error("projects is not a list");
  const states: HostStates = { file, unreadable: false, byPath: new Map(), byIdentity: new Map() };
  for (const value of projects) {
    const { path, received, dev, ino } = hostEntry(value);
    addNamed(states.byPath, walkStart(path), received, path);
    if (dev !== undefined && ino !== undefined)
      addNamed(states.byIdentity, `${dev}:${ino}`, received, path);
  }
  return states;
}

function hostStates(): HostStates | null {
  const file = process.env[RECEIVED_STATE_ENV];
  if (!file) return null;
  try {
    const handle = openSync(file, "r");
    try {
      const stat = fstatSync(handle, { bigint: true });
      const key = `${file}\0${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
      if (hostStatesCache?.key !== key)
        hostStatesCache = { key, states: parseHostStates(file, readFileSync(handle, "utf-8")) };
      return hostStatesCache.states;
    } finally {
      closeSync(handle);
    }
  } catch {
    return { file, unreadable: true, byPath: new Map(), byIdentity: new Map() };
  }
}

function hostState(dir: string, states = hostStates()): HostState | undefined {
  if (!states) return undefined;
  if (states.unreadable) return "all";
  const named = states.byPath.get(dir)?.received;
  if (named || states.byIdentity.size === 0) return named;
  const identity = fileIdentity(dir);
  return identity === null ? undefined : states.byIdentity.get(identity)?.received;
}

interface Naming {
  path: string;
  identity?: string;
}

function folderBirth(dir: string): string {
  try {
    return String(lstatSync(dir, { bigint: true }).birthtimeNs);
  } catch {
    return "";
  }
}

function namings(dir: string, states: HostStates): Naming[] {
  const byPath = new Set(states.byPath.get(dir)?.paths);
  const found = [...byPath].map((path) => ({ path }));
  const identity = states.byIdentity.size === 0 ? null : fileIdentity(dir);
  const named = identity === null ? undefined : states.byIdentity.get(identity);
  if (!named) return found;
  const kept = `${identity}:${folderBirth(dir)}`;
  const moved = [...new Set(named.paths)].filter((path) => !byPath.has(path));
  return [...found, ...moved.map((path) => ({ path, identity: kept }))];
}

const KEPT_RECORDS = "received-records";
const MAX_KEPT_BYTES = 16 * 1024 * 1024;

type KeptFiles = string[] | "all";

function keptFilesIn(kept: Record<string, unknown>, { path, identity }: Naming): KeptFiles {
  if (kept.project !== path) return "all";
  if (identity !== undefined && kept.identity !== identity) return "all";
  const { files } = kept;
  if (kept.doubted === true || !Array.isArray(files)) return "all";
  return files.every((entry) => typeof entry === "string") ? files : "all";
}

function keptFilesFor(naming: Naming, text: string): KeptFiles {
  try {
    const kept: unknown = JSON.parse(text);
    return keptFilesIn((kept ?? {}) as Record<string, unknown>, naming);
  } catch {
    return "all";
  }
}

function hostKeptRecord(
  stateFile: string,
  naming: Naming,
): { file: string; files: KeptFiles } | null {
  const name = `${createHash("sha256").update(naming.path).digest("hex")}.json`;
  const file = join(dirname(stateFile), KEPT_RECORDS, name);
  try {
    if (!lstatSync(file, { throwIfNoEntry: false })) return null;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOTDIR" ? null : { file, files: "all" };
  }
  const read = readPlainTail(file, MAX_KEPT_BYTES) ?? readPlainTail(file, MAX_KEPT_BYTES);
  if (!read?.whole) return onDisk(file) ? { file, files: "all" } : null;
  return { file, files: keptFilesFor(naming, read.text) };
}

function withEntriesHostKept(dir: string, listed: unknown[]): ReadRecord {
  const states = hostStates();
  if (!states || hostState(dir, states) !== "expected") return { listed };
  const copies = namings(dir, states).flatMap(
    (naming) => hostKeptRecord(states.file, naming) ?? [],
  );
  const unread = copies.find((copy) => copy.files === "all");
  if (unread) return { listed, unreadKeptCopy: unread.file };
  const present = new Set(listed.map(String));
  const kept = copies.flatMap((copy) => (copy.files === "all" ? [] : copy.files));
  const back = [...new Set(kept)].filter(
    (entry) => !present.has(entry) && onDisk(join(dir, entry)),
  );
  return { listed: back.length === 0 ? listed : [...listed, ...back] };
}

function allReceivedAtOrAbove(start: string, states: HostStates): boolean {
  for (let dir = start; ; dir = dirname(dir)) {
    if (hostState(dir, states) === "all") return true;
    if (dirname(dir) === dir) return false;
  }
}

function allReceivedAround(start: string): boolean {
  const states = hostStates();
  if (!states) return false;
  if (states.unreadable) return true;
  const overlaps = [...states.byPath].some(
    ([path, { received }]) =>
      received === "all" && (isAtOrUnder(path, start) || isAtOrUnder(start, path)),
  );
  return overlaps || allReceivedAtOrAbove(start, states);
}

function readRecordAsWritten(dir: string, ownFolder: boolean): { listed: unknown } | null {
  const kind = recordKind(dir);
  if (kind === "absent" && hostState(dir) !== undefined) return { listed: undefined };
  if (kind === "absent" || (kind === "unknown" && !ownFolder)) return null;
  if (kind !== "file") return { listed: undefined };
  try {
    return { listed: JSON.parse(readFileSync(join(dir, RECEIVED_RECORD), "utf-8")).files };
  } catch {
    return { listed: undefined };
  }
}

function readRecord(dir: string, ownFolder: boolean): ReadRecord | null {
  const record = readRecordAsWritten(dir, ownFolder);
  return record && Array.isArray(record.listed) ? withEntriesHostKept(dir, record.listed) : record;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function tryRecordLock(lock: string, deadline: number): "taken" | "wait" {
  try {
    closeSync(openSync(lock, "wx"));
    return "taken";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const heldFor = Date.now() - (statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? Date.now());
  if (heldFor > LOCK_STALE_MS || heldFor < -LOCK_CLOCK_SLACK_MS) rmSync(lock, { force: true });
  else if (Date.now() >= deadline)
    throw new Error(`Another program is changing ${RECEIVED_RECORD}; try again.`);
  return "wait";
}

function takeRecordLock(lock: string): void {
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (tryRecordLock(lock, deadline) === "wait") sleepSync(25);
}

async function takeRecordLockAsync(lock: string): Promise<void> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (tryRecordLock(lock, deadline) === "wait") await sleep(25);
}

type RecordChange = (files: Set<string>, content: ReceivedContent) => boolean;

function recordLock(projectDir: string): { root: string; lock: string } {
  const root = registryRoot(projectDir);
  if (!recordFolder(root, ""))
    throw new Error(
      `${join(root, ".hyperframes")} is a link or not a folder; remove it and try again.`,
    );
  return { root, lock: join(root, RECEIVED_RECORD_LOCK) };
}

function applyRecordChange(root: string, change: RecordChange): void {
  const record = readRecordAsWritten(root, true);
  if (record && !Array.isArray(record.listed)) return;
  const files = new Set(((record?.listed ?? []) as unknown[]).map(String));
  const content = readReceivedContent(root);
  const known = content.hashes.size;
  const changed = change(files, content);
  const json = `${JSON.stringify({ files: [...files].sort() })}\n`;
  if (changed && !writeRecord(root, basename(RECEIVED_RECORD), json))
    throw new Error(`Could not write ${join(root, RECEIVED_RECORD)}.`);
  if (content.hashes.size > known && !writeReceivedContent(root, content))
    throw new Error(`Could not write the received content beside ${join(root, RECEIVED_RECORD)}.`);
}

function changeReceivedRecord(projectDir: string, change: RecordChange): void {
  const { root, lock } = recordLock(projectDir);
  takeRecordLock(lock);
  try {
    applyRecordChange(root, change);
  } finally {
    rmSync(lock, { force: true });
  }
}

export async function changeReceivedRecordAsync(
  projectDir: string,
  change: RecordChange,
): Promise<void> {
  const { root, lock } = recordLock(projectDir);
  await takeRecordLockAsync(lock);
  try {
    applyRecordChange(root, change);
  } finally {
    rmSync(lock, { force: true });
  }
}

export function recordReceivedFiles(root: string, paths: string[]): string[] {
  const added: string[] = [];
  if (paths.length === 0) return added;
  changeReceivedRecord(root, (files) => {
    for (const path of paths.map((one) => one.normalize("NFC"))) {
      if (!files.has(path)) added.push(path);
      files.add(path);
    }
    return added.length > 0;
  });
  return added;
}

export function forgetReceivedFiles(root: string, paths: string[]): void {
  if (paths.length === 0) return;
  changeReceivedRecord(root, (files) => paths.map((path) => files.delete(path)).some(Boolean));
}

export const receivedLinesAtOrAbove = (dir: string): { folder: string; lines: string[] }[] =>
  receivedRecordsAtOrAbove(dir).flatMap((record) =>
    Array.isArray(record.listed) ? [{ folder: record.root, lines: record.listed.map(String) }] : [],
  );

const listedPaths = (record: ReceivedRecord): string[] =>
  Array.isArray(record.listed)
    ? record.listed.map((entry) => join(record.root, String(entry)))
    : [];

const isAtOrUnder = (path: string, folder: string) => {
  const inside = relative(folder, path);
  return (
    inside === "" || (inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside))
  );
};

export async function filesListedInFolder(target: string): Promise<string[] | null> {
  if (!statSync(target, { throwIfNoEntry: false })?.isDirectory()) return [];
  const own = readRecord(target, true);
  const below = await receivedRecordsBelowAsync(target);
  if (below === null) return null;
  const records = own ? [nestedRecord(target, target, own), ...below] : below;
  return records.flatMap(listedPaths);
}

function receivedRecordsAtOrAbove(start: string): ReceivedRecord[] {
  const records: ReceivedRecord[] = [];
  for (let dir = start; ; ) {
    const record = readRecord(dir, dir === start);
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

function nestedRecord(start: string, dir: string, record: ReadRecord): ReceivedRecord {
  const folder = relative(start, dir).split(sep).join("/");
  const listed = Array.isArray(record.listed)
    ? record.listed.map((entry) => (folder ? `${folder}/${String(entry)}` : String(entry)))
    : undefined;
  const nested = { file: join(dir, RECEIVED_RECORD), root: start, projectDirFromRoot: "", listed };
  return record.unreadKeptCopy ? { ...nested, unreadKeptCopy: record.unreadKeptCopy } : nested;
}

const GIT_AND_PACKAGE_FOLDERS = new Set([".git", "node_modules"]);

export function mayHoldLoadedFiles(start: string, folder: string): boolean {
  const rel = relative(start, folder).split(sep).join("/");
  const segments = projectPathSegments(rel);
  if (GIT_AND_PACKAGE_FOLDERS.has(segments.at(-1) ?? "")) return false;
  if (!segments.includes(".hyperframes")) return true;
  return segments.length === 1 || !isStudioPrivatePath(rel);
}

const subfolders = (start: string, dir: string, entries: Dirent[]): string[] =>
  entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(dir, entry.name))
    .filter((folder) => mayHoldLoadedFiles(start, folder));

function receivedRecordsBelow(start: string): ReceivedRecord[] | null {
  const withinBudget = walkBudget();
  const records: ReceivedRecord[] = [];
  const pending = [start];
  for (let dir = pending.pop(); dir !== undefined; dir = pending.pop()) {
    let folders: string[];
    try {
      folders = subfolders(start, dir, readdirSync(dir, { withFileTypes: true }));
    } catch {
      return null;
    }
    if (!withinBudget(folders.length)) return null;
    const record = dir === start ? null : readRecord(dir, true);
    if (record) records.push(nestedRecord(start, dir, record));
    pending.push(...folders);
  }
  return records;
}

async function receivedRecordsBelowAsync(start: string): Promise<ReceivedRecord[] | null> {
  const records: ReceivedRecord[] = [];
  const pending = [start];
  for (let dir = pending.pop(); dir !== undefined; dir = pending.pop()) {
    let folders: string[];
    try {
      folders = subfolders(start, dir, await readdir(dir, { withFileTypes: true }));
    } catch {
      return null;
    }
    const record = dir === start ? null : readRecord(dir, true);
    if (record) records.push(nestedRecord(start, dir, record));
    pending.push(...folders);
  }
  return records;
}

function walkStart(projectDir: string): string {
  try {
    return realpath(projectDir);
  } catch {
    return resolve(projectDir);
  }
}

function receivedRecords(projectDir: string): ReceivedRecord[] | null {
  const start = walkStart(projectDir);
  const below = receivedRecordsBelow(start);
  if (!below) return null;
  const records = [...receivedRecordsAtOrAbove(start), ...below];
  const everyFile = (file: string) => ({
    file,
    root: start,
    projectDirFromRoot: "",
    listed: undefined,
  });
  records.push(...records.flatMap(({ unreadKeptCopy }) => unreadKeptCopy ?? []).map(everyFile));
  if (allReceivedAround(start)) records.push(everyFile(process.env[RECEIVED_STATE_ENV] ?? ""));
  return records;
}

export function fileIdentity(path: string): string | null {
  try {
    const stat = lstatSync(path, { bigint: true });
    return stat.ino === 0n ? null : `${stat.dev}:${stat.ino}`;
  } catch {
    return null;
  }
}

function listedIn(
  record: ReceivedRecord,
  projectDir: string,
  start: string,
): (path: string) => boolean {
  const listed = (record.listed as unknown[]).map((path) => String(path).normalize("NFC"));
  const files = new Set(listed);
  const keyOf = (path: string) =>
    (record.projectDirFromRoot ? `${record.projectDirFromRoot}/${path}` : path).normalize("NFC");
  let listedOnDisk: Set<string> | undefined;
  const sameFileAsListed = (path: string) => {
    listedOnDisk ??= new Set(
      listed
        .map((entry) => join(record.root, entry))
        .filter((file) => isAtOrUnder(file, start))
        .flatMap((file) => fileIdentity(file) ?? []),
    );
    const identity = fileIdentity(join(projectDir, path));
    return identity !== null && listedOnDisk.has(identity);
  };
  return (path) => files.has(keyOf(path)) || sameFileAsListed(path);
}

function onDisk(path: string): boolean {
  try {
    return lstatSync(path, { throwIfNoEntry: false }) !== undefined;
  } catch {
    return false;
  }
}

export type ReceivedFiles = ((path: string) => boolean) & { gone?: string; unchecked?: boolean };

const contentFolder = (record: ReceivedRecord) => dirname(dirname(record.file));

function receivedContentOf(
  records: ReceivedRecord[],
): { hashes: string[] } | { unreadable: string } {
  const hashes: string[] = [];
  for (const folder of new Set(records.map(contentFolder))) {
    const content = readReceivedContent(folder);
    if (!content.readable) return { unreadable: receivedContentFile(folder) };
    hashes.push(...content.hashes);
  }
  return { hashes };
}

function holdsReceivedContent(projectDir: string, hashes: Set<string>) {
  const seen = new Map<string, boolean>();
  return (path: string): boolean => {
    if (hashes.size === 0) return false;
    if (!seen.has(path)) seen.set(path, hashes.has(contentHash(join(projectDir, path)) ?? ""));
    return seen.get(path) === true;
  };
}

export function receivedFiles(projectDir: string): ReceivedFiles {
  const records = receivedRecords(projectDir);
  if (records === null) return Object.assign(() => true, { unchecked: true });
  if (records.some((record) => !Array.isArray(record.listed))) return () => true;
  const content = receivedContentOf(records);
  if ("unreadable" in content) return () => true;
  const start = walkStart(projectDir);
  const listedInProject = records.flatMap(listedPaths).filter((path) => isAtOrUnder(path, start));
  const goneFile = listedInProject.find((path) => !onDisk(path));
  const mayBeGoneFile = (path: string) =>
    goneFile !== undefined &&
    (isCodeFile(path) || linksOutside(projectDir, join(projectDir, path)));
  const sameContent = holdsReceivedContent(projectDir, new Set(content.hashes));
  const listedInAnyRecord = records.map((record) => listedIn(record, projectDir, start));
  const received = (path: string) =>
    listedInAnyRecord.some((listed) => listed(path)) || mayBeGoneFile(path) || sameContent(path);
  const gone = goneFile && relative(start, goneFile).split(sep).join("/");
  return Object.assign(received, gone === undefined ? {} : { gone });
}

function listedUnder(record: ReceivedRecord): string[] {
  const entries = (record.listed as unknown[]).map(String);
  const prefix = record.projectDirFromRoot ? `${record.projectDirFromRoot}/`.normalize("NFC") : "";
  const folder = prefix ? fileIdentity(join(record.root, record.projectDirFromRoot)) : null;
  const identities = new Map<string, string | null>();
  const inFolderOnDisk = (path: string) => {
    for (let dir = dirname(path); folder && dir.length > record.root.length; dir = dirname(dir)) {
      if (!identities.has(dir)) identities.set(dir, fileIdentity(dir));
      if (identities.get(dir) === folder) return true;
    }
    return false;
  };
  return entries
    .filter(
      (entry) =>
        entry.normalize("NFC").startsWith(prefix) || inFolderOnDisk(join(record.root, entry)),
    )
    .map((entry) => join(record.root, entry));
}

export function receivedRecordStatus(
  projectDir: string,
): { path: string; listed: string[] | null; hashes: string[] } | "unchecked" | null {
  const records = receivedRecords(projectDir);
  if (records === null) return "unchecked";
  const [nearest] = records;
  if (!nearest) return null;
  const unreadable = records.find((record) => !Array.isArray(record.listed));
  if (unreadable) return { path: unreadable.file, listed: null, hashes: [] };
  const content = receivedContentOf(records);
  if ("unreadable" in content) return { path: content.unreadable, listed: null, hashes: [] };
  return { path: nearest.file, listed: records.flatMap(listedUnder), hashes: content.hashes };
}

const leavesProject = (path: string): boolean =>
  isAbsolute(path) || path.split(/[\\/]/)[0] === "..";

const projectRelatives = (projectDir: string, filePath: string): string[] => [
  relative(projectDir, filePath),
  relative(realFilePath(projectDir), realFilePath(filePath)),
];

/** Project files no composition loads, so none is served or uploaded: env, Git, credentials, tool and agent state. */
export function isPrivateCompositionFile(projectDir: string, filePath: string): boolean {
  const paths = projectRelatives(projectDir, filePath);
  return (
    paths.some(isEnvOrGitPath) ||
    paths.some((path) => !leavesProject(path) && isCredentialOrToolStatePath(path)) ||
    isPrivateProjectFile(projectDir, filePath)
  );
}

export function isHiddenProjectFile(projectDir: string, filePath: string): boolean {
  return projectRelatives(projectDir, filePath).some((path) =>
    path.split(/[\\/]/).some((segment) => segment.startsWith(".") && segment !== ".."),
  );
}
