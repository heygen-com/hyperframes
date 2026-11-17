import { existsSync, readdirSync, statSync } from "node:fs";
import { lstat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { realFilePath, resolveWithinProject } from "@hyperframes/studio-server/safe-path";
import { registryRoot } from "../registry/publication.js";
import {
  changeReceivedRecordAsync,
  filesListedInFolder,
  receivedLinesAtOrAbove,
} from "./privateProjectFile.js";
import { contentHashAsync, hashable, readReceivedContent } from "./receivedContent.js";
import { isMediaFontOrImage } from "./receivedRender.js";

type Lines = Map<string, string[]>;

/** A listed file a Studio rename, move or delete takes off its path, and its sha256 when its content is checked. */
interface Leaving {
  line: string;
  hash?: string;
}

/** Worked out while the files are on disk. A line whose file is already gone stays, as the sign it is gone. */
export interface ReceivedChange {
  root: string;
  leaving: Map<string, Leaving[]>;
  arriving: Lines;
}

const swapCase = (path: string) =>
  [...path].map((c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase())).join("");

/** Whether `folder` sits on a disk that takes a name in any letter case; false when that cannot be told. */
function caseInsensitive(folder: string): boolean {
  const swapped = swapCase(folder);
  return swapped !== folder && existsSync(swapped);
}

/** `path` spelled as its folder lists it, so a request in another letter case or Unicode form names the listed file. */
export function onDiskPath(path: string): string {
  const folder = realFilePath(dirname(path));
  const name = basename(path);
  const folded = name.normalize("NFC").toLowerCase();
  try {
    const names = readdirSync(folder);
    const found =
      names.find((entry) => entry === name) ??
      names.find((entry) => entry.normalize("NFC").toLowerCase() === folded);
    return join(folder, found ?? name);
  } catch {
    return join(folder, name);
  }
}

const keyIn = (folder: string, path: string) =>
  relative(folder, path).split(sep).join("/").normalize("NFC");

const leavesFolder = (key: string) => key === ".." || key.startsWith("../") || isAbsolute(key);

function entriesAt(folder: string, key: string): (entry: string) => boolean {
  const fold = caseInsensitive(folder)
    ? (text: string) => text.normalize("NFC").toLowerCase()
    : (text: string) => text.normalize("NFC");
  const at = fold(key);
  return (entry) => fold(entry) === at || fold(entry).startsWith(`${at}/`);
}

const push = <T>(map: Map<string, T[]>, folder: string, item: T) =>
  map.set(folder, [...(map.get(folder) ?? []), item]);

async function addLines(lines: Lines): Promise<Lines> {
  const added: Lines = new Map();
  for (const [folder, wanted] of lines)
    await changeReceivedRecordAsync(folder, (files) => {
      const fresh = wanted.filter((line) => !files.has(line));
      fresh.forEach((line) => files.add(line));
      if (fresh.length > 0) added.set(folder, fresh);
      return fresh.length > 0;
    });
  return added;
}

async function dropLines(lines: Lines): Promise<void> {
  for (const [folder, stale] of lines)
    await changeReceivedRecordAsync(folder, (files) =>
      stale.map((line) => files.delete(line)).some(Boolean),
    );
}

/**
 * Lists in the project's own record, by their paths from the project folder, every file that the records in the
 * folder `target` list, so a folder delete that stops partway, or a move, leaves each of them listed. False when that
 * cannot be done, and the folder must then stay as it is.
 */
export async function keepListedInFolder(projectDir: string, target: string): Promise<boolean> {
  const root = registryRoot(projectDir);
  const listed = await filesListedInFolder(target);
  if (listed === null) return false;
  const lines = listed
    .flatMap((path) => [keyIn(root, path), keyIn(root, realFilePath(path))])
    .filter((key) => !leavesFolder(key));
  if (lines.length === 0) return true;
  try {
    await addLines(new Map([[root, lines]]));
    return true;
  } catch {
    return false;
  }
}

/** Null for a gone file or one whose content cannot be read: its line stays. */
async function leaving(line: string, path: string): Promise<Leaving | null> {
  const stat = await lstat(path).catch(() => null);
  if (stat === null) return null;
  if (isMediaFontOrImage(path) || (stat.isFile() && !hashable(path, stat))) return { line };
  const hash = await contentHashAsync(path);
  return hash === null ? null : { line, hash };
}

export async function plannedReceivedChange(
  projectDir: string,
  from: string,
  to?: string,
): Promise<ReceivedChange> {
  const root = registryRoot(projectDir);
  const change: ReceivedChange = { root, leaving: new Map(), arriving: new Map() };
  for (const { folder, lines } of receivedLinesAtOrAbove(dirname(from))) {
    const fromKey = keyIn(folder, from);
    const at = entriesAt(folder, fromKey);
    for (const line of lines.filter(at)) {
      const left = await leaving(line, join(folder, line));
      if (left === null) continue;
      push(change.leaving, folder, left);
      if (to === undefined) continue;
      const rest = line.normalize("NFC").slice(fromKey.length);
      const toKey = keyIn(folder, to);
      if (leavesFolder(toKey)) push(change.arriving, root, keyIn(root, to) + rest);
      else push(change.arriving, folder, toKey + rest);
    }
  }
  return change;
}

/** False when the received content cannot be read; it is then left as it is. */
async function keepLeftContent(change: ReceivedChange): Promise<boolean> {
  const hashes = [...change.leaving.values()].flat().flatMap((left) => left.hash ?? []);
  if (hashes.length === 0) return true;
  if (!readReceivedContent(change.root).readable) return false;
  await changeReceivedRecordAsync(change.root, (files, content) => {
    hashes.forEach((hash) => content.hashes.add(hash));
    return files.size === 0;
  });
  return true;
}

/**
 * Made before the files move; throws when a record cannot be changed. The result holds only the lines it newly listed,
 * so a refused rename can take them back, and keeps listed a file whose content could not be kept.
 */
export async function recordReceivedArrivals(change: ReceivedChange): Promise<ReceivedChange> {
  const contentKept = await keepLeftContent(change);
  const arriving = await addLines(change.arriving);
  const leaving = new Map(
    [...change.leaving].map(([folder, lines]) => [
      folder,
      lines.filter((left) => contentKept || left.hash === undefined),
    ]),
  );
  return { ...change, leaving, arriving };
}

export const dropReceivedLeavers = (change: ReceivedChange): Promise<void> =>
  dropLines(
    new Map([...change.leaving].map(([folder, lines]) => [folder, lines.map((left) => left.line)])),
  );

export const dropReceivedArrivals = (change: ReceivedChange): Promise<void> =>
  dropLines(change.arriving);

/**
 * Lists in the project's own record each of `paths` that no record lists and that holds content kept as received, so
 * an undo, a redo, a restore or a save that brings such content back keeps it received through later edits.
 */
export async function relistReceivedContent(projectDir: string, paths: string[]): Promise<void> {
  const root = registryRoot(projectDir);
  const lines: string[] = [];
  for (const path of paths) {
    const records = receivedLinesAtOrAbove(dirname(path));
    const listed = records.some(({ folder, lines: listedLines }) =>
      listedLines.some((line) => line.normalize("NFC") === keyIn(folder, path)),
    );
    if (listed) continue;
    const hashes = new Set(
      records.flatMap(({ folder }) => [...readReceivedContent(folder).hashes]),
    );
    if (hashes.size === 0) continue;
    const hash = await contentHashAsync(path);
    const line = keyIn(root, realFilePath(path));
    if (hash !== null && hashes.has(hash) && !leavesFolder(line)) lines.push(line);
  }
  if (lines.length > 0) await addLines(new Map([[root, lines]]));
}

/** Lists again each file a history undo, redo or restore wrote that holds received content. */
export function relistHistoryWrites(
  projectDir: string,
  entry: { files: readonly { path: string }[] } | null,
): Promise<void> {
  const written = (entry?.files ?? [])
    .flatMap((file) => resolveWithinProject(projectDir, file.path) ?? [])
    .filter((path) => statSync(path, { throwIfNoEntry: false })?.isFile() === true);
  return relistReceivedContent(projectDir, written);
}
