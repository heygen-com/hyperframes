import { useState, useEffect } from "react";
import type { MutableRefObject } from "react";
import { openComposition } from "@hyperframes/sdk";
import { createHttpAdapter } from "@hyperframes/sdk/adapters/http";
import type { Composition } from "@hyperframes/sdk";
import { readStudioFileChangePath } from "../components/editor/manualEdits";

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
 * Creates an SDK Composition backed by createHttpAdapter on every
 * (projectId, activeCompPath) change, disposes the old one on cleanup, and
 * re-opens it when the active composition file changes on disk (code editor,
 * agent, or server-side patch) so the in-memory linkedom document never goes
 * stale. The persist queue writes back to `activeCompPath` (not the
 * "composition.html" default).
 *
 * The session is idle until Step 3c routes dispatch ops through it; re-opening
 * is therefore purely additive — no SDK self-write exists yet, so there is no
 * persist echo. Step 3c must add self-write suppression once dispatch writes.
 */
// Time-window heuristic: suppress file-change reloads for 2 s after our own
// SDK cutover write, to avoid an echo-reload on the write we just committed.
// Footgun: if 2 s is too short (slow FS / network) the reload fires anyway;
// if too long it masks a legitimate external edit. The long-term shape is a
// sequence number or content hash threaded through the persist event so the
// comparison is exact rather than time-based.
const SELF_WRITE_SUPPRESS_MS = 2000;

export function useSdkSession(
  projectId: string | null,
  activeCompPath: string | null,
  domEditSaveTimestampRef?: MutableRefObject<number>,
): Composition | null {
  const [session, setSession] = useState<Composition | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // ── Re-open on external change to the active composition ──
  useEffect(() => {
    if (!activeCompPath) return;
    const handler = (payload?: unknown) => {
      if (!shouldReloadSdkSession(payload, activeCompPath)) return;
      // Suppress reload triggered by our own SDK cutover write.
      if (
        domEditSaveTimestampRef &&
        Date.now() - domEditSaveTimestampRef.current < SELF_WRITE_SUPPRESS_MS
      )
        return;
      setReloadToken((t) => t + 1);
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
  }, [activeCompPath]);

  // ── Open / re-open the session ──
  useEffect(() => {
    if (!projectId || !activeCompPath) {
      setSession(null);
      return;
    }

    let cancelled = false;
    const compRef = { current: null as Composition | null };

    const adapter = createHttpAdapter({
      projectFilesUrl: `/api/projects/${projectId}`,
    });
    adapter
      .read(activeCompPath)
      .then(async (content) => {
        if (cancelled || typeof content !== "string") return;
        const comp = await openComposition(content, {
          persist: adapter,
          persistPath: activeCompPath,
        });
        comp.on("persist:error", (e) => {
          console.warn("[sdk] persist:error", e.error);
        });
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
      const c = compRef.current;
      if (c) void c.flush().finally(() => c.dispose());
    };
  }, [projectId, activeCompPath, reloadToken]);

  return session;
}
