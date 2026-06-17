import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Top-level Studio view mode.
 *
 * `timeline` is the existing NLE/preview stage. `storyboard` replaces that stage
 * with the storyboard contact sheet. The mode is mirrored to the `?view=` query
 * param so it survives reloads and — importantly — so an agent can deep-link the
 * user straight into the storyboard by navigating the tab to `?view=storyboard`.
 */
export type StudioViewMode = "timeline" | "storyboard";

const VIEW_QUERY_PARAM = "view";

function readViewModeFromUrl(): StudioViewMode {
  if (typeof window === "undefined") return "timeline";
  return new URLSearchParams(window.location.search).get(VIEW_QUERY_PARAM) === "storyboard"
    ? "storyboard"
    : "timeline";
}

function writeViewModeToUrl(mode: StudioViewMode): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (mode === "storyboard") {
    url.searchParams.set(VIEW_QUERY_PARAM, "storyboard");
  } else {
    url.searchParams.delete(VIEW_QUERY_PARAM);
  }
  window.history.replaceState(window.history.state, "", url);
}

export interface ViewModeValue {
  viewMode: StudioViewMode;
  setViewMode: (mode: StudioViewMode) => void;
}

/**
 * Owns the view-mode state. When `enabled` is false (storyboard flag off) the
 * mode is pinned to `timeline` and the URL is left untouched, so the feature is
 * fully inert until the flag is on.
 */
export function useViewModeState(enabled: boolean): ViewModeValue {
  const [viewMode, setMode] = useState<StudioViewMode>(() =>
    enabled ? readViewModeFromUrl() : "timeline",
  );

  // Reflect genuine browser back/forward between history entries with a different
  // `?view=`. Note: our own writes use `replaceState` (below), which does NOT fire
  // `popstate`, so this listener never sees them — `setViewMode` updates state directly.
  // An agent deep-links by doing a full navigation to `?view=storyboard` (picked up by
  // the mount-time read); a scripted `pushState`/`replaceState` to `?view=` would not be
  // reflected here, by design.
  useEffect(() => {
    if (!enabled) return;
    const onPopState = () => setMode(readViewModeFromUrl());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [enabled]);

  const setViewMode = useCallback(
    (mode: StudioViewMode) => {
      if (!enabled) return;
      setMode(mode);
      writeViewModeToUrl(mode);
    },
    [enabled],
  );

  const effectiveMode = enabled ? viewMode : "timeline";
  return useMemo(() => ({ viewMode: effectiveMode, setViewMode }), [effectiveMode, setViewMode]);
}

const ViewModeContext = createContext<ViewModeValue | null>(null);

export function useViewMode(): ViewModeValue {
  const ctx = useContext(ViewModeContext);
  if (!ctx) throw new Error("useViewMode must be used within ViewModeProvider");
  return ctx;
}

export function ViewModeProvider({
  value,
  children,
}: {
  value: ViewModeValue;
  children: ReactNode;
}) {
  return <ViewModeContext value={value}>{children}</ViewModeContext>;
}
