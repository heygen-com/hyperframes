import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HistoryListItem, HistoryResult } from "@hyperframes/studio-server";
import type { EditHistoryKind } from "../utils/editHistory";
import { studioWriteHeaders } from "../utils/studioFileVersion";

interface RecordEditInput {
  label: string;
  kind: EditHistoryKind;
  coalesceKey?: string;
  coalesceMs?: number;
  files: Record<string, { before: string; after: string }>;
}

interface ApplyCallbacks {
  readFile: (path: string) => Promise<string>;
  serialize?: <T>(paths: readonly string[], task: () => Promise<T>) => Promise<T>;
}

export interface UsePersistentEditHistoryOptions {
  projectId: string | null;
}

/** `restored` is what the step wrote; `previous` what was on disk before it, so the preview can patch in place. */
interface ApplyRestoredFile {
  previous: string;
  restored: string;
}

interface ApplyResult {
  ok: boolean;
  reason?: "empty" | "content-mismatch";
  label?: string;
  paths?: string[];
  files?: Record<string, ApplyRestoredFile>;
}

interface NextStep {
  id: string;
  label: string;
  endedAt: number;
  paths: string[];
}

/** GET /projects/:id/history: every entry, and what Cmd+Z and Cmd+Shift+Z would revert next. */
interface HistoryView {
  entries: HistoryListItem[];
  back: NextStep | null;
  forward: NextStep | null;
}

const EMPTY: HistoryView = { entries: [], back: null, forward: null };
/** How long a drag's edits keep merging into one undo step when the edit names no window. */
const DEFAULT_COALESCE_MS = 300;

function historyUrl(projectId: string, path = ""): string {
  return `/api/projects/${encodeURIComponent(projectId)}/history${path}`;
}

async function post(url: string, body: object, headers: Record<string, string> = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return response.ok ? response.json() : null;
}

/** Reads every path, or null when one cannot be read (a file the step creates or deletes). */
async function readAll(
  paths: readonly string[],
  readFile: (path: string) => Promise<string>,
): Promise<Record<string, string> | null> {
  const contents: Record<string, string> = {};
  for (const path of paths) {
    const content = await readFile(path).catch(() => null);
    if (content === null) return null;
    contents[path] = content;
  }
  return contents;
}

/** Each changed file's before and after, or undefined when one is unknown: the preview then reloads. */
async function restoredFiles(
  paths: readonly string[],
  previous: Record<string, string> | null,
  readFile: (path: string) => Promise<string>,
): Promise<Record<string, ApplyRestoredFile> | undefined> {
  if (!previous || paths.some((path) => !(path in previous))) return undefined;
  const restored = await readAll(paths, readFile);
  if (!restored) return undefined;
  return Object.fromEntries(
    paths.map((path) => [path, { previous: previous[path]!, restored: restored[path]! }]),
  );
}

/** When the edit Cmd+Shift+Z would redo was made: the entry its undo reverted. */
function redoneAt(view: HistoryView): number | null {
  const undo = view.entries.find((entry) => entry.id === view.forward?.id);
  return view.entries.find((entry) => entry.id === undo?.undoes)?.endedAt ?? null;
}

/**
 * Studio's undo and redo over the project's history on the server: an edit claims the files it just wrote, and
 * Cmd+Z / Cmd+Shift+Z step through every writer's changes by time. Without a history on the server (404) edits
 * still save; they just cannot be undone.
 */
export function usePersistentEditHistory({ projectId }: UsePersistentEditHistoryOptions) {
  const [view, setView] = useState<HistoryView>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  // A coalescing claim stays on the server until its drag goes idle, so it is not in `view` yet.
  const heldClaimRef = useRef<{ paths: string[]; at: number } | null>(null);
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  const refresh = useCallback(async () => {
    if (!projectId) return;
    const response = await fetch(historyUrl(projectId)).catch(() => null);
    const next = response?.ok ? ((await response.json()) as HistoryView) : EMPTY;
    if (projectIdRef.current === projectId) setView(next);
  }, [projectId]);

  useEffect(() => {
    setView(EMPTY);
    setLoaded(false);
    heldClaimRef.current = null;
    void refresh().finally(() => setLoaded(true));
  }, [refresh]);

  const recordEdit = useCallback(
    async ({ label, coalesceKey, coalesceMs, files }: RecordEditInput) => {
      if (!projectId) return;
      const paths = Object.keys(files);
      const reply = await post(historyUrl(projectId, "/claim"), {
        label,
        paths,
        ...(coalesceKey && { coalesceKey, idleMs: coalesceMs ?? DEFAULT_COALESCE_MS }),
      }).catch(() => null);
      heldClaimRef.current = coalesceKey && reply?.claimed ? { paths, at: Date.now() } : null;
      void refresh();
    },
    [projectId, refresh],
  );

  const step = useCallback(
    async (direction: "undo" | "redo", callbacks: ApplyCallbacks): Promise<ApplyResult> => {
      if (!projectId) return { ok: false, reason: "empty" };
      const next = direction === "undo" ? view.back : view.forward;
      const paths = [...new Set([...(next?.paths ?? []), ...(heldClaimRef.current?.paths ?? [])])];
      const run = async (): Promise<ApplyResult> => {
        const previous = await readAll(paths, callbacks.readFile);
        const reply = (await post(
          historyUrl(projectId, "/step"),
          { direction: direction === "undo" ? "back" : "forward" },
          studioWriteHeaders(),
        ).catch(() => null)) as HistoryResult | null;
        heldClaimRef.current = null;
        void refresh();
        if (!reply) return { ok: false, reason: "empty" };
        if (!reply.ok) return { ok: false, reason: "content-mismatch" };
        if (!reply.entry) return { ok: false, reason: "empty" };
        const changed = reply.entry.files.map((file) => file.path);
        return {
          ok: true,
          label: reply.entry.label,
          paths: changed,
          files: await restoredFiles(changed, previous, callbacks.readFile),
        };
      };
      return callbacks.serialize ? callbacks.serialize(paths, run) : run();
    },
    [projectId, view, refresh],
  );

  const undo = useCallback((callbacks: ApplyCallbacks) => step("undo", callbacks), [step]);
  const redo = useCallback((callbacks: ApplyCallbacks) => step("redo", callbacks), [step]);

  // Beat edits interleave with these by edit time (useAppHotkeys): the top of each stack.
  const state = useMemo(() => {
    const backAt = Math.max(view.back?.endedAt ?? 0, heldClaimRef.current?.at ?? 0);
    const redoAt = redoneAt(view);
    return {
      undo: backAt ? [{ createdAt: backAt }] : [],
      redo: redoAt === null ? [] : [{ createdAt: redoAt }],
    };
  }, [view]);

  return {
    loaded,
    canUndo: Boolean(view.back),
    canRedo: Boolean(view.forward),
    undoLabel: view.back?.label,
    redoLabel: view.forward?.label,
    undoPaths: view.back?.paths ?? [],
    redoPaths: view.forward?.paths ?? [],
    state,
    recordEdit,
    undo,
    redo,
  };
}
