import { useEffect, useRef } from "react";
import { buildProjectApiPath } from "../utils/projectRouting";

const POLL_INTERVAL_MS = 2000;

/** One poll: the current signature, or null on any failure (skip this tick). */
async function fetchProjectSignature(projectId: string): Promise<string | null> {
  try {
    const res = await fetch(buildProjectApiPath(projectId, "/signature"));
    if (!res.ok) return null;
    const body = (await res.json()) as { signature?: string };
    return typeof body.signature === "string" ? body.signature : null;
  } catch {
    return null;
  }
}

/**
 * Poll the project's content signature and fire `onChange` when it no longer
 * matches `currentSignature` — the storyboard board uses this to refresh itself
 * while an agent writes sketch frames to disk.
 *
 * The comparison baseline is the signature the caller's data was loaded with,
 * so a refetch triggered by `onChange` naturally re-arms the poll with the new
 * value. Ticks are skipped while the tab is hidden (a visibility flip re-checks
 * immediately) and while a previous request is still in flight; request
 * failures are ignored — polling degrades to today's manual-reload behavior.
 */
export function useProjectSignaturePoll(
  projectId: string | null,
  currentSignature: string | undefined,
  onChange: () => void,
): void {
  const signatureRef = useRef(currentSignature);
  const onChangeRef = useRef(onChange);
  signatureRef.current = currentSignature;
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!projectId) return;
    let disposed = false;
    let inFlight = false;

    const tick = async () => {
      if (disposed || inFlight || document.hidden) return;
      // No baseline yet (initial storyboard fetch still loading, or an older
      // server without the signature field) — nothing to compare against.
      if (signatureRef.current === undefined) return;
      inFlight = true;
      const latest = await fetchProjectSignature(projectId);
      inFlight = false;
      if (disposed || latest === null) return;
      if (latest !== signatureRef.current) onChangeRef.current();
    };

    const interval = window.setInterval(() => void tick(), POLL_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      disposed = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [projectId]);
}
