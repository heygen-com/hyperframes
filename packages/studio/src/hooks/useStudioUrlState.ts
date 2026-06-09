import { useCallback, useEffect, useRef } from "react";
import { usePlayerStore } from "../player";
import { findElementForSelection, type DomEditSelection } from "../components/editor/domEditing";
import { clampNumber, type RightPanelTab } from "../utils/studioHelpers";
import {
  buildStudioHash,
  type StudioUrlSelectionState,
  type StudioUrlState,
} from "../utils/studioUrlState";

interface UseStudioUrlStateParams {
  projectId: string | null;
  activeCompPath: string | null;
  duration: number;
  isPlaying: boolean;
  compositionLoading: boolean;
  refreshKey: number;
  previewIframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  rightPanelTab: RightPanelTab;
  rightCollapsed: boolean;
  timelineVisible: boolean;
  activeCompPathHydrated: boolean;
  domEditSelection: DomEditSelection | null;
  buildDomSelectionFromTarget: (
    target: HTMLElement,
    options?: { preferClipAncestor?: boolean },
  ) => Promise<DomEditSelection | null>;
  applyDomSelection: (
    selection: DomEditSelection | null,
    options?: {
      revealPanel?: boolean;
      additive?: boolean;
      preserveGroup?: boolean;
    },
  ) => void;
  initialState: StudioUrlState;
}

function toPersistedSelection(selection: DomEditSelection | null): StudioUrlSelectionState | null {
  if (!selection) return null;
  if (!selection.id && !selection.selector) return null;
  return {
    sourceFile: selection.sourceFile || undefined,
    id: selection.id || undefined,
    selector: selection.selector || undefined,
    selectorIndex: selection.selectorIndex ?? undefined,
  };
}

function replaceHash(nextHash: string) {
  if (typeof window === "undefined") return;
  if (window.location.hash === nextHash) return;
  window.history.replaceState(null, "", nextHash);
}

export function useStudioUrlState({
  projectId,
  activeCompPath,
  duration,
  isPlaying,
  compositionLoading,
  refreshKey,
  previewIframeRef,
  rightPanelTab,
  rightCollapsed,
  timelineVisible,
  activeCompPathHydrated,
  domEditSelection,
  buildDomSelectionFromTarget,
  applyDomSelection,
  initialState,
}: UseStudioUrlStateParams) {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const hydratedSeekRef = useRef(initialState.currentTime == null);
  const hydratedInitialTimeRef = useRef(initialState.currentTime == null);
  const hydratedSelectionRef = useRef(initialState.selection == null);
  const pendingSelectionRef = useRef(initialState.selection);
  const stableTimeRef = useRef<number | null>(initialState.currentTime);

  const buildUrlState = useCallback(
    (): StudioUrlState => ({
      activeCompPath,
      currentTime: stableTimeRef.current,
      rightPanelTab,
      rightCollapsed,
      timelineVisible,
      selection: hydratedSelectionRef.current
        ? toPersistedSelection(domEditSelection)
        : pendingSelectionRef.current,
    }),
    [activeCompPath, domEditSelection, rightCollapsed, rightPanelTab, timelineVisible],
  );

  useEffect(() => {
    if (!projectId || hydratedSeekRef.current || compositionLoading) return;
    const nextTime =
      duration > 0
        ? clampNumber(initialState.currentTime ?? 0, 0, duration)
        : Math.max(0, initialState.currentTime ?? 0);
    usePlayerStore.getState().requestSeek(nextTime);
    stableTimeRef.current = nextTime;
    hydratedSeekRef.current = true;
  }, [projectId, compositionLoading, duration, initialState.currentTime]);

  useEffect(() => {
    if (!projectId || hydratedSelectionRef.current || compositionLoading) return;
    if (!hydratedSeekRef.current) return;
    const targetTime = initialState.currentTime;
    if (targetTime != null && Math.abs(currentTime - stableTimeRef.current!) > 0.05) return;

    const pendingSelection = pendingSelectionRef.current;
    if (!pendingSelection) {
      hydratedSelectionRef.current = true;
      return;
    }

    let doc: Document | null = null;
    try {
      doc = previewIframeRef.current?.contentDocument ?? null;
    } catch {
      return;
    }
    if (!doc) return;

    const element = findElementForSelection(
      doc,
      {
        sourceFile: pendingSelection.sourceFile ?? "",
        id: pendingSelection.id,
        selector: pendingSelection.selector,
        selectorIndex: pendingSelection.selectorIndex,
      },
      activeCompPath,
    );
    if (!element) {
      applyDomSelection(null, { revealPanel: false });
      hydratedSelectionRef.current = true;
      pendingSelectionRef.current = null;
      return;
    }

    hydratedSelectionRef.current = true;
    pendingSelectionRef.current = null;
    void buildDomSelectionFromTarget(element, { preferClipAncestor: false }).then((selection) => {
      applyDomSelection(selection, { revealPanel: false });
    });
  }, [
    activeCompPath,
    applyDomSelection,
    buildDomSelectionFromTarget,
    compositionLoading,
    currentTime,
    initialState.currentTime,
    previewIframeRef,
    projectId,
    refreshKey,
  ]);

  useEffect(() => {
    if (hydratedInitialTimeRef.current) return;
    const targetTime = stableTimeRef.current;
    if (targetTime == null) {
      hydratedInitialTimeRef.current = true;
      return;
    }
    if (Math.abs(currentTime - targetTime) > 0.05) return;
    hydratedInitialTimeRef.current = true;
  }, [currentTime]);

  useEffect(() => {
    if (!activeCompPathHydrated) return;
    if (!hydratedSeekRef.current) return;
    if (!hydratedInitialTimeRef.current) return;
    if (!projectId || isPlaying) return;
    const handle = window.setTimeout(() => {
      stableTimeRef.current = clampNumber(currentTime, 0, Math.max(0, duration));
      replaceHash(buildStudioHash(projectId, buildUrlState()));
    }, 200);

    return () => window.clearTimeout(handle);
  }, [activeCompPathHydrated, buildUrlState, currentTime, duration, isPlaying, projectId]);

  useEffect(() => {
    if (!activeCompPathHydrated) return;
    if (!projectId) return;
    replaceHash(buildStudioHash(projectId, buildUrlState()));
  }, [activeCompPathHydrated, buildUrlState, projectId]);
}
