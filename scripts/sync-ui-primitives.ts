#!/usr/bin/env tsx

import {
  constants,
  copyFileSync,
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  extractCanonicalRegion,
  injectOperatorBlackTokens,
  normalizedSha256,
  replaceCanonicalRegion,
  validateDemoOnlyCss,
} from "./lib/ui-primitives/canonical.js";
import { isRecord, loadUiPrimitiveScope } from "./lib/ui-primitives/scope.js";
import {
  loadOperatorBlackTokens,
  renderOperatorBlackTokenBlock,
} from "./lib/ui-primitives/tokens.js";

export type SyncMode = "check" | "write";

export interface SyncPrimitiveOptions {
  id: string;
  canonicalPath: string;
  demoPath: string;
  tokenBlock: string;
  mode: SyncMode;
}

export interface SyncPrimitiveResult {
  id: string;
  canonicalChanged: boolean;
  demoChanged: boolean;
}

interface PreparedFileChange {
  path: string;
  content: string;
}

interface PreparedPrimitive extends SyncPrimitiveResult {
  changes: PreparedFileChange[];
}

function prepareUiPrimitiveFiles(options: SyncPrimitiveOptions): PreparedPrimitive {
  if (!existsSync(options.canonicalPath)) {
    throw new Error(`canonical file is missing: ${options.canonicalPath}`);
  }
  if (!existsSync(options.demoPath)) {
    throw new Error(`demo file is missing: ${options.demoPath}`);
  }

  const canonicalBefore = readFileSync(options.canonicalPath, "utf8");
  const demoBefore = readFileSync(options.demoPath, "utf8");
  const canonicalAfter = injectOperatorBlackTokens(
    canonicalBefore,
    options.tokenBlock,
    options.canonicalPath,
  );
  const demoAfter = replaceCanonicalRegion(
    demoBefore,
    canonicalAfter,
    options.id,
    options.demoPath,
  );
  validateDemoOnlyCss(demoAfter, canonicalAfter, options.demoPath);

  const region = extractCanonicalRegion(demoAfter, options.demoPath);
  if (normalizedSha256(region) !== normalizedSha256(canonicalAfter)) {
    throw new Error(`${options.id} canonical/demo normalized SHA-256 mismatch`);
  }

  const canonicalChanged = canonicalBefore !== canonicalAfter;
  const demoChanged = demoBefore !== demoAfter;
  const changes: PreparedFileChange[] = [];
  if (canonicalChanged) changes.push({ path: options.canonicalPath, content: canonicalAfter });
  if (demoChanged) changes.push({ path: options.demoPath, content: demoAfter });
  return { id: options.id, canonicalChanged, demoChanged, changes };
}

interface PendingInstallation extends PreparedFileChange {
  temporaryPath: string;
  backupPath: string;
}

export interface AtomicCommitOptions {
  beforeInstall?: (path: string, index: number) => void;
  journalPath?: string;
  allowedPaths?: string[];
}

type TransactionState = "preparing" | "installing" | "committed";

interface TransactionJournal {
  version: 1;
  state: TransactionState;
  entries: Array<{ path: string }>;
}

function cleanupPath(path: string): void {
  if (existsSync(path)) rmSync(path, { force: true });
}

function stagingPaths(path: string): { temporaryPath: string; backupPath: string } {
  return {
    temporaryPath: `${path}.hf-ui-sync.tmp`,
    backupPath: `${path}.hf-ui-sync.bak`,
  };
}

export function uiPrimitiveTransactionJournalPath(paths: string[]): string {
  const first = paths[0];
  if (!first) throw new Error("A sync transaction requires at least one file path");
  return resolve(dirname(first), ".hf-ui-sync.transaction.json");
}

// fallow-ignore-next-line complexity
function parseTransactionJournal(
  value: unknown,
  source: string,
  allowedPaths: string[],
): TransactionJournal {
  if (!isRecord(value) || value.version !== 1) {
    throw new Error(`${source} is not a supported UI primitive transaction journal`);
  }
  if (value.state !== "preparing" && value.state !== "installing" && value.state !== "committed") {
    throw new Error(`${source} has an invalid transaction state`);
  }
  if (!Array.isArray(value.entries)) throw new Error(`${source} entries must be an array`);
  const allowed = new Set(allowedPaths);
  const entries: TransactionJournal["entries"] = [];
  for (const entry of value.entries) {
    if (!isRecord(entry)) throw new Error(`${source} contains an invalid transaction entry`);
    if (JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(["path"])) {
      throw new Error(`${source} transaction entries may contain only path`);
    }
    if (typeof entry.path !== "string" || !allowed.has(entry.path)) {
      throw new Error(`${source} contains a path outside the allowed UI primitive scope`);
    }
    if (entries.some(({ path }) => path === entry.path)) {
      throw new Error(`${source} contains duplicate transaction paths`);
    }
    entries.push({ path: entry.path });
  }
  return { version: 1, state: value.state, entries };
}

function readTransactionJournal(journalPath: string, allowedPaths: string[]): TransactionJournal {
  const parsed: unknown = JSON.parse(readFileSync(journalPath, "utf8"));
  return parseTransactionJournal(parsed, journalPath, allowedPaths);
}

function writeTransactionJournal(journalPath: string, journal: TransactionJournal): void {
  const content = `${JSON.stringify(journal, null, 2)}\n`;
  const nextPath = `${journalPath}.next`;
  cleanupPath(nextPath);
  writeFileSync(nextPath, content, { flag: "wx" });
  renameSync(nextPath, journalPath);
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isRecord(error) && error.code === "EPERM";
  }
}

function acquireTransactionLock(journalPath: string): string {
  const lockPath = `${journalPath}.lock`;
  try {
    writeFileSync(lockPath, `${process.pid}\n`, { flag: "wx" });
    return lockPath;
  } catch (error) {
    if (!existsSync(lockPath)) throw error;
    const owner = Number.parseInt(readFileSync(lockPath, "utf8").trim(), 10);
    if (Number.isFinite(owner) && owner > 0 && processIsAlive(owner)) {
      throw new Error(`another UI primitive sync transaction is active (pid ${owner})`);
    }
    cleanupPath(lockPath);
    writeFileSync(lockPath, `${process.pid}\n`, { flag: "wx" });
    return lockPath;
  }
}

function recoverTransaction(journalPath: string, allowedPaths: string[]): void {
  const journal = readTransactionJournal(journalPath, allowedPaths);
  if (journal.state !== "committed") {
    for (const entry of [...journal.entries].reverse()) {
      const { backupPath } = stagingPaths(entry.path);
      if (existsSync(backupPath)) renameSync(backupPath, entry.path);
    }
  }
  for (const entry of journal.entries) {
    const { temporaryPath, backupPath } = stagingPaths(entry.path);
    cleanupPath(temporaryPath);
    cleanupPath(backupPath);
  }
  cleanupPath(`${journalPath}.next`);
  cleanupPath(journalPath);
}

export function recoverUiPrimitiveChanges(paths: string[], journalPath?: string): void {
  if (paths.length === 0) return;
  const allowedPaths = [...new Set(paths)];
  if (allowedPaths.length !== paths.length || allowedPaths.some((path) => resolve(path) !== path)) {
    throw new Error("Allowed UI primitive transaction paths must be unique and absolute");
  }
  const resolvedJournalPath = journalPath ?? uiPrimitiveTransactionJournalPath(paths);
  const lockPath = acquireTransactionLock(resolvedJournalPath);
  try {
    if (existsSync(resolvedJournalPath)) {
      recoverTransaction(resolvedJournalPath, allowedPaths);
      return;
    }
    for (const path of allowedPaths) {
      const { temporaryPath, backupPath } = stagingPaths(path);
      if (existsSync(backupPath)) renameSync(backupPath, path);
      cleanupPath(temporaryPath);
    }
    cleanupPath(`${resolvedJournalPath}.next`);
  } finally {
    cleanupPath(lockPath);
  }
}

// fallow-ignore-next-line complexity
export function commitUiPrimitiveChangesAtomically(
  changes: PreparedFileChange[],
  options: AtomicCommitOptions = {},
): void {
  if (changes.length === 0) return;
  const installations: PendingInstallation[] = changes.map((change) => ({
    ...change,
    ...stagingPaths(change.path),
  }));
  const journalPath =
    options.journalPath ?? uiPrimitiveTransactionJournalPath(installations.map(({ path }) => path));
  const entries = installations.map(({ path }) => ({ path }));
  const allowedPaths = options.allowedPaths ?? installations.map(({ path }) => path);
  if (
    new Set(allowedPaths).size !== allowedPaths.length ||
    allowedPaths.some((path) => resolve(path) !== path) ||
    entries.some(({ path }) => !allowedPaths.includes(path))
  ) {
    throw new Error("Atomic sync changes must be a subset of unique absolute allowed paths");
  }

  const lockPath = acquireTransactionLock(journalPath);
  try {
    if (existsSync(journalPath)) {
      throw new Error(`unfinished sync transaction requires recovery: ${journalPath}`);
    }
    for (const item of installations) {
      if (existsSync(item.temporaryPath) || existsSync(item.backupPath)) {
        throw new Error(`refusing to overwrite stale sync staging file for ${item.path}`);
      }
    }

    writeTransactionJournal(journalPath, { version: 1, state: "preparing", entries });
    for (const item of installations)
      writeFileSync(item.temporaryPath, item.content, { flag: "wx" });
    for (const item of installations) {
      copyFileSync(item.path, item.backupPath, constants.COPYFILE_EXCL);
    }
    writeTransactionJournal(journalPath, { version: 1, state: "installing", entries });
    for (const [index, item] of installations.entries()) {
      options.beforeInstall?.(item.path, index);
      renameSync(item.temporaryPath, item.path);
    }
    writeTransactionJournal(journalPath, { version: 1, state: "committed", entries });
    for (const item of installations) cleanupPath(item.backupPath);
    cleanupPath(journalPath);
  } catch (error) {
    if (existsSync(journalPath)) recoverTransaction(journalPath, allowedPaths);
    throw error;
  } finally {
    cleanupPath(`${journalPath}.next`);
    cleanupPath(lockPath);
  }
}

export function syncUiPrimitiveFiles(options: SyncPrimitiveOptions): SyncPrimitiveResult {
  if (options.mode === "write") {
    recoverUiPrimitiveChanges([options.canonicalPath, options.demoPath]);
  }
  const prepared = prepareUiPrimitiveFiles(options);
  if (options.mode === "write") commitUiPrimitiveChangesAtomically(prepared.changes);
  return {
    id: prepared.id,
    canonicalChanged: prepared.canonicalChanged,
    demoChanged: prepared.demoChanged,
  };
}

export interface SyncRunOptions {
  repoRoot: string;
  mode: SyncMode;
  only?: string;
}

export interface SyncRunResult {
  selected: number;
  changed: string[];
  errors: string[];
}

// fallow-ignore-next-line complexity
export function syncUiPrimitives(options: SyncRunOptions): SyncRunResult {
  const scope = loadUiPrimitiveScope(
    resolve(options.repoRoot, "registry/ui-primitives/operator-black.scope.json"),
  );
  const tokens = loadOperatorBlackTokens(
    resolve(options.repoRoot, "registry/ui-primitives/operator-black.tokens.json"),
  );
  if (options.only && !scope.items.includes(options.only)) {
    throw new Error(`Unknown Operator Black primitive: ${options.only}`);
  }
  const selected = options.only ? [options.only] : scope.items;
  const tokenBlock = renderOperatorBlackTokenBlock(tokens);
  const changed: string[] = [];
  const errors: string[] = [];
  const prepared: PreparedPrimitive[] = [];
  const allowedScopePaths = scope.items.flatMap((id) => {
    const root = resolve(options.repoRoot, "registry/components", id);
    return [resolve(root, `${id}.html`), resolve(root, "demo.html")];
  });
  const journalPath = resolve(
    options.repoRoot,
    "registry/ui-primitives/.operator-black-sync.transaction.json",
  );

  if (options.mode === "write") {
    recoverUiPrimitiveChanges(allowedScopePaths, journalPath);
  }

  for (const id of selected) {
    const root = resolve(options.repoRoot, "registry/components", id);
    const canonicalPath = resolve(root, `${id}.html`);
    const demoPath = resolve(root, "demo.html");
    try {
      const result = prepareUiPrimitiveFiles({
        id,
        canonicalPath,
        demoPath,
        tokenBlock,
        mode: "check",
      });
      prepared.push(result);
      if (result.canonicalChanged || result.demoChanged) changed.push(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${id}: ${message}`);
    }
  }

  if (options.mode === "write" && errors.length === 0) {
    try {
      commitUiPrimitiveChangesAtomically(
        prepared.flatMap((item) => item.changes),
        {
          journalPath,
          allowedPaths: allowedScopePaths,
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`write transaction: ${message}`);
    }
  }

  return { selected: selected.length, changed, errors };
}

interface CliOptions {
  mode: SyncMode;
  only?: string;
}

// fallow-ignore-next-line complexity
export function parseSyncCliOptions(args: string[]): CliOptions {
  let mode: SyncMode | undefined;
  let only: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--write" || arg === "--check") {
      const nextMode: SyncMode = arg === "--write" ? "write" : "check";
      if (mode) throw new Error("Choose exactly one occurrence of --write or --check");
      mode = nextMode;
    } else if (arg === "--only") {
      if (only) throw new Error("--only may be supplied only once");
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--only requires a primitive ID");
      only = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg ?? ""}`);
    }
  }
  if (!mode) throw new Error("Choose exactly one of --write or --check");
  return only ? { mode, only } : { mode };
}

function main(): void {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(scriptDir, "..");
  try {
    const cli = parseSyncCliOptions(process.argv.slice(2));
    const result = syncUiPrimitives({ repoRoot, ...cli });
    for (const error of result.errors) console.error(`✗ ${error}`);
    if (cli.mode === "check" && result.changed.length > 0) {
      console.error(`✗ sync drift: ${result.changed.join(", ")}`);
    }
    const failures = result.errors.length + (cli.mode === "check" ? result.changed.length : 0);
    console.log(
      `Operator Black sync: ${result.selected} selected, ${result.changed.length} changed, ${result.errors.length} errors`,
    );
    if (failures > 0) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) main();
