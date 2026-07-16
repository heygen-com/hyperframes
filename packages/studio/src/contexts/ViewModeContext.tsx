import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * Top-level Studio view mode.
 *
 * `timeline` is the existing NLE/preview stage. `storyboard` replaces that stage
 * with the storyboard contact sheet. View mode is mirrored into the project
 * hash's `view` param by `studioUrlState`, the single URL-state authority. A
 * legacy top-level `?view=storyboard` link is honored once on initial load for
 * back-compat, but is never written back.
 */
export type StudioViewMode = "timeline" | "storyboard";

const VIEW_QUERY_PARAM = "view";

function readLegacyViewModeFromUrl(): StudioViewMode | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  if (!params.has(VIEW_QUERY_PARAM)) return null;
  const legacyViewMode = params.get(VIEW_QUERY_PARAM) === "storyboard" ? "storyboard" : null;
  params.delete(VIEW_QUERY_PARAM);
  const nextSearch = params.toString();
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`,
  );
  return legacyViewMode;
}

export interface ViewModeValue {
  viewMode: StudioViewMode;
  setViewMode: (mode: StudioViewMode) => void;
}

/**
 * Owns live view-mode state. StudioApp gates storyboard mode using the loaded project data.
 */
export function useViewModeState(initialViewMode?: StudioViewMode | null): ViewModeValue {
  const [viewMode, setViewMode] = useState<StudioViewMode>(
    () => initialViewMode ?? readLegacyViewModeFromUrl() ?? "timeline",
  );

  return useMemo(() => ({ viewMode, setViewMode }), [viewMode, setViewMode]);
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
