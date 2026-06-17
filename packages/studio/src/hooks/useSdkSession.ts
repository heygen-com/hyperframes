import { useState, useEffect } from "react";
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
 * stale.
 *
 * Opened WITHOUT a persist queue: this session is shadow-telemetry +
 * selection-sync only — it reads from the server but must NEVER write back.
 * Shadow dispatch ops mutate the in-memory model and are discarded on the next
 * reload-on-change (the studio's own authoritative write triggers it). Routing
 * authoritative writes through this session (cutover, Step 3c+) must re-add
 * persist TOGETHER WITH self-write suppression — without it, the SDK's
 * serialize() output races and clobbers the studio's authoritative write.
 */
export function useSdkSession(
  projectId: string | null,
  activeCompPath: string | null,
): Composition | null {
  const [session, setSession] = useState<Composition | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // ── Re-open on external change to the active composition ──
  useEffect(() => {
    if (!activeCompPath) return;
    // Pre-existing clone of the file-change reload handler (usePreviewPersistence);
    // surfaced by this PR's adjacent edits, not introduced by it.
    // fallow-ignore-next-line code-duplication
    const handler = (payload?: unknown) => {
      if (shouldReloadSdkSession(payload, activeCompPath)) {
        setReloadToken((t) => t + 1);
      }
    };
    if (import.meta.hot) {
      import.meta.hot.on("hf:file-change", handler);
      return () => import.meta.hot?.off?.("hf:file-change", handler);
    }
    // SSE fallback for the embedded studio server.
    const es = new EventSource("/api/events");
    es.addEventListener("file-change", handler);
    return () => es.close();
  }, [activeCompPath]);

  // ── Open / re-open the session ──
  useEffect(() => {
    if (!projectId || !activeCompPath) {
      setSession(null);
      return;
    }

    let cancelled = false;
    let comp: Composition | null = null;

    const adapter = createHttpAdapter({
      projectFilesUrl: `/api/projects/${projectId}`,
    });
    adapter
      .read(activeCompPath)
      .then(async (content) => {
        if (cancelled || typeof content !== "string") return;
        // No persist — shadow/selection only; see the hook docstring. The SDK
        // must not write back to the server while it shadows the authoritative
        // studio path.
        comp = await openComposition(content);
        // Cleanup may have fired while openComposition was awaited; dispose immediately.
        if (cancelled) {
          comp.dispose();
          return;
        }
        setSession(comp);
      })
      .catch(() => {
        if (!cancelled) setSession(null);
      });

    return () => {
      cancelled = true;
      const c = comp;
      if (c) void c.flush().finally(() => c.dispose());
    };
  }, [projectId, activeCompPath, reloadToken]);

  return session;
}
