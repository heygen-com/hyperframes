import { copyFileSync, type Dirent, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import {
  basename,
  delimiter,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { homedir } from "node:os";
import { assertSafeTarget } from "../registry/installer.js";
import type { ProjectConfig, ProjectAssetLibraryConfig } from "../utils/projectConfig.js";

export type AssetKind = "image" | "video" | "audio" | "font" | "lottie" | "data";

export const ASSET_KINDS = [
  "image",
  "video",
  "audio",
  "font",
  "lottie",
  "data",
] as const satisfies readonly AssetKind[];

export type AssetLibrarySource = "project" | "env" | "default";

export interface ResolvedAssetLibrary {
  name: string;
  path: string;
  source: AssetLibrarySource;
}

export interface AssetMatch {
  id: string;
  name: string;
  kind: AssetKind;
  path: string;
  relativePath: string;
  extension: string;
  size: number;
  library: ResolvedAssetLibrary;
}

export interface ResolveAssetLibrariesOptions {
  projectDir: string;
  config: ProjectConfig;
  env?: NodeJS.ProcessEnv;
}

export interface ScanAssetLibrariesOptions {
  libraries: ResolvedAssetLibrary[];
  query?: string;
  kind?: AssetKind;
  limit?: number;
  maxScanFiles?: number;
}

export interface CopyAssetOptions {
  asset: AssetMatch;
  projectDir: string;
  assetsDir: string;
  target?: string;
  force?: boolean;
}

export interface CopyAssetResult {
  source: string;
  target: string;
  relativeTarget: string;
  src: string;
}

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".webm", ".avi"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"]);
const FONT_EXTENSIONS = new Set([".otf", ".ttf", ".woff", ".woff2"]);
const DATA_EXTENSIONS = new Set([".csv", ".json", ".srt", ".tsv", ".vtt"]);
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "renders", "output"]);
const DEFAULT_SCAN_LIMIT = 50;
const DEFAULT_MAX_SCAN_FILES = 10_000;

function toPosixPath(path: string): string {
  return path.split(sep).join("/");
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function displayNameForPath(path: string, fallback: string): string {
  return basename(path) || fallback;
}

export function expandAssetPath(path: string, projectDir: string): string {
  let expanded = path.trim();
  if (expanded === "~") {
    expanded = homedir();
  } else if (expanded.startsWith("~/") || expanded.startsWith("~\\")) {
    expanded = join(homedir(), expanded.slice(2));
  } else if (expanded === "$HOME" || expanded === "${HOME}") {
    expanded = homedir();
  } else if (expanded.startsWith("$HOME/") || expanded.startsWith("$HOME\\")) {
    expanded = join(homedir(), expanded.slice(6));
  } else if (expanded.startsWith("${HOME}/") || expanded.startsWith("${HOME}\\")) {
    expanded = join(homedir(), expanded.slice(8));
  }
  return isAbsolute(expanded) ? resolve(expanded) : resolve(projectDir, expanded);
}

function envLibraryPaths(env: NodeJS.ProcessEnv): string[] {
  const raw = [env.HYPERFRAMES_ASSET_LIBRARY, env.HYPERFRAMES_ASSET_LIBRARIES].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  return raw.flatMap((value) =>
    value
      .split(delimiter)
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

function pushLibrary(
  libraries: ResolvedAssetLibrary[],
  seen: Set<string>,
  input: ProjectAssetLibraryConfig,
  source: AssetLibrarySource,
  projectDir: string,
  fallbackName: string,
): void {
  const path = expandAssetPath(input.path, projectDir);
  if (seen.has(path) || !isDirectory(path)) return;
  seen.add(path);
  libraries.push({
    name: input.name?.trim() || displayNameForPath(path, fallbackName),
    path,
    source,
  });
}

export function resolveAssetLibraries(
  options: ResolveAssetLibrariesOptions,
): ResolvedAssetLibrary[] {
  const env = options.env ?? process.env;
  const libraries: ResolvedAssetLibrary[] = [];
  const seen = new Set<string>();

  for (const [index, library] of options.config.assetLibraries.entries()) {
    pushLibrary(libraries, seen, library, "project", options.projectDir, `library-${index + 1}`);
  }

  envLibraryPaths(env).forEach((path, index) => {
    pushLibrary(
      libraries,
      seen,
      { name: `env-${index + 1}`, path },
      "env",
      options.projectDir,
      `env-${index + 1}`,
    );
  });

  pushLibrary(
    libraries,
    seen,
    { name: "HyperFrames assets", path: join(homedir(), ".hyperframes", "assets") },
    "default",
    options.projectDir,
    "HyperFrames assets",
  );

  return libraries;
}

export function inferAssetKind(path: string): AssetKind | undefined {
  const ext = extname(path).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (FONT_EXTENSIONS.has(ext)) return "font";
  if (ext === ".lottie") return "lottie";
  if (ext === ".json" && path.toLowerCase().includes("lottie")) return "lottie";
  if (DATA_EXTENSIONS.has(ext)) return "data";
  return undefined;
}

function normalizeSearchText(input: string): string {
  return input.toLowerCase().replace(/[_-]+/g, " ");
}

function scoreAsset(asset: AssetMatch, query: string | undefined): number | undefined {
  const trimmed = query?.trim();
  if (!trimmed) return 0;

  const normalizedQuery = normalizeSearchText(trimmed);
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const filename = normalizeSearchText(asset.name);
  const filenameWithoutExt = normalizeSearchText(asset.name.replace(/\.[^.]+$/, ""));
  const relativePath = normalizeSearchText(asset.relativePath);
  const haystack = `${filename} ${relativePath} ${normalizeSearchText(asset.library.name)} ${asset.kind}`;

  if (!tokens.every((token) => haystack.includes(token))) return undefined;

  let score = 100;
  if (filenameWithoutExt === normalizedQuery) score -= 70;
  if (filename.startsWith(normalizedQuery)) score -= 40;
  if (relativePath.startsWith(normalizedQuery)) score -= 25;
  if (relativePath.includes(`/${normalizedQuery}`)) score -= 10;
  score += asset.relativePath.length / 1000;
  return score;
}

function readDirectory(path: string): Dirent[] {
  try {
    return readdirSync(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

function fileAsset(
  library: ResolvedAssetLibrary,
  path: string,
  name: string,
): AssetMatch | undefined {
  const kind = inferAssetKind(path);
  if (!kind) return undefined;

  let size = 0;
  try {
    size = statSync(path).size;
  } catch {
    return undefined;
  }

  const relativePath = toPosixPath(relative(library.path, path));
  return {
    id: `${library.name}:${relativePath}`,
    name,
    kind,
    path,
    relativePath,
    extension: extname(name).toLowerCase(),
    size,
    library,
  };
}

function scanEntry(
  library: ResolvedAssetLibrary,
  currentDir: string,
  entry: Dirent,
): { asset?: AssetMatch; nextDir?: string; countedFile: boolean } {
  if (entry.name.startsWith(".")) return { countedFile: false };

  const path = join(currentDir, entry.name);
  if (entry.isDirectory()) {
    return { nextDir: SKIP_DIRS.has(entry.name) ? undefined : path, countedFile: false };
  }
  if (!entry.isFile()) return { countedFile: false };

  return { asset: fileAsset(library, path, entry.name), countedFile: true };
}

interface DirectoryScanResult {
  assets: AssetMatch[];
  nextDirs: string[];
  countedFiles: number;
}

function scanDirectory(
  library: ResolvedAssetLibrary,
  currentDir: string,
  maxFiles: number,
): DirectoryScanResult {
  const result: DirectoryScanResult = { assets: [], nextDirs: [], countedFiles: 0 };

  for (const entry of readDirectory(currentDir)) {
    if (result.countedFiles >= maxFiles) return result;
    const scanned = scanEntry(library, currentDir, entry);
    if (scanned.nextDir) result.nextDirs.push(scanned.nextDir);
    if (scanned.asset) result.assets.push(scanned.asset);
    if (scanned.countedFile) result.countedFiles++;
  }

  return result;
}

function scanLibrary(library: ResolvedAssetLibrary, maxScanFiles: number): AssetMatch[] {
  const assets: AssetMatch[] = [];
  const stack = [library.path];
  let scanned = 0;

  while (stack.length > 0 && scanned < maxScanFiles) {
    const current = stack.pop();
    if (!current) break;

    const result = scanDirectory(library, current, maxScanFiles - scanned);
    stack.push(...result.nextDirs);
    assets.push(...result.assets);
    scanned += result.countedFiles;
  }

  return assets;
}

export function scanAssetLibraries(options: ScanAssetLibrariesOptions): AssetMatch[] {
  const maxScanFiles = options.maxScanFiles ?? DEFAULT_MAX_SCAN_FILES;
  const limit = Math.max(0, options.limit ?? DEFAULT_SCAN_LIMIT);
  const scored: { asset: AssetMatch; score: number }[] = [];

  for (const library of options.libraries) {
    for (const asset of scanLibrary(library, maxScanFiles)) {
      if (options.kind && asset.kind !== options.kind) continue;
      const score = scoreAsset(asset, options.query);
      if (score === undefined) continue;
      scored.push({ asset, score });
    }
  }

  return scored
    .sort(
      (a, b) =>
        a.score - b.score ||
        a.asset.library.name.localeCompare(b.asset.library.name) ||
        a.asset.relativePath.localeCompare(b.asset.relativePath),
    )
    .slice(0, limit)
    .map((entry) => entry.asset);
}

export function copyAssetToProject(options: CopyAssetOptions): CopyAssetResult {
  const assetsDir = options.assetsDir.replace(/[/\\]+$/, "") || ".";
  const targetWithinAssets = options.target?.trim() || options.asset.relativePath;
  const relativeTarget = toPosixPath(join(assetsDir, targetWithinAssets));
  assertSafeTarget(options.projectDir, relativeTarget);

  const target = resolve(options.projectDir, relativeTarget);
  if (existsSync(target) && options.force !== true) {
    throw new Error(`Refusing to overwrite existing asset: ${relativeTarget}. Use --force.`);
  }

  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(options.asset.path, target);

  return {
    source: options.asset.path,
    target,
    relativeTarget,
    src: toPosixPath(relative(options.projectDir, target)),
  };
}
