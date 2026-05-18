import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isSafePath, walkDir } from "./safePath.js";

const COMMENT_RE = /<!--\s*hyperframes-comment\s+([\s\S]*?)\s*-->/g;

export interface TimelineCommentElement {
  id: string;
  tag: string;
  start: number;
  duration: number;
  track: number;
  sourceFile?: string;
  selector?: string;
  selectorIndex?: number;
  domId?: string;
  compositionSrc?: string;
}

export interface TimelineCommentRecord {
  id: string;
  status: "open";
  filePath: string;
  rangeStart: number;
  rangeEnd: number;
  target?: string;
  prompt: string;
  elements: TimelineCommentElement[];
}

export interface CreateTimelineCommentInput {
  id?: string;
  filePath: string;
  rangeStart: number;
  rangeEnd: number;
  prompt: string;
  elements?: TimelineCommentElement[];
  target?: {
    id?: string | null;
    selector?: string;
    selectorIndex?: number;
  };
}

interface SerializedTimelineComment {
  id: string;
  status: "open";
  rangeStart: number;
  rangeEnd: number;
  target?: string;
  prompt: string;
  elements: TimelineCommentElement[];
}

export function isCreateTimelineCommentInput(value: unknown): value is CreateTimelineCommentInput {
  if (!value || typeof value !== "object") return false;
  const input = value as Partial<CreateTimelineCommentInput>;
  return (
    typeof input.filePath === "string" &&
    typeof input.prompt === "string" &&
    typeof input.rangeStart === "number" &&
    typeof input.rangeEnd === "number"
  );
}

export function createTimelineCommentId(): string {
  return `hfc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function serializeCommentPayload(input: SerializedTimelineComment): string {
  return JSON.stringify(input)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("--", "\\u002d\\u002d");
}

function parseCommentPayload(body: string): SerializedTimelineComment | null {
  try {
    const parsed = JSON.parse(body) as {
      id?: unknown;
      status?: unknown;
      rangeStart?: unknown;
      rangeEnd?: unknown;
      target?: unknown;
      prompt?: unknown;
      elements?: unknown;
    };
    if (typeof parsed.id !== "string") return null;
    if (parsed.status !== "open") return null;
    if (typeof parsed.rangeStart !== "number" || typeof parsed.rangeEnd !== "number") return null;
    return {
      id: parsed.id,
      status: "open",
      rangeStart: parsed.rangeStart,
      rangeEnd: parsed.rangeEnd,
      target: typeof parsed.target === "string" ? parsed.target : undefined,
      prompt: typeof parsed.prompt === "string" ? parsed.prompt : "",
      elements: Array.isArray(parsed.elements)
        ? parsed.elements.filter(isTimelineCommentElement)
        : [],
    };
  } catch {
    return null;
  }
}

export function isTimelineCommentElement(value: unknown): value is TimelineCommentElement {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TimelineCommentElement>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.tag === "string" &&
    typeof candidate.start === "number" &&
    typeof candidate.duration === "number" &&
    typeof candidate.track === "number"
  );
}

function buildCommentBlock(input: CreateTimelineCommentInput & { id: string }): string {
  const start = Math.min(input.rangeStart, input.rangeEnd);
  const end = Math.max(input.rangeStart, input.rangeEnd);
  const payload = serializeCommentPayload({
    id: input.id,
    status: "open",
    rangeStart: start,
    rangeEnd: end,
    target: input.target?.id || input.target?.selector || input.filePath,
    prompt: input.prompt,
    elements: input.elements ?? [],
  });

  return `<!-- hyperframes-comment ${payload} -->\n`;
}

function findInsertionIndex(html: string, target?: CreateTimelineCommentInput["target"]): number {
  if (target?.id) {
    const re = new RegExp(`<[^>]+\\bid=["']${escapeRegExp(target.id)}["'][^>]*>`, "i");
    const match = re.exec(html);
    if (match?.index != null) return match.index;
  }

  if (target?.selector) {
    const targetIndex = Math.max(0, target.selectorIndex ?? 0);
    for (const re of selectorToTagRegex(target.selector.trim())) {
      const match = Array.from(html.matchAll(re))[targetIndex];
      if (match?.index != null) return match.index;
    }
  }

  const bodyMatch = /<body\b[^>]*>/i.exec(html);
  return bodyMatch?.index != null ? bodyMatch.index + bodyMatch[0].length : 0;
}

function selectorToTagRegex(selector: string): RegExp[] {
  if (selector.startsWith("#")) {
    const id = selector.slice(1);
    return [new RegExp(`<[^>]+\\bid=["']${escapeRegExp(id)}["'][^>]*>`, "gi")];
  }
  if (selector.startsWith(".")) {
    const cls = selector.slice(1);
    return [
      new RegExp(
        `<[^>]+\\bclass=["'][^"']*(?:^|\\s)${escapeRegExp(cls)}(?:\\s|$)[^"']*["'][^>]*>`,
        "gi",
      ),
    ];
  }
  if (/^[a-zA-Z][a-zA-Z0-9-]*$/.test(selector)) {
    return [new RegExp(`<${escapeRegExp(selector)}\\b[^>]*>`, "gi")];
  }
  return [];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveProjectFile(projectDir: string, filePath: string): string {
  if (filePath.includes("\0")) throw new Error("forbidden");
  const absPath = resolve(projectDir, filePath);
  if (!isSafePath(projectDir, absPath)) throw new Error("forbidden");
  return absPath;
}

export function insertTimelineComment(
  html: string,
  input: CreateTimelineCommentInput & { id: string },
): string {
  const block = buildCommentBlock(input);
  const index = findInsertionIndex(html, input.target);
  const prefix = html.slice(0, index);
  const suffix = html.slice(index);
  const needsLeadingNewline = prefix.length > 0 && !prefix.endsWith("\n");
  const needsTrailingNewline = suffix.length > 0 && !suffix.startsWith("\n");
  return `${prefix}${needsLeadingNewline ? "\n" : ""}${block}${needsTrailingNewline ? "\n" : ""}${suffix}`;
}

export function removeTimelineComment(html: string, commentId: string): string {
  COMMENT_RE.lastIndex = 0;
  return html.replace(COMMENT_RE, (full, payload: string) => {
    const parsed = parseCommentPayload(payload);
    return parsed?.id === commentId ? "" : full;
  });
}

export function parseTimelineCommentsFromHtml(
  html: string,
  filePath: string,
): TimelineCommentRecord[] {
  const comments: TimelineCommentRecord[] = [];
  COMMENT_RE.lastIndex = 0;
  for (const match of html.matchAll(COMMENT_RE)) {
    const parsed = parseCommentPayload(match[1] ?? "");
    if (!parsed) continue;
    comments.push({
      id: parsed.id,
      status: "open",
      filePath,
      rangeStart: parsed.rangeStart,
      rangeEnd: parsed.rangeEnd,
      target: parsed.target,
      prompt: parsed.prompt,
      elements: parsed.elements,
    });
  }
  return comments;
}

export function listTimelineComments(projectDir: string): TimelineCommentRecord[] {
  return walkDir(projectDir)
    .filter((file) => file.endsWith(".html"))
    .flatMap((file) => {
      const html = readFileSync(join(projectDir, file), "utf-8");
      return parseTimelineCommentsFromHtml(html, file);
    })
    .sort((a, b) => a.rangeStart - b.rangeStart || a.filePath.localeCompare(b.filePath));
}

export function writeTimelineCommentToProject(
  projectDir: string,
  input: CreateTimelineCommentInput,
): { comment: TimelineCommentRecord; content: string } {
  const id = input.id ?? createTimelineCommentId();
  const absPath = resolveProjectFile(projectDir, input.filePath);
  const original = readFileSync(absPath, "utf-8");
  const content = insertTimelineComment(original, { ...input, id });
  writeFileSync(absPath, content, "utf-8");
  const [comment] = parseTimelineCommentsFromHtml(content, input.filePath).filter(
    (candidate) => candidate.id === id,
  );
  if (!comment) throw new Error("failed to create timeline comment");
  return { comment, content };
}

export function removeTimelineCommentFromProject(
  projectDir: string,
  commentId: string,
): { changed: boolean; filePath?: string; content?: string } {
  let first: { filePath: string; content: string } | null = null;
  for (const filePath of walkDir(projectDir).filter((file) => file.endsWith(".html"))) {
    const absPath = resolveProjectFile(projectDir, filePath);
    const original = readFileSync(absPath, "utf-8");
    const content = removeTimelineComment(original, commentId);
    if (content === original) continue;
    writeFileSync(absPath, content, "utf-8");
    if (!first) first = { filePath, content };
  }
  return first ? { changed: true, ...first } : { changed: false };
}
