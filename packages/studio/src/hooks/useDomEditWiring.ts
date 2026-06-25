/**
 * Wiring layer for DOM edit sessions: click-to-source navigation,
 * DOM selection to timeline sync, GSAP cache invalidation on refresh,
 * GSAP cache population, animation resolution for the selected element,
 * and preview sync side-effects.
 *
 * Extracted from useDomEditSession to isolate orchestration wiring from
 * the GSAP-aware geometry intercept logic.
 */
import { useCallback, useEffect, useRef } from "react";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { STUDIO_GSAP_PANEL_ENABLED } from "../components/editor/manualEditingAvailability";
import { usePlayerStore } from "../player";
import { useDomEditPreviewSync } from "./useDomEditPreviewSync";
import { useGsapAnimationsForElement, usePopulateKeyframeCacheForFile } from "./useGsapTweenCache";
import { useGsapAnimationFetchFallback } from "./useGsapAnimationFetchFallback";
import { useGsapInteractionFailureTelemetry } from "./useGsapInteractionFailureTelemetry";
import { useGsapSelectionHandlers } from "./useGsapSelectionHandlers";
import type { PatchTarget } from "../utils/sourcePatcher";
import type { SidebarTab } from "../components/sidebar/LeftSidebar";

export interface UseDomEditWiringParams {
  projectId: string | null;
  activeCompPath: string | null;
  domEditSelection: DomEditSelection | null;
  domEditSelectionRef: React.MutableRefObject<DomEditSelection | null>;
  previewIframeRef: React.RefObject<HTMLIFrameElement | null>;
  previewIframe: HTMLIFrameElement | null;
  captionEditMode: boolean;
  refreshKey: number;
  gsapCacheVersion: number;
  bumpGsapCache: () => void;
  showToast: (message: string, tone?: "error" | "info") => void;
  refreshPreviewDocumentVersion: () => void;
  syncPreviewHistoryHotkey: (iframe: HTMLIFrameElement | null) => void;
  applyStudioManualEditsToPreviewRef: React.MutableRefObject<
    (iframe: HTMLIFrameElement) => Promise<void>
  >;
  applyDomSelection: (
    selection: DomEditSelection | null,
    options?: { revealPanel?: boolean; preserveGroup?: boolean },
  ) => void;
  buildDomSelectionFromTarget: (element: HTMLElement) => Promise<DomEditSelection | null>;
  openSourceForSelection?: (sourceFile: string, target: PatchTarget) => void;
  selectSidebarTab?: (tab: SidebarTab) => void;
  getSidebarTab?: () => SidebarTab;
  // GSAP script commit ops (from useGsapScriptCommits)
  updateGsapProperty: (
    sel: DomEditSelection,
    animId: string,
    prop: string,
    value: number | string,
  ) => void;
  updateGsapMeta: (
    sel: DomEditSelection,
    animId: string,
    updates: { duration?: number; ease?: string; position?: number },
  ) => void;
  deleteGsapAnimation: (sel: DomEditSelection, animId: string) => void;
  deleteAllForSelector: (sel: DomEditSelection, targetSelector: string) => void;
  addGsapAnimation: (
    sel: DomEditSelection,
    method: "to" | "from" | "set" | "fromTo",
    time: number,
  ) => Promise<void>;
  addGsapProperty: (sel: DomEditSelection, animId: string, prop: string) => void;
  removeGsapProperty: (sel: DomEditSelection, animId: string, prop: string) => void;
  updateGsapFromProperty: (
    sel: DomEditSelection,
    animId: string,
    prop: string,
    value: number | string,
  ) => void;
  addGsapFromProperty: (sel: DomEditSelection, animId: string, prop: string) => void;
  removeGsapFromProperty: (sel: DomEditSelection, animId: string, prop: string) => void;
  addKeyframe: (
    sel: DomEditSelection,
    animId: string,
    percentage: number,
    property: string,
    value: number | string,
  ) => void;
  addKeyframeBatch: (
    sel: DomEditSelection,
    animId: string,
    percentage: number,
    properties: Record<string, number | string>,
  ) => Promise<void>;
  removeKeyframe: (sel: DomEditSelection, animId: string, percentage: number) => void;
  convertToKeyframes: (
    sel: DomEditSelection,
    animId: string,
    resolvedFromValues?: Record<string, number | string>,
  ) => Promise<void>;
  removeAllKeyframes: (sel: DomEditSelection, animId: string) => void;
  handleDomManualEditsReset: (sel: DomEditSelection) => void;
}

// fallow-ignore-next-line complexity
export function useDomEditWiring({
  // fallow-ignore-next-line code-duplication
  projectId,
  activeCompPath,
  domEditSelection,
  domEditSelectionRef,
  previewIframeRef,
  previewIframe,
  captionEditMode,
  refreshKey,
  gsapCacheVersion,
  bumpGsapCache,
  showToast,
  refreshPreviewDocumentVersion,
  syncPreviewHistoryHotkey,
  applyStudioManualEditsToPreviewRef,
  applyDomSelection,
  buildDomSelectionFromTarget,
  openSourceForSelection,
  selectSidebarTab,
  getSidebarTab,
  updateGsapProperty,
  updateGsapMeta,
  deleteGsapAnimation,
  deleteAllForSelector,
  addGsapAnimation,
  addGsapProperty,
  removeGsapProperty,
  updateGsapFromProperty,
  addGsapFromProperty,
  removeGsapFromProperty,
  addKeyframe,
  addKeyframeBatch,
  removeKeyframe,
  convertToKeyframes,
  removeAllKeyframes,
  handleDomManualEditsReset,
}: UseDomEditWiringParams) {
  // ── Click-to-source navigation ──

  const onClickToSource = useCallback(
    (selection: DomEditSelection) => {
      if (!openSourceForSelection || !selectSidebarTab) return;
      if (!selection.sourceFile) return;
      selectSidebarTab("code");
      openSourceForSelection(selection.sourceFile, {
        id: selection.id,
        selector: selection.selector,
        selectorIndex: selection.selectorIndex,
      });
    },
    [openSourceForSelection, selectSidebarTab],
  );

  // ── DOM selection -> timeline element sync ──

  useEffect(() => {
    if (!domEditSelection?.id) return;
    const { selectedElementId, elements, setSelectedElementId } = usePlayerStore.getState();
    const matchKey = elements.find(
      (el) => el.domId === domEditSelection.id || el.id === domEditSelection.id,
    );
    const key = matchKey ? (matchKey.key ?? matchKey.id) : null;
    if (key && key !== selectedElementId) setSelectedElementId(key);
  }, [domEditSelection?.id]);

  // ── GSAP cache sync ──

  // Bump GSAP cache when refreshKey changes (code-tab edits trigger iframe
  // reload via refreshKey but don't go through commitMutation, so the cache
  // would otherwise retain stale keyframe entries).
  const prevRefreshKeyRef = useRef(refreshKey);
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (refreshKey !== prevRefreshKeyRef.current) {
      prevRefreshKeyRef.current = refreshKey;
      bumpGsapCache();
    }
  }, [refreshKey, bumpGsapCache]);

  const gsapSourceFile = domEditSelection?.sourceFile || activeCompPath || "index.html";

  usePopulateKeyframeCacheForFile(
    STUDIO_GSAP_PANEL_ENABLED ? (projectId ?? null) : null,
    gsapSourceFile,
    gsapCacheVersion,
    previewIframeRef,
  );

  const {
    animations: selectedGsapAnimations,
    multipleTimelines: gsapMultipleTimelines,
    unsupportedTimelinePattern: gsapUnsupportedTimelinePattern,
  } = useGsapAnimationsForElement(
    STUDIO_GSAP_PANEL_ENABLED ? (projectId ?? null) : null,
    gsapSourceFile,
    domEditSelection
      ? { id: domEditSelection.id ?? null, selector: domEditSelection.selector ?? null }
      : null,
    gsapCacheVersion,
    // Pass the preview iframe so class/selector tweens (e.g. `.dot`) resolve to
    // the live element and surface in the inspector — not just by #id match.
    previewIframeRef,
  );

  // ── Telemetry & fallback ──

  const trackGsapInteractionFailure = useGsapInteractionFailureTelemetry(activeCompPath, showToast);
  const makeFetchFallback = useGsapAnimationFetchFallback(projectId, gsapSourceFile);

  // ── GSAP selection handlers ──

  const gsapSelectionHandlers = useGsapSelectionHandlers({
    domEditSelection,
    updateGsapProperty,
    updateGsapMeta,
    deleteGsapAnimation,
    deleteAllForSelector,
    addGsapAnimation,
    addGsapProperty,
    removeGsapProperty,
    updateGsapFromProperty,
    addGsapFromProperty,
    removeGsapFromProperty,
    addKeyframe,
    addKeyframeBatch,
    removeKeyframe,
    convertToKeyframes,
    removeAllKeyframes,
    handleDomManualEditsReset,
    selectedGsapAnimations,
  });

  // ── Preview sync side-effects ──

  useDomEditPreviewSync({
    previewIframe,
    activeCompPath,
    captionEditMode,
    domEditSelectionRef,
    domEditSelection,
    applyDomSelection,
    buildDomSelectionFromTarget,
    refreshPreviewDocumentVersion,
    syncPreviewHistoryHotkey,
    applyStudioManualEditsToPreviewRef,
    openSourceForSelection,
    getSidebarTab,
    gsapCacheVersion,
  });

  return {
    onClickToSource,
    selectedGsapAnimations,
    gsapMultipleTimelines,
    gsapUnsupportedTimelinePattern,
    trackGsapInteractionFailure,
    makeFetchFallback,
    ...gsapSelectionHandlers,
  };
}
