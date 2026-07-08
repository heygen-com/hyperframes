import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import type { Dimensions, RegistryItem, RegistryItemKind } from "./types.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(scriptDir, "../..");
const registryRoot = join(repoRoot, "registry");

const DEFAULT_DIMENSIONS: Dimensions = { width: 1920, height: 1080 };
const DEFAULT_DURATION_SECONDS = 5;
const DEFAULT_FPS = 30;

type RegistryFile = {
  path: string;
  target?: string;
  type: string;
};

export function discoverRegistryItems(): RegistryItem[] {
  return [...discoverBlocks(), ...discoverComponents(), ...discoverExamples()].sort((a, b) =>
    a.key.localeCompare(b.key),
  );
}

export function findRegistryItem(keyOrName: string): RegistryItem | null {
  const items = discoverRegistryItems();
  return (
    items.find((item) => item.key === keyOrName) ??
    items.find((item) => item.name === keyOrName) ??
    null
  );
}

export function safeItemPathSegment(item: RegistryItem): string {
  return `${item.kind}-${item.name}`.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

export function prepareProjectDir(item: RegistryItem, tempDir: string): string {
  const projectDir = join(tempDir, safeItemPathSegment(item));
  rmSync(projectDir, { recursive: true, force: true });
  mkdirSync(projectDir, { recursive: true });
  cpSync(item.sourceDir, projectDir, { recursive: true });

  if (item.kind === "example") {
    patchExamplePlaceholders(projectDir, item.duration);
    materializeManifestTargets(projectDir);
    if (item.name === "vscode-theme-visualizer") {
      runVscodeThemeBuild(projectDir);
    }
  }

  ensureIndexHtml(projectDir, item);
  return projectDir;
}

export function preparedCompositionEntry(projectDir: string, item: RegistryItem): string {
  if (item.kind === "example") return item.entryFile;
  return isStandaloneCompositionFile(join(projectDir, item.entryFile))
    ? item.entryFile
    : "index.html";
}

function discoverBlocks(): RegistryItem[] {
  return discoverItemDirs("block", join(registryRoot, "blocks")).flatMap((sourceDir) => {
    const name = sourceDirName(sourceDir);
    const manifest = readRegistryManifest(sourceDir);
    const files = registryFiles(manifest);
    const composition = files.find((file) => file.type === "hyperframes:composition");
    const entryFile = composition?.path ?? `${name}.html`;
    const htmlPath = join(sourceDir, entryFile);
    if (!existsSync(htmlPath)) return [];
    const html = readFileSync(htmlPath, "utf-8");
    return [
      itemFromParts({
        kind: "block",
        name,
        sourceDir,
        entryFile,
        manifest,
        html,
      }),
    ];
  });
}

function discoverComponents(): RegistryItem[] {
  return discoverItemDirs("component", join(registryRoot, "components")).flatMap((sourceDir) => {
    const entryFile = "demo.html";
    const htmlPath = join(sourceDir, entryFile);
    if (!existsSync(htmlPath)) return [];
    const name = sourceDirName(sourceDir);
    const manifest = readRegistryManifest(sourceDir);
    const html = readFileSync(htmlPath, "utf-8");
    return [
      itemFromParts({
        kind: "component",
        name,
        sourceDir,
        entryFile,
        manifest,
        html,
      }),
    ];
  });
}

function discoverExamples(): RegistryItem[] {
  return discoverItemDirs("example", join(registryRoot, "examples")).flatMap((sourceDir) => {
    const entryFile = "index.html";
    const htmlPath = join(sourceDir, entryFile);
    if (!existsSync(htmlPath)) return [];
    const name = sourceDirName(sourceDir);
    const manifest = readRegistryManifest(sourceDir);
    const html = readFileSync(htmlPath, "utf-8");
    return [
      itemFromParts({
        kind: "example",
        name,
        sourceDir,
        entryFile,
        manifest,
        html: patchDurationTokens(html, readManifestDuration(manifest) ?? DEFAULT_DURATION_SECONDS),
      }),
    ];
  });
}

function discoverItemDirs(kind: RegistryItemKind, kindDir: string): string[] {
  if (!existsSync(kindDir)) return [];
  return readdirSync(kindDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(kindDir, entry.name))
    .filter((sourceDir) => {
      if (kind === "component") return existsSync(join(sourceDir, "demo.html"));
      if (kind === "example") return existsSync(join(sourceDir, "index.html"));
      return existsSync(join(sourceDir, "registry-item.json"));
    })
    .sort((a, b) => sourceDirName(a).localeCompare(sourceDirName(b)));
}

function itemFromParts(input: {
  kind: RegistryItemKind;
  name: string;
  sourceDir: string;
  entryFile: string;
  manifest: Record<string, unknown> | null;
  html: string;
}): RegistryItem {
  const manifestDimensions = readManifestDimensions(input.manifest);
  const htmlDimensions = inferDimensionsFromHtml(input.html);
  const manifestDuration = readManifestDuration(input.manifest);
  const htmlDuration = inferDurationFromHtml(input.html);
  const dimensions = manifestDimensions ?? htmlDimensions ?? DEFAULT_DIMENSIONS;
  const duration = manifestDuration ?? htmlDuration ?? DEFAULT_DURATION_SECONDS;
  const notes = htmlDuration === null && manifestDuration === null ? ["duration-fallback-5s"] : [];

  return {
    key: `${input.kind}/${input.name}`,
    name: input.name,
    kind: input.kind,
    sourceDir: input.sourceDir,
    itemDirRelative: relative(repoRoot, input.sourceDir),
    entryFile: input.entryFile,
    dimensions,
    duration,
    fps: DEFAULT_FPS,
    notes,
  };
}

function readRegistryManifest(sourceDir: string): Record<string, unknown> | null {
  const path = join(sourceDir, "registry-item.json");
  if (!existsSync(path)) return null;
  const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
  return isRecord(parsed) ? parsed : null;
}

function registryFiles(manifest: Record<string, unknown> | null): RegistryFile[] {
  const files = manifest?.files;
  if (!Array.isArray(files)) return [];
  return files.filter(isRegistryFile);
}

function isRegistryFile(value: unknown): value is RegistryFile {
  if (!isRecord(value)) return false;
  return typeof value.path === "string" && typeof value.type === "string";
}

function readManifestDimensions(manifest: Record<string, unknown> | null): Dimensions | null {
  const dimensions = manifest?.dimensions;
  if (!isRecord(dimensions)) return null;
  return readDimensions(dimensions.width, dimensions.height);
}

function readManifestDuration(manifest: Record<string, unknown> | null): number | null {
  return finitePositiveNumber(manifest?.duration);
}

function inferDimensionsFromHtml(html: string): Dimensions | null {
  const width = firstNumberAttribute(html, "data-width") ?? firstViewportNumber(html, "width");
  const height = firstNumberAttribute(html, "data-height") ?? firstViewportNumber(html, "height");
  return readDimensions(width, height);
}

function inferDurationFromHtml(html: string): number | null {
  const rootDuration = firstNumberAttribute(html, "data-duration");
  if (rootDuration !== null) return rootDuration;

  let maxEnd = 0;
  const tagRegex = /<[^>]+>/g;
  for (const match of html.matchAll(tagRegex)) {
    const tag = match[0] ?? "";
    const start = firstNumberAttribute(tag, "data-start") ?? 0;
    const duration = firstNumberAttribute(tag, "data-duration");
    if (duration !== null) maxEnd = Math.max(maxEnd, start + duration);
  }
  return maxEnd > 0 ? maxEnd : null;
}

function firstNumberAttribute(html: string, attribute: string): number | null {
  const regex = new RegExp(`${attribute}=["']([^"']+)["']`);
  const raw = regex.exec(html)?.[1];
  return finitePositiveNumber(raw);
}

function firstViewportNumber(html: string, name: "width" | "height"): number | null {
  const regex = new RegExp(
    `<meta[^>]+name=["']viewport["'][^>]+content=["'][^"']*${name}=([0-9.]+)`,
  );
  const raw = regex.exec(html)?.[1];
  return finitePositiveNumber(raw);
}

function readDimensions(width: unknown, height: unknown): Dimensions | null {
  const parsedWidth = finitePositiveNumber(width);
  const parsedHeight = finitePositiveNumber(height);
  if (parsedWidth === null || parsedHeight === null) return null;
  return { width: Math.round(parsedWidth), height: Math.round(parsedHeight) };
}

function finitePositiveNumber(value: unknown): number | null {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sourceDirName(sourceDir: string): string {
  return sourceDir.split("/").filter(Boolean).at(-1) ?? sourceDir;
}

function patchExamplePlaceholders(projectDir: string, duration: number): void {
  for (const file of htmlFiles(projectDir)) {
    const current = readFileSync(file, "utf-8");
    const patched = patchDurationTokens(current, duration)
      .replace(/<video[^>]*src=["']__VIDEO_SRC__["'][^>]*>[\s\S]*?<\/video>/g, "")
      .replace(/<video[^>]*src=["']__VIDEO_SRC__["'][^>]*>/g, "")
      .replace(/<audio[^>]*src=["']__VIDEO_SRC__["'][^>]*>[\s\S]*?<\/audio>/g, "")
      .replace(/<audio[^>]*src=["']__VIDEO_SRC__["'][^>]*>/g, "");
    if (patched !== current) writeFileSync(file, patched, "utf-8");
  }
}

function patchDurationTokens(html: string, duration: number): string {
  return html.replaceAll("__VIDEO_DURATION__", String(Math.round(duration * 100) / 100));
}

function materializeManifestTargets(projectDir: string): void {
  const manifest = readRegistryManifest(projectDir);
  for (const file of registryFiles(manifest)) {
    const target = file.target;
    if (typeof target !== "string" || target === file.path) continue;
    const source = join(projectDir, file.path);
    const dest = join(projectDir, target);
    if (existsSync(dest) || !existsSync(source)) continue;
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(source, dest, { recursive: true });
  }
}

function runVscodeThemeBuild(projectDir: string): void {
  const script = join(projectDir, "scripts/build-compositions.mjs");
  if (!existsSync(script)) return;
  const result = spawnSync("node", [script], {
    cwd: projectDir,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || "vscode theme composition generation failed");
  }
}

function ensureIndexHtml(projectDir: string, item: RegistryItem): void {
  const indexPath = join(projectDir, "index.html");
  if (existsSync(indexPath)) return;
  const entryPath = join(projectDir, item.entryFile);
  const standalone = isStandaloneCompositionFile(entryPath);
  const body = standalone
    ? ""
    : `<div data-composition-id="index" data-start="0" data-width="${item.dimensions.width}" data-height="${item.dimensions.height}" data-duration="${item.duration}">
      <div data-composition-id="${item.name}" data-composition-src="${item.entryFile}" data-start="0" data-duration="${item.duration}" data-track-index="0" data-width="${item.dimensions.width}" data-height="${item.dimensions.height}"></div>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines.index = gsap.timeline({ paused: true });
    </script>`;
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${item.dimensions.width}, height=${item.dimensions.height}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>html,body{margin:0;width:${item.dimensions.width}px;height:${item.dimensions.height}px;overflow:hidden;background:#fff;}</style>
  </head>
  <body>
    ${body}
  </body>
</html>
`;
  writeFileSync(indexPath, html, "utf-8");
}

function isStandaloneCompositionFile(path: string): boolean {
  if (!existsSync(path)) return false;
  const html = readFileSync(path, "utf-8");
  return html.includes("data-composition-id") && html.includes("__timelines");
}

function htmlFiles(projectDir: string): string[] {
  const files: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.isFile() && entry.name.endsWith(".html")) {
        files.push(path);
      }
    }
  };
  visit(projectDir);
  return files;
}
