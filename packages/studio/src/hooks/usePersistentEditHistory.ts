import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HistoryListItem, HistoryResult } from "@hyperframes/studio-server";
import { studioFileContentVersion, studioWriteHeaders } from "../utils/studioFileVersion";

interface RecordEditInput {
  label: string;
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

interface ApplyRestoredFile {
  previous: string;
  restored: string;
}

interface ApplyResult {
  ok: boolean;
  /** content-mismatch: `paths` changed after the step's entry. failed: `message` says why. */
  reason?: "empty" | "content-mismatch" | "failed";
  message?: string;
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

interface HistoryView {
  entries: HistoryListItem[];
  back: NextStep | null;
  forward: NextStep | null;
}

const EMPTY: HistoryView = { entries: [], back: null, forward: null };
const DEFAULT_COALESCE_MS = 300;

function historyUrl(projectId: string, path = ""): string {
  return `/api/projects/${encodeURIComponent(projectId)}/history${path}`;
}

async function post(
  url: string,
  body: object,
  headers: Record<string, string> = {},
): Promise<{ ok: true; body: unknown } | { ok: false; status: number; error: string }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!response) return { ok: false, status: 0, error: "Studio could not reach its server." };
  const reply = (await response.json().catch(() => null)) as { error?: string } | null;
  if (response.ok && reply) return { ok: true, body: reply };
  if (response.ok)
    return { ok: false, status: response.status, error: "The history's reply was unreadable." };
  return { ok: false, status: response.status, error: reply?.error ?? `HTTP ${response.status}` };
}

/** Whether a drag's claim is held open; a failed one is logged (its write lands as an outside change; 404: none). */
function claimHeld(reply: Awaited<ReturnType<typeof post>>, label: string): boolean {
  if (reply.ok) return Boolean((reply.body as { claimed: { id: string } | null } | null)?.claimed);
  if (reply.status !== 404)
    console.error(`"${label}" was not recorded as your edit: ${reply.error}`);
  return false;
}

async function overwroteVersions(files: RecordEditInput["files"]): Promise<Record<string, string>> {
  const pairs = await Promise.all(
    Object.entries(files).map(async ([path, { before }]) => [
      path,
      await studioFileContentVersion(before),
    ]),
  );
  return Object.fromEntries(pairs);
}

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

function redoneAt(view: HistoryView): number | null {
  const undo = view.entries.find((entry) => entry.id === view.forward?.id);
  return view.entries.find((entry) => entry.id === undo?.undoes)?.endedAt ?? null;
}

/** Studio's undo over the server's project history: an edit claims what it wrote; Cmd+Z steps every writer's. */
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
        overwrote: await overwroteVersions(files),
        ...(coalesceKey && { coalesceKey, idleMs: coalesceMs ?? DEFAULT_COALESCE_MS }),
      });
      heldClaimRef.current =
        claimHeld(reply, label) && coalesceKey ? { paths, at: Date.now() } : null;
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
        const posted = await post(
          historyUrl(projectId, "/step"),
          { direction: direction === "undo" ? "back" : "forward" },
          studioWriteHeaders(),
        );
        heldClaimRef.current = null;
        void refresh();
        // 404: this app keeps no history, so there is nothing to step.
        if (!posted.ok && posted.status === 404) return { ok: false, reason: "empty" };
        if (!posted.ok) return { ok: false, reason: "failed", message: posted.error };
        const reply = posted.body as HistoryResult;
        if (!reply.ok) {
          const { files } = reply.conflict;
          return { ok: false, reason: "content-mismatch", paths: files };
        }
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
