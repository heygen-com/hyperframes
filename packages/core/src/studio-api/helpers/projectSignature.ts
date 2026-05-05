import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { extname, isAbsolute, relative, resolve } from "node:path";

const SIGNATURE_TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".mjs",
  ".svg",
  ".ts",
  ".tsx",
]);
const SIGNATURE_EXCLUDED_DIRS = new Set([
  ".cache",
  ".git",
  ".hyperframes",
  ".next",
  ".vite",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "outputs",
  "renders",
]);
const MAX_SIGNATURE_TEXT_BYTES = 2_000_000;

interface ProjectSignatureFile {
  file: string;
  mtimeMs: number;
  size: number;
  textContentEligible: boolean;
}

interface ProjectSignatureCacheEntry {
  fingerprint: string;
  signature: string;
}

const projectSignatureCache = new Map<string, ProjectSignatureCacheEntry>();

function isPathWithin(parentDir: string, childPath: string): boolean {
  const childRelativePath = relative(parentDir, childPath);
  return (
    childRelativePath === "" ||
    (!childRelativePath.startsWith("..") && !isAbsolute(childRelativePath))
  );
}

function isTextContentEligible(file: string, size: number): boolean {
  return (
    SIGNATURE_TEXT_EXTENSIONS.has(extname(file).toLowerCase()) && size <= MAX_SIGNATURE_TEXT_BYTES
  );
}

function collectProjectSignatureFiles(
  projectDir: string,
  dir: string,
  files: ProjectSignatureFile[],
): void {
  let entries: string[];
  try {
    entries = readdirSync(dir).sort();
  } catch {
    return;
  }

  for (const entry of entries) {
    if (SIGNATURE_EXCLUDED_DIRS.has(entry)) continue;
    const file = resolve(dir, entry);
    if (!isPathWithin(projectDir, file)) continue;
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(file);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      collectProjectSignatureFiles(projectDir, file, files);
    } else if (stat.isFile()) {
      files.push({
        file,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        textContentEligible: isTextContentEligible(file, stat.size),
      });
    }
  }
}

function createProjectFingerprint(projectDir: string, files: ProjectSignatureFile[]): string {
  const hash = createHash("sha256");
  for (const entry of files) {
    hash.update(relative(projectDir, entry.file));
    hash.update("\0");
    hash.update(String(entry.size));
    hash.update("\0");
    hash.update(String(entry.mtimeMs));
    hash.update("\0");
    hash.update(entry.textContentEligible ? "text" : "binary");
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 24);
}

export function createProjectSignature(projectDir: string): string {
  const normalizedProjectDir = resolve(projectDir);
  const files: ProjectSignatureFile[] = [];
  collectProjectSignatureFiles(normalizedProjectDir, normalizedProjectDir, files);
  files.sort((a, b) => a.file.localeCompare(b.file));

  const fingerprint = createProjectFingerprint(normalizedProjectDir, files);
  const cached = projectSignatureCache.get(normalizedProjectDir);
  if (cached?.fingerprint === fingerprint) return cached.signature;

  const hash = createHash("sha256");
  for (const entry of files) {
    const relativePath = relative(normalizedProjectDir, entry.file);
    hash.update(relativePath);
    hash.update("\0");
    hash.update(String(entry.size));
    hash.update("\0");
    if (entry.textContentEligible) {
      try {
        hash.update(readFileSync(entry.file));
      } catch {
        hash.update(String(entry.mtimeMs));
      }
    } else {
      hash.update(String(entry.mtimeMs));
    }
    hash.update("\0");
  }
  const signature = hash.digest("hex").slice(0, 24);
  projectSignatureCache.set(normalizedProjectDir, { fingerprint, signature });
  return signature;
}
