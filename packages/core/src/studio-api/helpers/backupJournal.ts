import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import { join, relative } from "node:path";
import { isSafePath } from "./safePath.js";

const DEFAULT_KEEP_PER_FILE = 10;

export interface BackupJournalResult {
  backupPath: string | null;
  error?: string;
}

function backupKeyForPath(path: string): string {
  return Buffer.from(path, "utf-8").toString("base64url");
}

function timestampPrefix(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function backupPathForResponse(
  projectDir: string,
  backupPath: string | null,
): string | null {
  if (!backupPath) return null;
  const rel = relative(projectDir, backupPath);
  if (!rel || rel.startsWith("..")) return null;
  return rel.split("\\").join("/");
}

export function snapshotBeforeWrite(
  projectDir: string,
  absPath: string,
  options: { keepPerFile?: number } = {},
): BackupJournalResult {
  if (!isSafePath(projectDir, absPath)) return { backupPath: null };

  try {
    const content = readFileSync(absPath);

    const relativePath = relative(projectDir, absPath);
    const backupDir = join(projectDir, ".hyperframes", "backup");
    mkdirSync(backupDir, { recursive: true });

    const backupKey = backupKeyForPath(relativePath);
    const backupPath = nextBackupPath(backupDir, backupKey);
    writeFileSync(backupPath, content);
    pruneBackups(backupDir, backupKey, options.keepPerFile ?? DEFAULT_KEEP_PER_FILE);
    return { backupPath };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "EISDIR")
    ) {
      return { backupPath: null };
    }
    return { backupPath: null, error: error instanceof Error ? error.message : String(error) };
  }
}

function nextBackupPath(backupDir: string, backupKey: string): string {
  const base = `${timestampPrefix()}-${backupKey}`;
  let candidate = join(backupDir, base);
  let counter = 2;
  while (true) {
    try {
      readFileSync(candidate);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return candidate;
      }
      throw error;
    }
    candidate = join(backupDir, `${base}-${counter}`);
    counter += 1;
  }
}

function pruneBackups(backupDir: string, backupKey: string, keepPerFile: number): void {
  const keep = Math.max(1, Math.floor(keepPerFile));
  const suffix = `-${backupKey}`;
  const numberedSuffix = new RegExp(`-${backupKey}-\\d+$`);
  const matches = readdirSync(backupDir)
    .filter((name) => name.endsWith(suffix) || numberedSuffix.test(name))
    .map((name) => join(backupDir, name))
    .sort((a, b) => {
      return b.localeCompare(a);
    });

  for (const file of matches.slice(keep)) {
    try {
      unlinkSync(file);
    } catch {
      // Backup pruning is best-effort and must not block the user's write.
    }
  }
}
