import type { FrameStatus } from "@hyperframes/core/storyboard";

/**
 * Frame comments — the storyboard review's structured feedback channel.
 *
 * The board's per-frame comment boxes write one batch file on submit; the
 * consuming agent revises exactly the frames named, deletes the file, and
 * re-presents. The file shape is a cross-repo contract — keep it in sync with
 * skills/hyperframes-core/references/storyboard-format.md § Frame comments.
 */
export const FRAME_COMMENTS_PATH = ".hyperframes/frame-comments.json";

export type FrameCommentsPass = "storyboard" | "sketch" | "final";

export interface FrameCommentEntry {
  /** The frame's 1-based `index` in the manifest — the key. */
  frame: number;
  /** Copied from the frame at submit time so a post-submit reorder is detectable. */
  src?: string;
  title?: string;
  text: string;
}

export interface FrameCommentsFile {
  version: 1;
  pass: FrameCommentsPass;
  submitted_at: string;
  comments: FrameCommentEntry[];
}

interface CommentableFrame {
  index: number;
  status: FrameStatus;
  src?: string;
  title?: string;
}

/** Which review the batch belongs to — the furthest status present on the board. */
export function passForFrames(frames: ReadonlyArray<{ status: FrameStatus }>): FrameCommentsPass {
  if (frames.some((f) => f.status === "animated")) return "final";
  if (frames.some((f) => f.status === "built")) return "sketch";
  return "storyboard";
}

/** The non-empty drafts as file entries, in board order. */
export function draftEntries(
  frames: readonly CommentableFrame[],
  drafts: Readonly<Record<number, string>>,
): FrameCommentEntry[] {
  const entries: FrameCommentEntry[] = [];
  for (const frame of frames) {
    const text = drafts[frame.index]?.trim();
    if (!text) continue;
    entries.push({ frame: frame.index, src: frame.src, title: frame.title, text });
  }
  return entries;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseCommentEntry(item: unknown): FrameCommentEntry | null {
  if (!isRecord(item)) return null;
  if (typeof item.frame !== "number" || typeof item.text !== "string") return null;
  return {
    frame: item.frame,
    src: typeof item.src === "string" ? item.src : undefined,
    title: typeof item.title === "string" ? item.title : undefined,
    text: item.text,
  };
}

function parsePass(value: unknown): FrameCommentsPass {
  return value === "sketch" || value === "final" ? value : "storyboard";
}

/** Tolerant read of an existing comments file — anything malformed counts as "no file". */
export function parseCommentsFile(raw: string): FrameCommentsFile | null {
  if (!raw.trim()) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data) || !Array.isArray(data.comments)) return null;
  const comments = data.comments
    .map(parseCommentEntry)
    .filter((entry): entry is FrameCommentEntry => entry !== null);
  return {
    version: 1,
    pass: parsePass(data.pass),
    submitted_at: typeof data.submitted_at === "string" ? data.submitted_at : "",
    comments,
  };
}

/**
 * One file = the currently pending feedback. A resubmit before the agent
 * consumed the previous batch keeps the pending entries for frames the new
 * batch doesn't mention and overwrites the ones it does.
 */
export function buildCommentsFile(
  frames: readonly CommentableFrame[],
  drafts: Readonly<Record<number, string>>,
  previous: FrameCommentsFile | null,
  submittedAt: string,
): FrameCommentsFile {
  const fresh = draftEntries(frames, drafts);
  const freshIndexes = new Set(fresh.map((entry) => entry.frame));
  const kept = previous?.comments.filter((entry) => !freshIndexes.has(entry.frame)) ?? [];
  const comments = [...kept, ...fresh].sort((a, b) => a.frame - b.frame);
  return { version: 1, pass: passForFrames(frames), submitted_at: submittedAt, comments };
}
