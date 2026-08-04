import { createJsonStore } from "./jsonStore";

/**
 * Half-typed instructions, kept across reloads.
 *
 * The agent edits files, the file watcher reloads the preview, and a reload
 * takes React state with it — so an instruction being typed while an earlier
 * run lands used to vanish mid-sentence. Drafts live in localStorage keyed by
 * the element they were written for, so a reload (or a switch to another
 * element and back) returns the words, and submitting clears them.
 */

const STORAGE_KEY = "hf-studio-agent-drafts";
/** Keep the recent ones; a draft store is a convenience, not a document. */
const MAX_DRAFTS = 20;

type DraftMap = Record<string, string>;

/** Anything that is not a string draft is discarded, not repaired. */
function parseDrafts(raw: unknown): DraftMap {
  if (typeof raw !== "object" || raw === null) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

const drafts = createJsonStore<DraftMap>({
  key: STORAGE_KEY,
  fallback: {},
  parse: parseDrafts,
});

/** Identifies the element a draft belongs to, stable across a reload. */
export function agentDraftKey(parts: {
  projectId: string | null;
  sourceFile?: string;
  selector?: string;
  selectorIndex?: number;
  id?: string | null;
}): string {
  return [
    parts.projectId ?? "-",
    parts.sourceFile ?? "-",
    parts.id ?? parts.selector ?? "-",
    parts.selectorIndex ?? 0,
  ].join("|");
}

export function readAgentDraft(key: string): string {
  return drafts.read()[key] ?? "";
}

/** Writing an empty draft forgets it — an emptied field is not worth restoring. */
export function writeAgentDraft(key: string, value: string): void {
  const next = drafts.read();
  if (value.trim()) next[key] = value;
  else delete next[key];
  // Newest wins when the cap is hit: insertion order is age order here.
  drafts.write(Object.fromEntries(Object.entries(next).slice(-MAX_DRAFTS)));
}

export function clearAgentDraft(key: string): void {
  writeAgentDraft(key, "");
}
