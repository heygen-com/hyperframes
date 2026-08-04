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

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readAll(storage: Storage | null): DraftMap {
  if (!storage) return {};
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

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

export function readAgentDraft(key: string, storage: Storage | null = getStorage()): string {
  return readAll(storage)[key] ?? "";
}

/** Writing an empty draft forgets it — an emptied field is not worth restoring. */
export function writeAgentDraft(
  key: string,
  value: string,
  storage: Storage | null = getStorage(),
): void {
  if (!storage) return;
  const drafts = readAll(storage);
  if (value.trim()) drafts[key] = value;
  else delete drafts[key];

  // Newest wins when the cap is hit: insertion order is age order here.
  const entries = Object.entries(drafts).slice(-MAX_DRAFTS);
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Quota or a private-mode storage: losing a draft beats breaking the field.
  }
}

export function clearAgentDraft(key: string, storage: Storage | null = getStorage()): void {
  writeAgentDraft(key, "", storage);
}
