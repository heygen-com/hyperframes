/**
 * Binding index — the machine-readable join between figma variable/style
 * identities and composition variables (design spec §7.1).
 *
 * Lives at .media/figma-bindings.jsonl, next to (but separate from) the
 * human-readable figma-tokens.json sidecar. Resolution is exact-ID only:
 * a missed link bakes a correct literal; a wrong link silently changes
 * color at the next brand refresh. Never match by value or name.
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readJsonlValues } from "./jsonl";
import { mediaDir } from "./manifest";

const BINDINGS_FILE = "figma-bindings.jsonl";

export interface FigmaBindingRecord {
  kind: "binding";
  /** the figma variable/style id as it appears in node data (exact match key) */
  figmaId: string;
  /** stable cross-file identity, when known ("id and key are stable over the lifetime") */
  key?: string;
  sourceFileKey: string;
  /** semantic→primitive alias chain, directly-bound id first */
  aliasChain?: string[];
  compositionVariableId: string;
  brandRole?: string;
  /** figma file version at import time — staleness check */
  version: string;
}

interface LibraryRecord {
  kind: "library";
  libraryKey: string;
  fileKey: string;
}

function bindingsPath(projectDir: string): string {
  return join(mediaDir(projectDir), BINDINGS_FILE);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBindingRecord(value: unknown): value is FigmaBindingRecord {
  return (
    isRecord(value) &&
    value.kind === "binding" &&
    typeof value.figmaId === "string" &&
    typeof value.sourceFileKey === "string" &&
    typeof value.compositionVariableId === "string" &&
    typeof value.version === "string"
  );
}

function isLibraryRecord(value: unknown): value is LibraryRecord {
  return (
    isRecord(value) &&
    value.kind === "library" &&
    typeof value.libraryKey === "string" &&
    typeof value.fileKey === "string"
  );
}

function readLines(projectDir: string): unknown[] {
  return readJsonlValues(bindingsPath(projectDir));
}

function appendLine(projectDir: string, record: unknown): void {
  mkdirSync(mediaDir(projectDir), { recursive: true });
  appendFileSync(bindingsPath(projectDir), JSON.stringify(record) + "\n");
}

export function readBindings(projectDir: string): FigmaBindingRecord[] {
  return readLines(projectDir).filter(isBindingRecord);
}

export function appendBinding(projectDir: string, record: FigmaBindingRecord): void {
  appendLine(projectDir, record);
}

/**
 * Upsert by figmaId: re-running a tokens import must REPLACE that file's
 * stale binding rows, not append duplicates — `findBindingByFigmaId`
 * returns the first match, so appended duplicates would pin lookups to the
 * stale record forever. Library rows and other files' bindings survive.
 */
export function upsertBindings(projectDir: string, records: FigmaBindingRecord[]): void {
  const incoming = new Set(records.map((r) => r.figmaId));
  const survivors = readLines(projectDir).filter(
    (line) => !(isBindingRecord(line) && incoming.has(line.figmaId)),
  );
  mkdirSync(mediaDir(projectDir), { recursive: true });
  const lines = [...survivors, ...records].map((r) => JSON.stringify(r)).join("\n");
  writeFileSync(bindingsPath(projectDir), lines.length > 0 ? lines + "\n" : "");
}

/** Exact-ID lookup, checking alias chains too. Never value/name matching. */
export function findBindingByFigmaId(
  projectDir: string,
  figmaId: string,
): FigmaBindingRecord | null {
  for (const b of readBindings(projectDir)) {
    if (b.figmaId === figmaId) return b;
    if (b.aliasChain?.includes(figmaId)) return b;
  }
  return null;
}

/** Answered "which file is this library?" mappings — asked once per project. */
export function readLibraryMap(projectDir: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const r of readLines(projectDir)) {
    if (isLibraryRecord(r)) map[r.libraryKey] = r.fileKey;
  }
  return map;
}

export function recordLibraryFile(projectDir: string, libraryKey: string, fileKey: string): void {
  const record: LibraryRecord = { kind: "library", libraryKey, fileKey };
  appendLine(projectDir, record);
}
