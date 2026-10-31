import { readRenderOutputsOrNone, isRenderOutput } from "./renderOutputs.js";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, type Stats } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { isAtomicTempPath } from "@hyperframes/core/atomic-file";
import { isProjectIgnoredDir } from "@hyperframes/core/project-folders";
import type { ResolvedProject, StudioApiAdapter } from "../types.js";

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
const MAX_SIGNATURE_TEXT_BYTES = 2_000_000;
export const STUDIO_SIGNATURE_MANIFEST_PATHS = [
  ".hyperframes/studio-manual-edits.json",
  ".hyperframes/studio-motion.json",
] as const;

/**
 * Whether a write at `changedPath` can change `createProjectSignature(projectDir)`.
 *
 * Owned here because it is the exact complement of what the walk below collects,
 * and a second copy of that reasoning drifts the moment either set changes. A
 * watcher that invalidates on everything is not merely wasteful: `.thumbnails/`
 * is written by the thumbnail route on every capture, and each capture reads the
 * preview, so an unfiltered watcher discards the memo on roughly every request of
 * the one workload the memo exists for.
 *
 * The watcher shares `isProjectIgnoredDir` but drops all of `.hyperframes/`; the two
 * manifest files read from inside it are let through first so motion-state saves invalidate.
 *
 * Every segment is tested, not just the parents, so a directory event on an
 * excluded dir itself (`unlinkDir .thumbnails`) is filtered too. The cost is that
 * a *file* literally named `dist` at the project root reads as excluded; the walk
 * would collect it, so it is a false negative, and no real project has one.
 */
export function affectsProjectSignature(projectDir: string, changedPath: string): boolean {
  const relativePath = relative(resolve(projectDir), resolve(changedPath));
  if (
    relativePath === "" ||
    relativePath.startsWith("..") ||
    isAbsolute(relativePath) ||
    isAtomicTempPath(relativePath)
  ) {
    return false;
  }
  if (isRenderOutput(projectDir, changedPath, readRenderOutputsOrNone(projectDir))) return false;
  const segments = relativePath.split(sep);
  if (STUDIO_SIGNATURE_MANIFEST_PATHS.includes(segments.join("/") as never)) return true;
  return !segments.some(isProjectIgnoredDir);
}

interface ProjectSignatureFile {
  file: string;
  mtimeMs: number;
  ctimeMs: number;
  size: number;
  textContentEligible: boolean;
}

interface ProjectSignatureCacheEntry {
  fingerprint: string;
  signature: string;
}

const projectSignatureCache = new Map<string, ProjectSignatureCacheEntry>();
const COARSEST_FILE_TIME_TICK_MS = 2000;

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

const isSkippedEntry = (entry: string) => isProjectIgnoredDir(entry) || isAtomicTempPath(entry);

function signatureEntryStat(
  projectDir: string,
  entry: string,
  file: string,
  outputs: readonly string[],
): Stats | null {
  if (isSkippedEntry(entry) || !isPathWithin(projectDir, file)) return null;
  if (isRenderOutput(projectDir, file, outputs)) return null;
  try {
    const stat = lstatSync(file);
    return stat.isSymbolicLink() ? null : stat;
  } catch {
    return null;
  }
}

function signatureFileOf(file: string, stat: Stats): ProjectSignatureFile {
  return {
    file,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
    size: stat.size,
    textContentEligible: isTextContentEligible(file, stat.size),
  };
}

function collectProjectSignatureFiles(
  projectDir: string,
  dir: string,
  files: ProjectSignatureFile[],
  outputs = readRenderOutputsOrNone(projectDir),
): void {
  let entries: string[];
  try {
    entries = readdirSync(dir).sort();
  } catch {
    return;
  }

  for (const entry of entries) {
    const file = resolve(dir, entry);
    const stat = signatureEntryStat(projectDir, entry, file, outputs);
    if (!stat) continue;
    if (stat.isDirectory()) {
      collectProjectSignatureFiles(projectDir, file, files, outputs);
    } else if (stat.isFile()) {
      files.push(signatureFileOf(file, stat));
    }
  }
}

function collectProjectSignatureManifestFiles(
  projectDir: string,
  files: ProjectSignatureFile[],
): void {
  const seen = new Set(files.map((entry) => entry.file));
  for (const manifestPath of STUDIO_SIGNATURE_MANIFEST_PATHS) {
    const file = resolve(projectDir, manifestPath);
    if (seen.has(file) || !isPathWithin(projectDir, file)) continue;
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(file);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink() || !stat.isFile()) continue;
    files.push(signatureFileOf(file, stat));
    seen.add(file);
  }
}

async function signatureEntryStatAsync(
  projectDir: string,
  entry: string,
  file: string,
  outputs: readonly string[],
): Promise<Stats | null> {
  if (isSkippedEntry(entry) || !isPathWithin(projectDir, file)) return null;
  if (isRenderOutput(projectDir, file, outputs)) return null;
  try {
    const stat = await lstat(file);
    return stat.isSymbolicLink() ? null : stat;
  } catch {
    return null;
  }
}

async function collectProjectSignatureFilesAsync(
  projectDir: string,
  dir: string,
  files: ProjectSignatureFile[],
  outputs: readonly string[],
): Promise<void> {
  let entries: string[];
  try {
    entries = (await readdir(dir)).sort();
  } catch {
    return;
  }
  const paths = entries.map((entry) => resolve(dir, entry));
  const stats = await Promise.all(
    entries.map((entry, i) => signatureEntryStatAsync(projectDir, entry, paths[i]!, outputs)),
  );
  for (const [i, stat] of stats.entries()) {
    if (!stat) continue;
    if (stat.isDirectory()) {
      await collectProjectSignatureFilesAsync(projectDir, paths[i]!, files, outputs);
    } else if (stat.isFile()) {
      files.push(signatureFileOf(paths[i]!, stat));
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
    hash.update(String(entry.ctimeMs));
    hash.update("\0");
    hash.update(entry.textContentEligible ? "text" : "binary");
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 24);
}

function collectProjectFiles(normalizedProjectDir: string): ProjectSignatureFile[] {
  const collected: ProjectSignatureFile[] = [];
  collectProjectSignatureFiles(normalizedProjectDir, normalizedProjectDir, collected);
  collectProjectSignatureManifestFiles(normalizedProjectDir, collected);
  return collected;
}

async function collectProjectFilesAsync(
  normalizedProjectDir: string,
): Promise<ProjectSignatureFile[]> {
  const collected: ProjectSignatureFile[] = [];
  await collectProjectSignatureFilesAsync(
    normalizedProjectDir,
    normalizedProjectDir,
    collected,
    readRenderOutputsOrNone(normalizedProjectDir),
  );
  collectProjectSignatureManifestFiles(normalizedProjectDir, collected);
  return collected;
}

/** The files a project is made of (the signature's set: source plus Studio's two manifests), paths with `/`. */
export function listProjectFiles(
  projectDir: string,
): Array<{ path: string; size: number; mtimeMs: number; ctimeMs: number }> {
  const normalizedProjectDir = resolve(projectDir);
  return collectProjectFiles(normalizedProjectDir).map((entry) => ({
    path: relative(normalizedProjectDir, entry.file).split(sep).join("/"),
    size: entry.size,
    mtimeMs: entry.mtimeMs,
    ctimeMs: entry.ctimeMs,
  }));
}

/**
 * Resolve the project signature through the adapter's cached path when the host
 * provides one (the CLI invalidates its cache from the file watcher), falling
 * back to a direct computation.
 */
export function resolveProjectSignature(adapter: StudioApiAdapter, projectDir: string): string {
  return adapter.getProjectSignature?.(projectDir) ?? createProjectSignature(projectDir);
}

/** The shared route opening: resolve the project (null → caller 404s) with its signature. */
export async function resolveProjectAndSignature(
  adapter: StudioApiAdapter,
  projectId: string,
): Promise<{ project: ResolvedProject; signature: string } | null> {
  const project = await adapter.resolveProject(projectId);
  if (!project) return null;
  return { project, signature: resolveProjectSignature(adapter, project.dir) };
}

interface SignaturePlan {
  dir: string;
  files: ProjectSignatureFile[];
  cacheKey: string;
  fingerprint: string;
  signedAt: number;
}

function planSignature(
  dir: string,
  collected: ProjectSignatureFile[],
  excluding: ReadonlySet<string>,
  signedAt: number,
): SignaturePlan {
  const files = collected.filter(
    (entry) => !excluding.has(relative(dir, entry.file).split(sep).join("/")),
  );
  files.sort((a, b) => a.file.localeCompare(b.file));
  const cacheKey = excluding.size
    ? `${dir}\0${createHash("sha256")
        .update([...excluding].sort().join("\0"))
        .digest("hex")}`
    : dir;
  return { dir, files, cacheKey, fingerprint: createProjectFingerprint(dir, files), signedAt };
}

function hashSignatureEntry(
  hash: ReturnType<typeof createHash>,
  dir: string,
  entry: ProjectSignatureFile,
  content: Buffer | null,
): void {
  hash.update(relative(dir, entry.file));
  hash.update("\0");
  hash.update(String(entry.size));
  hash.update("\0");
  hash.update(content ?? String(entry.mtimeMs));
  hash.update("\0");
}

function finishSignature(plan: SignaturePlan, hash: ReturnType<typeof createHash>): string {
  const signature = hash.digest("hex").slice(0, 24);
  const settledATickBeforeSigning = plan.files.every(
    (entry) => Math.max(entry.mtimeMs, entry.ctimeMs) < plan.signedAt - COARSEST_FILE_TIME_TICK_MS,
  );
  if (settledATickBeforeSigning) {
    projectSignatureCache.set(plan.cacheKey, { fingerprint: plan.fingerprint, signature });
  }
  return signature;
}

const cachedSignature = (plan: SignaturePlan): string | undefined => {
  const cached = projectSignatureCache.get(plan.cacheKey);
  return cached?.fingerprint === plan.fingerprint ? cached.signature : undefined;
};

/**
 * Creates a stable preview cache-busting signature for project source plus Studio manifests.
 * `excluding` (project-relative paths) leaves those files out.
 */
export function createProjectSignature(
  projectDir: string,
  excluding: ReadonlySet<string> = new Set(),
): string {
  const dir = resolve(projectDir);
  const plan = planSignature(dir, collectProjectFiles(dir), excluding, Date.now());
  const cached = cachedSignature(plan);
  if (cached !== undefined) return cached;

  const hash = createHash("sha256");
  for (const entry of plan.files) {
    let content: Buffer | null = null;
    if (entry.textContentEligible) {
      try {
        content = readFileSync(entry.file);
      } catch {
        content = null;
      }
    }
    hashSignatureEntry(hash, dir, entry, content);
  }
  return finishSignature(plan, hash);
}

const SIGNATURE_READ_BATCH = 32;

/** `createProjectSignature` without blocking the event loop: the same signature, with the walk and reads awaited. */
export async function createProjectSignatureAsync(
  projectDir: string,
  excluding: ReadonlySet<string> = new Set(),
): Promise<string> {
  const dir = resolve(projectDir);
  const signedAt = Date.now();
  const plan = planSignature(dir, await collectProjectFilesAsync(dir), excluding, signedAt);
  const cached = cachedSignature(plan);
  if (cached !== undefined) return cached;

  const hash = createHash("sha256");
  for (let at = 0; at < plan.files.length; at += SIGNATURE_READ_BATCH) {
    const batch = plan.files.slice(at, at + SIGNATURE_READ_BATCH);
    const contents = await Promise.all(
      batch.map((entry) =>
        entry.textContentEligible ? readFile(entry.file).catch(() => null) : null,
      ),
    );
    for (const [i, entry] of batch.entries()) hashSignatureEntry(hash, dir, entry, contents[i]!);
  }
  return finishSignature(plan, hash);
}
