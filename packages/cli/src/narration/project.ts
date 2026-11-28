import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  locateCaptionArrays,
  pickCaptionArray,
  type CaptionArrayLocation,
} from "@hyperframes/parsers/caption-array";
import {
  scanHtmlOpeningTags,
  type HtmlOpeningTagSpan,
} from "@hyperframes/parsers/html-attribute-spans";
import {
  NARRATION_FILE,
  NARRATION_LINE_ATTR,
  parseNarrationManifest,
  type NarrationCaptions,
  type NarrationManifest,
} from "@hyperframes/parsers/narration";

/** A narration command that cannot go ahead; the command prints its message, never a stack. */
export class NarrationRefusal extends Error {}

export const fileHash = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

export function readManifest(projectDir: string): NarrationManifest {
  const path = join(projectDir, NARRATION_FILE);
  if (!existsSync(path)) {
    throw new NarrationRefusal(
      `No ${NARRATION_FILE} in ${projectDir}; create one with hyperframes narration init`,
    );
  }
  const parsed = parseNarrationManifest(readFileSync(path, "utf8"));
  if (!parsed.ok) {
    throw new NarrationRefusal(`${NARRATION_FILE} is not valid: ${parsed.problems.join("; ")}`);
  }
  return parsed.manifest;
}

/** index.html, then every .html under compositions/, as project-relative paths. */
export function projectHtmlFiles(projectDir: string): string[] {
  const files = existsSync(join(projectDir, "index.html")) ? ["index.html"] : [];
  const scenes = join(projectDir, "compositions");
  if (!existsSync(scenes)) return files;
  const nested = readdirSync(scenes, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => join(entry.parentPath, entry.name).slice(projectDir.length + 1))
    .map((path) => path.replace(/\\/g, "/"))
    .sort();
  return [...files, ...nested];
}

export interface AudioTag {
  file: string;
  tag: HtmlOpeningTagSpan;
  src: string;
  start: number;
  duration: number;
  track: string | undefined;
  line: string | undefined;
}

function attributeOf(tag: HtmlOpeningTagSpan, name: string): string | undefined {
  const attribute = tag.attributes.find((candidate) => candidate.name === name);
  return attribute?.kind === "value" ? attribute.value : undefined;
}

/** Every `<audio>` in `html` with its numeric timing, as written (no reference resolution). */
export function audioTags(file: string, html: string): AudioTag[] {
  return scanHtmlOpeningTags(html)
    .filter((tag) => tag.name === "audio")
    .map((tag) => ({
      file,
      tag,
      src: (attributeOf(tag, "src") ?? "").replace(/^\.\//, ""),
      start: Number(attributeOf(tag, "data-start") ?? 0),
      duration: Number(attributeOf(tag, "data-duration") ?? Number.NaN),
      track: attributeOf(tag, "data-track-index"),
      line: attributeOf(tag, NARRATION_LINE_ATTR),
    }));
}

/** Sets attributes on one opening tag: existing values are replaced in place, new ones appended. */
export function setAttributes(
  html: string,
  tag: HtmlOpeningTagSpan,
  values: Record<string, string>,
): string {
  const edits: Array<{ from: number; to: number; text: string }> = [];
  const added: string[] = [];
  for (const [name, value] of Object.entries(values)) {
    const escaped = value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    const existing = tag.attributes.find((attribute) => attribute.name === name);
    if (existing?.kind === "value") {
      edits.push({ from: existing.valueStart, to: existing.valueEnd, text: escaped });
    } else if (existing) {
      edits.push({ from: existing.start, to: existing.end, text: `${name}="${escaped}"` });
    } else {
      added.push(` ${name}="${escaped}"`);
    }
  }
  if (added.length > 0) edits.push({ from: tag.bodyEnd, to: tag.bodyEnd, text: added.join("") });
  edits.sort((a, b) => b.from - a.from);
  return edits.reduce(
    (out, edit) => out.slice(0, edit.from) + edit.text + out.slice(edit.to),
    html,
  );
}

/** Where a file's local t=0 sits on the main timeline: 0 for the root, else its host's data-start. */
export function compositionOrigin(projectDir: string, file: string): number {
  if (file === "index.html") return 0;
  const root = readFileSync(join(projectDir, "index.html"), "utf8");
  const host = scanHtmlOpeningTags(root).find(
    (tag) => attributeOf(tag, "data-composition-src")?.replace(/^\.\//, "") === file,
  );
  const start = Number(host ? attributeOf(host, "data-start") : Number.NaN);
  return Number.isFinite(start) ? start : 0;
}

export interface CaptionsTarget {
  file: string;
  html: string;
  array: CaptionArrayLocation;
  origin: number;
}

/** The caption array narration.json points at, else the first one in the project. */
export function findCaptions(
  projectDir: string,
  captions: NarrationCaptions | undefined,
): CaptionsTarget | null {
  const files = captions?.file ? [captions.file] : projectHtmlFiles(projectDir);
  for (const file of files) {
    const path = join(projectDir, file);
    if (!existsSync(path)) continue;
    const html = readFileSync(path, "utf8");
    const array = pickCaptionArray(locateCaptionArrays(html), captions?.array);
    if (array) return { file, html, array, origin: compositionOrigin(projectDir, file) };
  }
  return null;
}

export function readText(projectDir: string, file: string): string {
  return readFileSync(join(projectDir, file), "utf8");
}
