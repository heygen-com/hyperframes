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
import {
  applyVariableDefaults,
  InvalidVariableValuesError,
  type ApplyResult,
} from "./variableDefaults.js";

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
  /**
   * Project folders a block or component may write into, on top of the standard layout: the project's configured
   * `paths` from hyperframes.json.
   */
  installDirs?: string[];
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

/** Re-record files an install wrote and its caller then rewrote, so they still read as unedited. */
export function recordRewrittenInstall(destDir: string, written: string[]): void {
  if (written.length === 0) return;
  const root = registryRoot(destDir);
  const record = readInstallRecord(root);
  const rewritten = new Set(written);
  for (const target of Object.keys(record)) {
    let path: string;
    try {
      path = registryTargetPath(root, target);
    } catch {
      continue; // a key that no longer resolves, or that the installer would refuse
    }
    if (rewritten.has(path)) record[target] = digest(readFileSync(path));
  }
  writeInstallRecord(root, record);
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

/** An install must leave this file alone: the project changed it, and `--force` was not given. */
function keptByProject(
  record: InstallRecord,
  destPath: string,
  target: string,
  force: boolean | undefined,
): boolean {
  return !force && existsSync(destPath) && hasLocalEdits(record, target, readFileSync(destPath));
}

// Project and tool configuration is never registry content: VCS metadata, package-manager and
// agent or editor settings are executed or trusted by other tools. Only an example (a fresh `init`)
// may bring its own package.json and HyperFrames config.
const PROJECT_FILES = new Set(["package.json", "hyperframes.json", "hyperframes.lock.json"]);
const EXAMPLE_DOTFILES = new Set([".gitignore"]);

// A Windows short name such as `CLAUDE~1` or `PACKAG~1.JSO` can open any long name on NTFS.
const isShortName = (part: string): boolean => /~\d+(\.|$)/.test(part);

// Where a block or component may write: the standard project layout (the official catalog's 3D models and vendored
// browser scripts sit in `models/` and `lib/`), plus the project's configured folders. Anything else in a project is
// someone else's: installed packages, tool settings, scripts other programs run.
const STANDARD_INSTALL_DIRS = ["compositions", "assets", "models", "lib"];
// The one file a block may leave at the project root: the catalog's usage note. Any other name could be one a tool loads.
const ROOT_NOTES = new Set(["template.md"]);
// Coding agents load these on their own, wherever they sit.
const AGENT_INSTRUCTIONS =
  /^(agents?|claude|gemini|qwen|crush|warp|conventions|copilot-instructions)(\.[a-z]+)?\.md$/;
// Programs and scripts a shell, an OS or another tool runs; a browser composition never needs them.
const EXECUTABLE =
  /\.(exe|com|bat|cmd|ps1|psm1|vbs|vbe|wsf|hta|msi|scr|pif|cpl|lnk|dll|so|dylib|node|sh|bash|zsh|command|jar|appimage|py|rb|pl|php)$/;

function withoutTrailingDotsOrSpaces(part: string): string {
  let end = part.length;
  while (end > 0 && (part[end - 1] === "." || part[end - 1] === " ")) end--;
  return part.slice(0, end);
}

/** Path segments as a case-insensitive file system compares them, either separator, no trailing dots or spaces. */
function targetSegments(path: string): string[] {
  return path
    .normalize("NFC")
    .toLowerCase()
    .split(/[\\/]/)
    .map(withoutTrailingDotsOrSpaces)
    .filter((part, at, parts) => part !== "" || at === parts.length - 1);
}

/** Configured folders as segment lists; one that names the root, a hidden folder or node_modules opens nothing. */
function installDirSegments(dirs: string[]): string[][] {
  return dirs
    .map((dir) => targetSegments(dir).filter((part) => part !== ""))
    .filter(
      (parts) =>
        parts.length > 0 &&
        parts.every(
          (part) => !part.startsWith(".") && part !== "node_modules" && !isShortName(part),
        ),
    );
}

function inInstallDir(dirs: string[], installDirs: string[][]): boolean {
  return installDirs.some(
    (allowed) => allowed.length <= dirs.length && allowed.every((part, at) => dirs[at] === part),
  );
}

function isHiddenConfigFile(file: string, example: boolean): boolean {
  if (file === ".gitkeep" || (example && EXAMPLE_DOTFILES.has(file))) return false;
  return file.startsWith(".");
}

type TargetRule = [
  reason: string,
  applies: (
    dirs: string[],
    file: string,
    example: boolean,
    installDirs: string[][] | null,
  ) => boolean,
];

const CONFIG_TARGET_RULES: TargetRule[] = [
  ["it writes into git metadata", (dirs, file) => [...dirs, file].includes(".git")],
  ["it uses a Windows short name", (dirs, file) => [...dirs, file].some(isShortName)],
  ["it writes into a hidden tool directory", (dirs) => dirs.some((dir) => dir.startsWith("."))],
  [
    "it writes a hidden configuration file",
    (_dirs, file, example) => isHiddenConfigFile(file, example),
  ],
  [
    "it would replace project configuration",
    (_dirs, file, example) => !example && PROJECT_FILES.has(file),
  ],
  ["it writes into node_modules", (dirs) => dirs.includes("node_modules")],
  ["it writes an agent instruction file", (_dirs, file) => AGENT_INSTRUCTIONS.test(file)],
  ["it writes a program or script", (_dirs, file) => EXECUTABLE.test(file)],
  [
    "it writes outside the project's blocks, components and assets folders",
    (dirs, file, example, installDirs) =>
      !example &&
      installDirs !== null &&
      !inInstallDir(dirs, installDirs) &&
      !(dirs.length === 0 && ROOT_NOTES.has(file)),
  ],
];

/** Why a target is refused, or null. `installDirs` null skips the folder allowlist, for a path links already moved. */
function configTargetError(
  target: string,
  type: RegistryItem["type"],
  installDirs: string[][] | null,
): string | null {
  const parts = targetSegments(target);
  const file = parts.pop() ?? "";
  const example = type === "hyperframes:example";
  return (
    CONFIG_TARGET_RULES.find(([, applies]) => applies(parts, file, example, installDirs))?.[0] ??
    null
  );
}

/**
 * Reject target paths that would escape `destDir`. Mirrors the pattern check
 * in `packages/core/schemas/registry-item.json#files.items.target`, but runs at
 * install time so a registry that bypasses schema validation still can't write
 * outside the project.
 */
function assertSafeTarget(
  destDir: string,
  target: string,
  type: RegistryItem["type"],
  installDirs: string[][],
): void {
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
  const configError = configTargetError(target, type, installDirs);
  if (configError) throw new Error(`Unsafe target "${target}": ${configError}.`);
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

export interface FileOutcome {
  destPath: string;
  target: string;
  preserved: boolean;
  hash: string | null;
  vars: ApplyResult | null;
  /** What to write; null for a preserved file. */
  bytes: Buffer | null;
}

/**
 * Check `--vars` against the file that declares them. A block's values ride on
 * its mount, so only a component's own declaration is rewritten.
 */
function bakeVariables(
  item: RegistryItem,
  file: FileTarget,
  bytes: Buffer,
  values: Record<string, unknown> | null | undefined,
): { bytes: Buffer; vars: ApplyResult | null } {
  const component = isInstalledComponentSnippet(item, file);
  if (!values || !(component || isInstalledRegistryBlockComposition(item, file))) {
    return { bytes, vars: null };
  }
  const vars = applyVariableDefaults(bytes.toString("utf8"), values);
  const rewrite = component && vars.applied.length > 0;
  return { bytes: rewrite ? Buffer.from(vars.html) : bytes, vars };
}

/** Fetch and post-process one file; publishItem writes it once the whole plan is ready. */
async function prepareOneFile(
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
  if (keptByProject(record, destPath, file.target, options.force)) {
    return { destPath, target: file.target, preserved: true, hash: null, vars: null, bytes: null };
  }

  let bytes = await fetchItemFile(item, file, baseUrl, budget);
  if (isInstalledRegistryBlockComposition(item, file)) {
    bytes = Buffer.from(addRegistryItemMarker(bytes.toString("utf8"), item));
  }
  const baked = bakeVariables(item, file, bytes, options.variableValues);
  bytes = baked.bytes;
  const vars = baked.vars;
  // Hash what will land, marker and baked defaults included, or the next
  // install reads its own output as the project's edit.
  return {
    destPath,
    target: file.target,
    preserved: false,
    hash: digest(bytes),
    vars,
    bytes,
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
  return publishItem(await prepareItem(item, options));
}

/** An item fetched and checked, with nothing written yet. */
export interface PreparedItem {
  root: string;
  outcomes: FileOutcome[];
  force: boolean;
}

/** Fetch and check every file of an item without writing, so a caller can refuse a whole plan. */
export async function prepareItem(
  item: RegistryItem,
  options: InstallOptions,
): Promise<PreparedItem> {
  if (!validRegistryItem(item, item.name, item.type)) throw new Error("Invalid registry item");
  const baseUrl = options.baseUrl ?? DEFAULT_REGISTRY_URL;
  const destDir = resolve(options.destDir);

  // Validate all targets up-front so a malformed item fails before any write.
  const installDirs = installDirSegments([
    ...STANDARD_INSTALL_DIRS,
    ...(options.installDirs ?? []),
  ]);
  for (const file of item.files) {
    assertSafeTarget(destDir, file.target, item.type, installDirs);
  }

  const root = registryRoot(destDir);
  validatePhysicalTargets(root, item.files, item.type);
  const record = readInstallRecord(root);
  const budget = { remainingBytes: 512 * 1024 * 1024 };

  const outcomes = await installFileBatches(item.files, (file) =>
    prepareOneFile(item, file, root, baseUrl, record, options, budget),
  );
  const invalid = outcomes.flatMap((o) => o.vars?.invalid ?? []);
  if (invalid.length > 0) throw new InvalidVariableValuesError(invalid);
  return { root, outcomes, force: options.force ?? false };
}

/** Write a prepared item and record what landed. */
export function publishItem({ root, outcomes: prepared, force }: PreparedItem): InstallResult {
  // Read now, not at prepare time: another item published in between has recorded its own files.
  const record = readInstallRecord(root);
  // Asked again at write time: a save made while the rest of the plan downloaded is still an edit.
  const outcomes = prepared.map((o) =>
    o.bytes && keptByProject(record, o.destPath, o.target, force)
      ? { ...o, preserved: true, hash: null, vars: null, bytes: null }
      : o,
  );
  for (const outcome of outcomes) {
    if (outcome.bytes) publishRegistryFile(root, outcome.target, outcome.bytes);
  }

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
  };
}

function validatePhysicalTargets(
  root: string,
  files: FileTarget[],
  type: RegistryItem["type"],
): void {
  const targets = new Set<string>();
  const aliasKey = (path: string): string =>
    process.platform === "win32" || process.platform === "darwin"
      ? path.normalize("NFC").toLowerCase()
      : path;
  const recordKey = aliasKey(registryTargetPath(root, INSTALL_RECORD));
  for (const file of files) {
    const path = registryTargetPath(root, file.target);
    // Where the project's own links lead: still never into node_modules, hidden folders, agent files or programs.
    const configError = configTargetError(relative(root, path), type, null);
    if (configError) throw new Error(`Unsafe target "${file.target}": ${configError}.`);
    const key = aliasKey(path);
    if (targets.has(key) || key === recordKey)
      throw new Error("Unsafe target: duplicate or reserved install record");
    targets.add(key);
  }
}

async function installFileBatches(
  files: FileTarget[],
  prepare: (file: FileTarget) => Promise<FileOutcome>,
): Promise<FileOutcome[]> {
  const outcomes: FileOutcome[] = [];
  for (let at = 0; at < files.length; at += 4) {
    const batch = await Promise.allSettled(files.slice(at, at + 4).map(prepare));
    for (const result of batch) {
      if (result.status === "rejected") throw result.reason;
      outcomes.push(result.value);
    }
  }
  return outcomes;
}
