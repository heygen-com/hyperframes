import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { realFilePath } from "@hyperframes/studio-server/safe-path";
import { registryRoot } from "../registry/publication.js";
import {
  changeReceivedRecordAsync,
  listedFilesLeaving,
  recordFoldersAtOrAbove,
} from "./privateProjectFile.js";
import { contentHashAsync } from "./receivedContent.js";
import { isMediaFontOrImage } from "./receivedRender.js";

/** A Studio rename or move of `from` to `to`, or a delete of `to`, as absolute paths spelled as they are on disk. */
export interface ReceivedChange {
  from?: string;
  to: string;
  left: string[];
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

/** The sha256s of the received files a change to `target` takes off a listed path; media is left out. */
export async function receivedContentLeaving(target: string): Promise<string[]> {
  const files = listedFilesLeaving(target).filter((path) => !isMediaFontOrImage(path));
  const hashes = await Promise.all(files.map(contentHashAsync));
  return hashes.filter((hash): hash is string => hash !== null);
}

const keyIn = (folder: string, path: string) =>
  relative(folder, path).split(sep).join("/").normalize("NFC");

function entriesAt(folder: string, key: string): (entry: string) => boolean {
  const fold = caseInsensitive(folder)
    ? (text: string) => text.normalize("NFC").toLowerCase()
    : (text: string) => text.normalize("NFC");
  const at = fold(key);
  return (entry) => fold(entry) === at || fold(entry).startsWith(`${at}/`);
}

async function keepLeftContent(root: string, left: string[]): Promise<void> {
  if (left.length === 0) return;
  await changeReceivedRecordAsync(root, (files, content) => {
    left.forEach((hash) => content.hashes.add(hash));
    return files.size === 0;
  });
}

async function dropListed(folder: string, path: string, keep?: string): Promise<void> {
  const at = entriesAt(folder, keyIn(folder, path));
  const kept = keep === undefined ? () => false : entriesAt(folder, keyIn(folder, keep));
  await changeReceivedRecordAsync(folder, (files) => {
    const stale = [...files].filter((entry) => at(entry) && !kept(entry));
    stale.forEach((entry) => files.delete(entry));
    return stale.length > 0;
  });
}

async function carryListed(root: string, folder: string, from: string, to: string): Promise<void> {
  const fromKey = keyIn(folder, from);
  const toKey = keyIn(folder, to);
  const at = entriesAt(folder, fromKey);
  const movedTo = (entry: string, prefix: string) => prefix + entry.slice(fromKey.length);
  if (toKey === ".." || toKey.startsWith("../")) {
    let moved: string[] = [];
    await changeReceivedRecordAsync(folder, (files) => {
      moved = [...files].filter(at);
      return false;
    });
    if (moved.length === 0) return;
    await changeReceivedRecordAsync(root, (files) => {
      moved.forEach((entry) => files.add(movedTo(entry, keyIn(root, to))));
      return true;
    });
    return dropListed(folder, from);
  }
  await changeReceivedRecordAsync(folder, (files) => {
    const moved = [...files].filter(at);
    moved.forEach((entry) => files.delete(entry));
    moved.forEach((entry) => files.add(movedTo(entry, toKey)));
    return moved.length > 0;
  });
}

/**
 * Keeps every received-files record at or above the paths true to the change, under each record's lock: what was
 * listed at `to` goes, what was listed at or under `from` is listed at `to` instead (in the project's own record when
 * `to` leaves the listing record's folder), and the content that left a listed path is kept as received content.
 */
export async function followReceivedChange(
  projectDir: string,
  change: ReceivedChange,
): Promise<void> {
  const root = registryRoot(projectDir);
  await keepLeftContent(root, change.left);
  const { from } = change;
  for (const folder of recordFoldersAtOrAbove(dirname(change.to)))
    await dropListed(folder, change.to, from);
  if (from === undefined) return;
  for (const folder of recordFoldersAtOrAbove(dirname(from)))
    await carryListed(root, folder, from, change.to);
}
