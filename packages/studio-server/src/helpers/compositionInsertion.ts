import { existsSync, readFileSync, realpathSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, relative, resolve, sep } from "node:path";
import { parseHTML } from "linkedom";
import { isSafePath, resolveWithinProject } from "./safePath.js";

export class CompositionInsertionError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404,
  ) {
    super(message);
  }
}

function descendants(root: Document | Element, selector: string): Element[] {
  const found = Array.from(root.querySelectorAll(selector));
  for (const template of root.querySelectorAll("template")) {
    found.push(...descendants(template, selector));
  }
  return [...new Set(found)];
}

function compositionRoot(source: string): { document: Document; root: Element } {
  const document = parseHTML(source).document;
  const root = descendants(document, "[data-composition-id]")[0];
  if (!root) throw new CompositionInsertionError("Composition source has no root", 400);
  return { document, root };
}

function positiveAttribute(root: Element, ...names: string[]): number {
  for (const name of names) {
    const value = Number.parseFloat(root.getAttribute(name) ?? "");
    if (Number.isFinite(value) && value > 0) return value;
  }
  throw new CompositionInsertionError(`Composition source has no valid ${names[0]}`, 400);
}

function canonicalProjectPath(projectDir: string, candidate: string | null): string {
  if (!candidate) {
    throw new CompositionInsertionError("Composition source escapes the project", 400);
  }
  if (!existsSync(candidate)) {
    throw new CompositionInsertionError("Composition source was not found", 404);
  }
  const canonical = realpathSync(candidate);
  if (!isSafePath(realpathSync(projectDir), canonical)) {
    throw new CompositionInsertionError("Composition source escapes the project", 400);
  }
  return canonical;
}

function validateSourcePath(sourcePath: string): void {
  if (!sourcePath.trim() || sourcePath.includes("\0") || /^[a-z]+:/i.test(sourcePath)) {
    throw new CompositionInsertionError("Invalid composition source path", 400);
  }
}

function canonicalProjectFile(projectDir: string, sourcePath: string): string {
  validateSourcePath(sourcePath);
  return canonicalProjectPath(projectDir, resolveWithinProject(projectDir, sourcePath));
}

function canonicalDependency(projectDir: string, ownerAbs: string, sourcePath: string): string {
  validateSourcePath(sourcePath);
  return canonicalProjectPath(
    projectDir,
    resolveWithinProject(projectDir, relative(projectDir, resolve(dirname(ownerAbs), sourcePath))),
  );
}

function validateDependencyGraph(projectDir: string, targetAbs: string, sourceAbs: string): void {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (file: string) => {
    if (file === targetAbs) {
      throw new CompositionInsertionError("Composition insertion would create a cycle", 400);
    }
    if (visiting.has(file)) {
      throw new CompositionInsertionError("Composition dependency cycle detected", 400);
    }
    if (visited.has(file)) return;
    visiting.add(file);
    const source = readFileSync(file, "utf-8");
    const { document } = compositionRoot(source);
    for (const host of descendants(document, "[data-composition-src]")) {
      const dependency = host.getAttribute("data-composition-src");
      if (dependency) {
        visit(canonicalDependency(projectDir, file, dependency));
      }
    }
    visiting.delete(file);
    visited.add(file);
  };
  visit(sourceAbs);
}

function numberAttribute(element: Element, name: string, fallback = 0): number {
  const value = Number.parseFloat(element.getAttribute(name) ?? "");
  return Number.isFinite(value) ? value : fallback;
}

function rangesOverlap(start: number, duration: number, other: Element): boolean {
  const otherStart = numberAttribute(other, "data-start");
  const otherDuration = numberAttribute(other, "data-duration");
  return start < otherStart + otherDuration && otherStart < start + duration;
}

function resolveTrack(
  root: Element,
  desiredTrack: number,
  start: number,
  duration: number,
): number {
  const clips = descendants(root, "[data-start][data-duration]").filter(
    (element) =>
      element !== root && element.parentElement?.closest("[data-composition-id]") === root,
  );
  const tracks = [...new Set(clips.map((clip) => numberAttribute(clip, "data-track-index")))].sort(
    (a, b) => a - b,
  );
  const isFree = (track: number) =>
    !clips.some(
      (clip) =>
        numberAttribute(clip, "data-track-index") === track && rangesOverlap(start, duration, clip),
    );
  if (isFree(desiredTrack)) return desiredTrack;
  const row = tracks.indexOf(desiredTrack);
  for (let index = row - 1; index >= 0; index--) {
    const track = tracks[index];
    if (track !== undefined && isFree(track)) return track;
  }
  for (let index = Math.max(0, row + 1); index < tracks.length; index++) {
    const track = tracks[index];
    if (track !== undefined && isFree(track)) return track;
  }
  return Math.max(desiredTrack, ...tracks, -1) + 1;
}

function uniqueHostId(root: Element, base: string): string {
  const ids = new Set([
    ...descendants(root, "[id]").map((element) => element.id),
    ...descendants(root, "[data-composition-id]").flatMap((element) => {
      const id = element.getAttribute("data-composition-id");
      return id ? [id] : [];
    }),
  ]);
  if (!ids.has(base)) return base;
  let suffix = 2;
  while (ids.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

function relativeSourcePath(targetAbs: string, sourceAbs: string): string {
  return relative(dirname(targetAbs), sourceAbs).split(sep).join("/");
}

export function insertCompositionIntoSource(input: {
  projectDir: string;
  targetPath: string;
  sourcePath: string;
  parentSource: string;
  start: number;
  desiredTrack: number;
}): { html: string; hostId: string; track: number; duration: number } {
  const targetAbs = canonicalProjectFile(input.projectDir, input.targetPath);
  const sourceAbs = canonicalProjectFile(input.projectDir, input.sourcePath);
  validateDependencyGraph(input.projectDir, targetAbs, sourceAbs);

  const source = readFileSync(sourceAbs, "utf-8");
  const sourceComposition = compositionRoot(source).root;
  const duration = positiveAttribute(
    sourceComposition,
    "data-composition-duration",
    "data-duration",
  );
  const width = positiveAttribute(sourceComposition, "data-width");
  const height = positiveAttribute(sourceComposition, "data-height");
  const { document, root } = compositionRoot(input.parentSource);
  const parentDuration = positiveAttribute(root, "data-duration", "data-composition-duration");
  const base =
    (sourceComposition.getAttribute("data-composition-id") ?? "composition")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "composition";
  const hostId = uniqueHostId(root, base);
  const track = resolveTrack(
    root,
    Math.max(0, Math.round(input.desiredTrack)),
    input.start,
    duration,
  );
  const zIndex =
    Math.max(
      0,
      ...descendants(root, "[style]").map((element) => {
        const match = /(?:^|;)\s*z-index\s*:\s*(-?\d+)/i.exec(element.getAttribute("style") ?? "");
        return match?.[1] ? Number.parseInt(match[1], 10) : 0;
      }),
    ) + 1;

  const host = document.createElement("div");
  host.id = hostId;
  host.className = "clip";
  host.setAttribute("data-hf-id", `hf-${randomUUID()}`);
  host.setAttribute("data-composition-id", hostId);
  host.setAttribute("data-composition-src", relativeSourcePath(targetAbs, sourceAbs));
  host.setAttribute("data-start", String(Math.round(input.start * 100) / 100));
  host.setAttribute("data-duration", String(duration));
  host.setAttribute("data-playback-start", "0");
  host.setAttribute("data-track-index", String(track));
  host.setAttribute("data-width", String(width));
  host.setAttribute("data-height", String(height));
  host.setAttribute(
    "style",
    `position: absolute; left: 0px; top: 0px; width: ${width}px; height: ${height}px; z-index: ${zIndex}`,
  );
  root.appendChild(host);
  if (input.start + duration > parentDuration) {
    const name = root.hasAttribute("data-duration") ? "data-duration" : "data-composition-duration";
    root.setAttribute(name, String(Math.round((input.start + duration) * 100) / 100));
  }
  return { html: document.toString(), hostId, track, duration };
}
