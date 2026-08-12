/**
 * Registry installer — copies item files into a destination project.
 *
 * The top-level directory used under the source registry is determined by the
 * item's `type` (examples/blocks/components). Target paths are validated at
 * runtime to reject traversal even if the registry JSON schema was bypassed.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import type { FileTarget, RegistryItem } from "@hyperframes/core";
import { fetchItemFile, DEFAULT_REGISTRY_URL } from "./remote.js";

export interface InstallOptions {
  /** Project root where files land. Every target resolves relative to this. */
  destDir: string;
  /** Base URL of the registry. Defaults to the official public registry. */
  baseUrl?: string;
  /** Overwrite files the project has changed since they were installed. */
  force?: boolean;
}

export interface InstallResult {
  /** Absolute paths of files actually written. */
  written: string[];
  /** Absolute paths left alone because the project had changed them. */
  preserved: string[];
}

/**
 * What each installed file looked like when we installed it.
 *
 * Reinstalling an item used to overwrite whatever was on disk, so a project
 * that had tuned a block's colours lost that work to the next `add`. Comparing
 * the file against the hash we recorded is what tells an untouched file, which
 * is safe to replace, apart from an edited one, which is not.
 */
const INSTALL_RECORD = "hyperframes.lock.json";

type InstallRecord = Record<string, string>;

function digest(contents: Buffer | string): string {
  return createHash("sha256").update(contents).digest("hex");
}

function readInstallRecord(destDir: string): InstallRecord {
  const path = resolve(destDir, INSTALL_RECORD);
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    // A hand-edited or truncated record must not take the project's files with
    // it: an unreadable record means "provenance unknown", which is the
    // cautious answer everywhere it is used.
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const record: InstallRecord = {};
    for (const [target, hash] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof hash === "string") record[target] = hash;
    }
    return record;
  } catch {
    return {};
  }
}

function writeInstallRecord(destDir: string, record: InstallRecord): void {
  const sorted = Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(resolve(destDir, INSTALL_RECORD), `${JSON.stringify(sorted, null, 2)}\n`, "utf-8");
}

/**
 * Has the project changed this file since we installed it?
 *
 * A file we have no record of counts as changed. That covers the project that
 * wrote the file itself, and the one that installed before this record existed;
 * both would rather keep their file than have it silently replaced.
 */
export function hasLocalEdits(
  record: InstallRecord,
  target: string,
  onDisk: Buffer | string,
): boolean {
  const installed = record[target];
  if (!installed) return true;
  return installed !== digest(onDisk);
}

/**
 * Reject target paths that would escape `destDir`. Mirrors the pattern check
 * in `packages/core/schemas/registry-item.json#files.items.target`, but runs at
 * install time so a registry that bypasses schema validation still can't write
 * outside the project.
 */
export function assertSafeTarget(destDir: string, target: string): void {
  if (isAbsolute(target)) {
    throw new Error(`Unsafe target "${target}": absolute paths are not allowed.`);
  }
  if (/(^|[/\\])\.\.([/\\]|$)/.test(target)) {
    throw new Error(`Unsafe target "${target}": path segments may not contain "..".`);
  }
  if (/^[A-Za-z]:[/\\]/.test(target)) {
    throw new Error(`Unsafe target "${target}": Windows drive letters are not allowed.`);
  }
  const resolved = resolve(destDir, target);
  const rel = relative(resolve(destDir), resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Unsafe target "${target}": resolves outside destDir ${destDir}.`);
  }
}

function isInstalledRegistryBlockComposition(item: RegistryItem, file: FileTarget): boolean {
  return (
    item.type === "hyperframes:block" &&
    file.type === "hyperframes:composition" &&
    file.target.toLowerCase().endsWith(".html")
  );
}

function addRegistryItemMarker(source: string, item: RegistryItem): string {
  if (/^\s*<!--\s*hyperframes-registry-item:[^>]*-->/i.test(source.slice(0, 512))) {
    return source;
  }

  return `<!-- hyperframes-registry-item: ${item.name} -->\n${source}`;
}

/**
 * Install a resolved `RegistryItem` into `destDir` by fetching each file in
 * parallel and writing it to its validated target path.
 */
export async function installItem(
  item: RegistryItem,
  options: InstallOptions,
): Promise<InstallResult> {
  const baseUrl = options.baseUrl ?? DEFAULT_REGISTRY_URL;
  const destDir = resolve(options.destDir);

  // Validate all targets up-front so a malformed item fails before any write.
  for (const file of item.files) {
    assertSafeTarget(destDir, file.target);
  }

  const record = readInstallRecord(destDir);

  const outcomes = await Promise.all(
    item.files.map(async (file: FileTarget) => {
      const destPath = resolve(destDir, file.target);

      // Decided before fetching rather than after: a file we are going to keep
      // should never be overwritten and then put back, because a crash in
      // between would lose it for real.
      if (
        !options.force &&
        existsSync(destPath) &&
        hasLocalEdits(record, file.target, readFileSync(destPath))
      ) {
        return { destPath, target: file.target, preserved: true, hash: null };
      }

      await fetchItemFile(item, file, destPath, baseUrl);
      if (isInstalledRegistryBlockComposition(item, file)) {
        const source = readFileSync(destPath, "utf-8");
        writeFileSync(destPath, addRegistryItemMarker(source, item), "utf-8");
      }
      // Hash what actually landed, marker included, or the next install reads
      // its own marker as the project's edit.
      return {
        destPath,
        target: file.target,
        preserved: false,
        hash: digest(readFileSync(destPath)),
      };
    }),
  );

  const written = outcomes.filter((o) => !o.preserved).map((o) => o.destPath);
  const preserved = outcomes.filter((o) => o.preserved).map((o) => o.destPath);

  if (written.length > 0) {
    for (const outcome of outcomes) {
      if (outcome.hash) record[outcome.target] = outcome.hash;
    }
    writeInstallRecord(destDir, record);
  }

  return { written, preserved };
}
