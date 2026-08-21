import { useCallback, useEffect, useRef, useState } from "react";
import type {
  StoryboardFrame,
  StoryboardGlobals,
  StoryboardWarning,
} from "@hyperframes/core/storyboard";
import { buildProjectApiPath } from "../utils/projectRouting";

/** A frame as returned by the API: parsed frame + disk-resolution info. */
export interface StoryboardFrameView extends StoryboardFrame {
  /** Whether `src` resolves to an existing file inside the project. */
  srcExists: boolean;
}

/** The companion narration script (SCRIPT.md), when present alongside the storyboard. */
export interface StoryboardScript {
  exists: boolean;
  path: string;
  content: string;
}

/** Shape of `GET /api/projects/:id/storyboard`. */
export interface StoryboardResponse {
  exists: boolean;
  path: string;
  globals: StoryboardGlobals;
  frames: StoryboardFrameView[];
  warnings: StoryboardWarning[];
  script?: StoryboardScript;
  /** Project content signature this payload was derived from (poster cache-bust + change poll). */
  signature?: string;
}

export interface UseStoryboardResult {
  data: StoryboardResponse | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Load the parsed storyboard manifest for a project. Markdown stays canonical on
 * disk; this fetches the server-derived JSON the storyboard view renders.
 *
 * `reload()` refetches in place: the blocking spinner only shows on first load
 * and project switches, so background refreshes (file-change polling, post-save
 * reloads) swap data without flashing the board.
 */
export function useStoryboard(projectId: string | null): UseStoryboardResult {
  const [data, setData] = useState<StoryboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const hasDataRef = useRef(false);
  const lastProjectRef = useRef<string | null>(null);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    if (lastProjectRef.current !== projectId) {
      lastProjectRef.current = projectId;
      hasDataRef.current = false;
      setData(null);
    }
    if (!hasDataRef.current) setLoading(true);
    setError(null);

    // Route through buildProjectApiPath so the (URL-derived) projectId is encoded
    // into the path rather than interpolated raw (CodeQL js/client-side-request-forgery).
    fetch(buildProjectApiPath(projectId, "/storyboard"))
      .then((res) => {
        if (!res.ok) throw new Error(`storyboard request failed: ${res.status}`);
        return res.json() as Promise<StoryboardResponse>;
      })
      .then((json) => {
        if (cancelled) return;
        hasDataRef.current = true;
        setData(json);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // A failed background refresh keeps the last good board on screen;
        // the blocking error state is only for loads with nothing to show.
        if (hasDataRef.current) return;
        setError(err instanceof Error ? err.message : "failed to load storyboard");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, reloadKey]);

  return { data, loading, error, reload };
}
