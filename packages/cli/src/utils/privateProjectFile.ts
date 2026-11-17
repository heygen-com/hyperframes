import {
  closeSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
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
} from "@hyperframes/core/safe-path";
import { registryRoot } from "../registry/publication.js";
import { recordFolder, writeRecord } from "./projectRecords.js";
import { walkBudget } from "./walkBudget.js";
import {
  contentHash,
  isCodeFile,
  readReceivedContent,
  type ReceivedContent,
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

interface ReceivedRecord {
  file: string;
  root: string;
  projectDirFromRoot: string;
  listed: unknown;
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

function readRecord(dir: string, ownFolder: boolean): { listed: unknown } | null {
  const kind = recordKind(dir);
  if (kind === "absent" || (kind === "unknown" && !ownFolder)) return null;
  if (kind !== "file") return { listed: undefined };
  try {
    return { listed: JSON.parse(readFileSync(join(dir, RECEIVED_RECORD), "utf-8")).files };
  } catch {
    return { listed: undefined };
  }
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
  if (heldFor > LOCK_STALE_MS) rmSync(lock, { force: true });
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
  const record = readRecord(root, true);
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

export const recordFoldersAtOrAbove = (dir: string): string[] =>
  receivedRecordsAtOrAbove(dir).map((record) => record.root);

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

export function listedFilesLeaving(target: string): string[] {
  const above = receivedRecordsAtOrAbove(dirname(target)).flatMap(listedPaths);
  const within = [...receivedRecordsAtOrAbove(target), ...(receivedRecordsBelow(target) ?? [])];
  return [
    ...above.filter((path) => isAtOrUnder(path, target)),
    ...within.filter((record) => isAtOrUnder(record.file, target)).flatMap(listedPaths),
  ];
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

function nestedRecord(start: string, dir: string, record: { listed: unknown }): ReceivedRecord {
  const folder = relative(start, dir).split(sep).join("/");
  const listed = Array.isArray(record.listed)
    ? record.listed.map((entry) => `${folder}/${String(entry)}`)
    : undefined;
  return { file: join(dir, RECEIVED_RECORD), root: start, projectDirFromRoot: "", listed };
}

const GIT_AND_PACKAGE_FOLDERS = new Set([".git", "node_modules"]);

export function mayHoldLoadedFiles(start: string, folder: string): boolean {
  const rel = relative(start, folder).split(sep).join("/");
  const segments = projectPathSegments(rel);
  if (GIT_AND_PACKAGE_FOLDERS.has(segments.at(-1) ?? "")) return false;
  if (!segments.includes(".hyperframes")) return true;
  return segments.length === 1 || !isStudioPrivatePath(rel);
}

function receivedRecordsBelow(start: string): ReceivedRecord[] | null {
  const withinBudget = walkBudget();
  const records: ReceivedRecord[] = [];
  const pending = [start];
  for (let dir = pending.pop(); dir !== undefined; dir = pending.pop()) {
    let folders: string[];
    try {
      folders = readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(dir, entry.name))
        .filter((folder) => mayHoldLoadedFiles(start, folder));
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

function receivedRecords(projectDir: string): ReceivedRecord[] | null {
  let start: string;
  try {
    start = realpathSync(projectDir);
  } catch {
    start = resolve(projectDir);
  }
  const below = receivedRecordsBelow(start);
  return below && [...receivedRecordsAtOrAbove(start), ...below];
}

function fileIdentity(path: string): string | null {
  try {
    const stat = lstatSync(path, { bigint: true });
    return stat.ino === 0n ? null : `${stat.dev}:${stat.ino}`;
  } catch {
    return null;
  }
}

function listedIn(record: ReceivedRecord, projectDir: string): (path: string) => boolean {
  const listed = (record.listed as unknown[]).map((path) => String(path).normalize("NFC"));
  const files = new Set(listed);
  const keyOf = (path: string) =>
    (record.projectDirFromRoot ? `${record.projectDirFromRoot}/${path}` : path).normalize("NFC");
  let listedOnDisk: Set<string> | undefined;
  const sameFileAsListed = (path: string) => {
    listedOnDisk ??= new Set(
      listed.flatMap((entry) => fileIdentity(join(record.root, entry)) ?? []),
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

export type ReceivedFiles = ((path: string) => boolean) & { gone?: string };

const contentFolder = (record: ReceivedRecord) => dirname(dirname(record.file));

const receivedHashes = (records: ReceivedRecord[]): string[] =>
  records.flatMap((record) => [...readReceivedContent(contentFolder(record)).hashes]);

function holdsReceivedContent(projectDir: string, records: ReceivedRecord[]) {
  const hashes = new Set(receivedHashes(records));
  const seen = new Map<string, boolean>();
  return (path: string): boolean => {
    if (hashes.size === 0) return false;
    if (!seen.has(path)) seen.set(path, hashes.has(contentHash(join(projectDir, path)) ?? ""));
    return seen.get(path) === true;
  };
}

export function receivedFiles(projectDir: string): ReceivedFiles {
  const records = receivedRecords(projectDir);
  if (records === null || records.some((record) => !Array.isArray(record.listed)))
    return () => true;
  const goneFile = records.flatMap(listedPaths).find((path) => !onDisk(path));
  const mayBeGoneFile = (path: string) =>
    goneFile !== undefined &&
    (isCodeFile(path) || linksOutside(projectDir, join(projectDir, path)));
  const sameContent = holdsReceivedContent(projectDir, records);
  const listedInAnyRecord = records.map((record) => listedIn(record, projectDir));
  const received = (path: string) =>
    listedInAnyRecord.some((listed) => listed(path)) || mayBeGoneFile(path) || sameContent(path);
  const gone = goneFile && relative(realFilePath(projectDir), goneFile).split(sep).join("/");
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
  const hashes = receivedHashes(records);
  return { path: nearest.file, listed: records.flatMap(listedUnder), hashes };
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
