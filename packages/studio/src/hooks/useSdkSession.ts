import { useState, useEffect } from "react";
import { openComposition } from "@hyperframes/sdk";
import { createHttpAdapter } from "@hyperframes/sdk/adapters/http";
import type { Composition } from "@hyperframes/sdk";

/**
 * Stage 7 Step 1 — SDK session wired to the active composition.
 *
 * Creates an SDK Composition backed by createHttpAdapter on every
 * (projectId, activeCompPath) change, disposes the old one on cleanup.
 * The session is idle until Step 3 routes dispatch ops through it.
 */
export function useSdkSession(
  projectId: string | null,
  activeCompPath: string | null,
): Composition | null {
  const [session, setSession] = useState<Composition | null>(null);

  useEffect(() => {
    if (!projectId || !activeCompPath) {
      setSession(null);
      return;
    }

    let cancelled = false;
    let comp: Composition | null = null;

    const url = `/api/projects/${projectId}/files/${encodeURIComponent(activeCompPath)}?optional=1`;
    fetch(url)
      .then((r) => r.json())
      .then(async (data: { content?: string }) => {
        if (cancelled || typeof data.content !== "string") return;
        const adapter = createHttpAdapter({
          projectFilesUrl: `/api/projects/${projectId}`,
        });
        comp = await openComposition(data.content, { persist: adapter });
        comp.on("persist:error", (e) => {
          console.warn("[sdk] persist:error", e.error);
        });
        if (!cancelled) setSession(comp);
      })
      .catch(() => {
        if (!cancelled) setSession(null);
      });

    return () => {
      cancelled = true;
      comp?.dispose();
    };
  }, [projectId, activeCompPath]);

  return session;
}
