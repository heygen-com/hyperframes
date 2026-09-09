import { validRegistryItem } from "./validation.js";
import { registryRoot, registryTargetPath, publishRegistryFile } from "./publication.js";
import type { DownloadByteBudget } from "../capture/readBoundedResponse.js";
/**
 * Registry installer — copies item files into a destination project.
 *
 * The top-level directory used under the source registry is determined by the
 * item's `type` (examples/blocks/components). Target paths are validated at
 * runtime to reject traversal even if the registry JSON schema was bypassed.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import type { FileTarget, RegistryItem } from "@hyperframes/core";
import { fetchItemFile, DEFAULT_REGISTRY_URL } from "./remote.js";
import { applyVariableDefaults, type ApplyResult } from "./variableDefaults.js";

export interface InstallOptions {
  /** Project root where files land. Every target resolves relative to this. */
  destDir: string;
  /** Base URL of the registry. Defaults to the official public registry. */
  baseUrl?: string;
  /** Overwrite files the project has changed since they were installed. */
  force?: boolean;
  /**
   * `--vars` values to bake into a COMPONENT's declared defaults. A block
   * carries its values on the mount element instead, so this is ignored there:
   * per-mount values are strictly better when a mount exists.
   */
  variableValues?: Record<string, unknown> | null;
}

export interface InstallResult {
  /** Absolute paths of files actually written. */
  written: string[];
  /** Absolute paths left alone because the project had changed them. */
  preserved: string[];
  /** Variable ids whose default was rewritten in an installed component. */
  variablesApplied: string[];
  /** Ids the item does not declare, and ids it declares but cannot accept. */
  variablesUnknown: string[];
  variablesInvalid: { id: string; reason: string }[];
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
  const path = registryTargetPath(destDir, INSTALL_RECORD);
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
  publishRegistryFile(destDir, INSTALL_RECORD, `${JSON.stringify(sorted, null, 2)}\n`);
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
function assertSafeTarget(destDir: string, target: string): void {
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

/** A component's pasteable markup: the file whose declared defaults `--vars` edits. */
function isInstalledComponentSnippet(item: RegistryItem, file: FileTarget): boolean {
  return item.type === "hyperframes:component" && file.target.toLowerCase().endsWith(".html");
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

interface FileOutcome {
  destPath: string;
  target: string;
  preserved: boolean;
  hash: string | null;
  vars: ApplyResult | null;
}

/** Fetch, write and post-process one file. Extracted so installItem stays readable. */
async function installOneFile(
  item: RegistryItem,
  file: FileTarget,
  destDir: string,
  baseUrl: string,
  record: InstallRecord,
  options: InstallOptions,
  budget: DownloadByteBudget,
): Promise<FileOutcome> {
  const destPath = registryTargetPath(destDir, file.target);

  // Decided before fetching rather than after: a file we are going to keep
  // should never be overwritten and then put back, because a crash in
  // between would lose it for real.
  if (
    !options.force &&
    existsSync(destPath) &&
    hasLocalEdits(record, file.target, readFileSync(destPath))
  ) {
    return { destPath, target: file.target, preserved: true, hash: null, vars: null };
  }

  let bytes = await fetchItemFile(item, file, baseUrl, budget);
  if (isInstalledRegistryBlockComposition(item, file)) {
    bytes = Buffer.from(addRegistryItemMarker(bytes.toString("utf8"), item));
  }
  let vars: ApplyResult | null = null;
  if (options.variableValues && isInstalledComponentSnippet(item, file)) {
    vars = applyVariableDefaults(bytes.toString("utf8"), options.variableValues);
    if (vars.applied.length > 0) bytes = Buffer.from(vars.html);
  }
  publishRegistryFile(destDir, file.target, bytes);
  // Hash what actually landed, marker and baked defaults included, or the
  // next install reads its own output as the project's edit.
  return {
    destPath,
    target: file.target,
    preserved: false,
    hash: digest(bytes),
    vars,
  };
}

/**
 * Install a resolved `RegistryItem` into `destDir` by fetching each file in
 * parallel and writing it to its validated target path.
 */
export async function installItem(
  item: RegistryItem,
  options: InstallOptions,
): Promise<InstallResult> {
  if (!validRegistryItem(item, item.name, item.type)) throw new Error("Invalid registry item");
  const baseUrl = options.baseUrl ?? DEFAULT_REGISTRY_URL;
  const destDir = resolve(options.destDir);

  // Validate all targets up-front so a malformed item fails before any write.
  for (const file of item.files) {
    assertSafeTarget(destDir, file.target);
  }

  const root = registryRoot(destDir);
  validatePhysicalTargets(root, item.files);
  const record = readInstallRecord(root);
  const budget = { remainingBytes: 512 * 1024 * 1024 };

  const outcomes = await installFileBatches(item.files, (file) =>
    installOneFile(item, file, root, baseUrl, record, options, budget),
  );

  const written = outcomes.filter((o) => !o.preserved).map((o) => o.destPath);
  const preserved = outcomes.filter((o) => o.preserved).map((o) => o.destPath);

  if (written.length > 0) {
    for (const outcome of outcomes) {
      if (outcome.hash) record[outcome.target] = outcome.hash;
    }
    writeInstallRecord(root, record);
  }

  const vars = outcomes.map((o) => o.vars).filter((v): v is ApplyResult => v !== null);
  return {
    written,
    preserved,
    variablesApplied: vars.flatMap((v) => v.applied),
    // An id nothing declared is only genuinely unknown once every file has had
    // a chance at it, so intersect rather than union.
    variablesUnknown: vars.length
      ? vars.reduce<string[]>(
          (acc, v) => acc.filter((id) => v.unknown.includes(id)),
          vars[0]!.unknown,
        )
      : [],
    variablesInvalid: vars.flatMap((v) => v.invalid),
  };
}

function validatePhysicalTargets(root: string, files: FileTarget[]): void {
  const targets = new Set<string>();
  const aliasKey = (path: string): string =>
    process.platform === "win32" || process.platform === "darwin"
      ? path.normalize("NFC").toLowerCase()
      : path;
  const recordKey = aliasKey(registryTargetPath(root, INSTALL_RECORD));
  for (const file of files) {
    const path = registryTargetPath(root, file.target);
    const key = aliasKey(path);
    if (targets.has(key) || key === recordKey)
      throw new Error("Unsafe target: duplicate or reserved install record");
    targets.add(key);
  }
}

async function installFileBatches(
  files: FileTarget[],
  install: (file: FileTarget) => Promise<FileOutcome>,
): Promise<FileOutcome[]> {
  const outcomes: FileOutcome[] = [];
  for (let at = 0; at < files.length; at += 4) {
    const batch = await Promise.allSettled(files.slice(at, at + 4).map(install));
    for (const result of batch) {
      if (result.status === "rejected") throw result.reason;
      outcomes.push(result.value);
    }
  }
  return outcomes;
}
