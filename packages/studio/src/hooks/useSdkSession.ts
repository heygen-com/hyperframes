import { useState, useEffect, useCallback } from "react";
import type { MutableRefObject } from "react";
import { openComposition } from "@hyperframes/sdk";
import type { Composition } from "@hyperframes/sdk";
import { readStudioFileChangePath } from "../components/editor/manualEdits";
import { isSelfWriteEcho } from "./sdkSelfWriteRegistry";

/**
 * Read a project file's content, or undefined on a non-2xx (optional read).
 * Replaces the removed SDK http adapter's `read()` — the only thing Studio used
 * it for (Studio is the sole writer, so the adapter's write path was dead).
 */
async function readProjectFileOptional(
  projectId: string,
  path: string,
): Promise<string | undefined> {
  // Reject traversal / NUL before building the request URL — `path` is a
  // user-influenced composition path (mirrors the guard in timelineEditingHelpers,
  // and closes the CodeQL client-side-request-forgery flag). encodeURIComponent
  // already confines both values to single segments of this same-origin URL.
  if (path.includes("\0") || path.includes("..")) return undefined;
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(path)}?optional=1`,
  );
  if (!res.ok) return undefined;
  const data = (await res.json()) as { content?: string };
  return typeof data.content === "string" ? data.content : undefined;
}

/**
 * True when an external file-change payload targets the active composition and
 * the SDK session must be re-opened to pick up the new content.
 */
export function shouldReloadSdkSession(payload: unknown, activeCompPath: string | null): boolean {
  if (!activeCompPath) return false;
  return readStudioFileChangePath(payload) === activeCompPath;
}

/**
 * Stage 7 Step 3a — SDK session wired to the active composition.
 *
 * Creates an SDK Composition (reading the file via the project files API) on
 * every (projectId, activeCompPath) change, disposes the old one on cleanup, and
 * re-opens it when the active composition file changes on disk (code editor,
 * agent, or server-side patch) so the in-memory linkedom document never goes
 * stale. The session has NO persist queue — Studio is the sole file writer; see
 * the open effect below.
 */
// Reload-suppression baseline: a file-change within this window of our own SDK
// cutover write is a CANDIDATE echo, but the decision is content-identity based
// (isSelfWriteEcho) not time-only — so an undo write that lands inside the window
// still reloads (its reverted bytes were never registered as a self-write). The
// window only bounds how long a registered self-write stays suppressible.
const SELF_WRITE_SUPPRESS_MS = 2000;

/** Best-effort read of the changed file's content from a file-change payload. */
function readFileChangeContent(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.content === "string") return record.content;
  if ("data" in record) return readFileChangeContent(record.data);
  return null;
}

/**
 * Decide whether a file-change for the active composition should reload the SDK
 * session. `content` is the new on-disk bytes (from the payload or a re-read);
 * pass null when unavailable. Content-identity wins: a change whose bytes match a
 * registered self-write is our own echo (suppress). Without content we can't prove
 * identity, so we fall back to the time window ONLY to suppress an echo — an undo
 * write outside the window (or any non-self-write) still reloads. Exported for test.
 */
export function shouldReloadOnFileChange(
  activeCompPath: string,
  content: string | null,
  withinSuppressWindow: boolean,
): boolean {
  if (content != null) return !isSelfWriteEcho(activeCompPath, content);
  // No content to compare — preserve the old time-window echo suppression.
  return !withinSuppressWindow;
}

export interface SdkSessionHandle {
  session: Composition | null;
  /**
   * Force a session reload immediately, bypassing the self-write suppress
   * window. Call after undo/redo writes the active composition file so the
   * SDK in-memory document reflects the reverted content.
   */
  forceReload: () => void;
}

export function useSdkSession(
  projectId: string | null,
  activeCompPath: string | null,
  domEditSaveTimestampRef?: MutableRefObject<number>,
): SdkSessionHandle {
  const [session, setSession] = useState<Composition | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // ── Re-open on external change to the active composition ──
  useEffect(() => {
    if (!activeCompPath) return;
    const compPath = activeCompPath;
    const readProjectId = projectId ?? null;
    const handler = (payload?: unknown) => {
      if (!shouldReloadSdkSession(payload, compPath)) return;
      const withinWindow =
        !!domEditSaveTimestampRef &&
        Date.now() - domEditSaveTimestampRef.current < SELF_WRITE_SUPPRESS_MS;
      const decide = (content: string | null) => {
        if (shouldReloadOnFileChange(compPath, content, withinWindow)) setReloadToken((t) => t + 1);
      };
      const payloadContent = readFileChangeContent(payload);
      // Prefer payload content; otherwise re-read so the decision is by IDENTITY
      // (an undo's reverted bytes won't match a registered self-write → reload).
      if (payloadContent != null || readProjectId == null) {
        decide(payloadContent);
        return;
      }
      readProjectFileOptional(readProjectId, compPath)
        .then((c) => decide(c ?? null))
        .catch(() => decide(null));
    };
    if (import.meta.hot) {
      import.meta.hot.on("hf:file-change", handler);
      return () => import.meta.hot?.off?.("hf:file-change", handler);
    }
    // SSE fallback for the embedded studio server.
    const es = new EventSource("/api/events");
    es.addEventListener("file-change", handler);
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompPath, projectId]);

  // ── Open / re-open the session ──
  useEffect(() => {
    if (!projectId || !activeCompPath) {
      setSession(null);
      return;
    }

    let cancelled = false;
    const compRef = { current: null as Composition | null };

    readProjectFileOptional(projectId, activeCompPath)
      .then(async (content) => {
        if (cancelled || typeof content !== "string") return;
        // No persist queue: Studio's writeProjectFile (via sdkCutover's
        // persistSdkSerialize) is the SINGLE writer. Wiring the SDK persist
        // queue too would double-write the file (queue auto-writes on every
        // 'change' AND Studio writes explicitly) and race on disk; it would
        // also write the full active-composition serialization to the fixed
        // persistPath even when an edit targeted a sub-composition file.
        // Studio's editHistory is the authoritative undo stack — SDK history
        // is unused dead weight here (forceReloadSdkSession discards it on undo).
        const comp = await openComposition(content, { history: false });
        // Cleanup may have fired while openComposition was awaited; dispose immediately.
        if (cancelled) {
          comp.dispose();
          return;
        }
        compRef.current = comp;
        setSession(comp);
      })
      .catch(() => {
        if (!cancelled) setSession(null);
      });

    return () => {
      cancelled = true;
      // No queue to flush; dispose only. (Flushing here would serialize the
      // pre-undo in-memory doc and race the revert write on undo/redo reload.)
      compRef.current?.dispose();
    };
  }, [projectId, activeCompPath, reloadToken]);

  const forceReload = useCallback(() => setReloadToken((t) => t + 1), []);
  return { session, forceReload };
}
