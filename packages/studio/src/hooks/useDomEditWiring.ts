/**
 * Wiring layer for DOM edit sessions: click-to-source navigation,
 * DOM selection to timeline sync, GSAP cache invalidation on refresh,
 * GSAP cache population, animation resolution for the selected element,
 * and preview sync side-effects.
 *
 * Extracted from useDomEditSession to isolate orchestration wiring from
 * the GSAP-aware geometry intercept logic.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { AnimeJsPropertyValue } from "@hyperframes/core/animejs-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { STUDIO_GSAP_PANEL_ENABLED } from "../components/editor/manualEditingAvailability";
import { usePlayerStore } from "../player";
import { useDomEditPreviewSync } from "./useDomEditPreviewSync";
import { useGsapAnimationsForElement, usePopulateKeyframeCacheForFile } from "./useGsapTweenCache";
import { useAnimeAnimationsForElement } from "./useAnimeTweenCache";
import { useGsapAnimationFetchFallback } from "./useGsapAnimationFetchFallback";
import { useGsapInteractionFailureTelemetry } from "./useGsapInteractionFailureTelemetry";
import { useGsapSelectionHandlers } from "./useGsapSelectionHandlers";
import type { PatchTarget } from "../utils/sourcePatcher";
import type { SidebarTab } from "../components/sidebar/LeftSidebar";
import {
  isAnimeEditableAnimation,
  normalizeAnimationPropertyForCollision,
} from "./animeAnimationAdapter";

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
  animeCacheVersion: number;
  bumpAnimeCache: () => void;
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
  // fallow-ignore-next-line code-duplication
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
    updates: { duration?: number; ease?: string; easeEach?: string; position?: number },
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
  moveKeyframe: (
    sel: DomEditSelection,
    animId: string,
    fromPercentage: number,
    toPercentage: number,
  ) => void;
  resizeKeyframedTween: (
    sel: DomEditSelection,
    animId: string,
    position: number,
    duration: number,
    pctRemap: Array<{ from: number; to: number }>,
  ) => void;
  convertToKeyframes: (
    sel: DomEditSelection,
    animId: string,
    resolvedFromValues?: Record<string, number | string>,
  ) => Promise<void>;
  removeAllKeyframes: (sel: DomEditSelection, animId: string) => void;
  updateAnimeProperty: (
    sel: DomEditSelection,
    animId: string,
    prop: string,
    value: number | string,
  ) => Promise<void>;
  updateAnimeMeta: (
    sel: DomEditSelection,
    animId: string,
    updates: { duration?: number; ease?: string; easeEach?: string; position?: number },
  ) => Promise<void>;
  deleteAnimeAnimation: (sel: DomEditSelection, animId: string) => Promise<void>;
  addAnimeAnimation: (
    sel: DomEditSelection,
    method: "to" | "from" | "set" | "fromTo",
    time: number,
  ) => Promise<void>;
  addAnimeProperty: (sel: DomEditSelection, animId: string, prop: string) => Promise<void>;
  removeAnimeProperty: () => void;
  updateAnimePropertyKeyframe: (
    sel: DomEditSelection,
    animId: string,
    property: string,
    index: number,
    updates: Record<string, AnimeJsPropertyValue>,
  ) => Promise<void>;
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
  animeCacheVersion,
  bumpAnimeCache,
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
  moveKeyframe,
  resizeKeyframedTween,
  convertToKeyframes,
  removeAllKeyframes,
  updateAnimeProperty,
  updateAnimeMeta,
  deleteAnimeAnimation,
  addAnimeAnimation,
  addAnimeProperty,
  removeAnimeProperty,
  updateAnimePropertyKeyframe,
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
      bumpAnimeCache();
    }
  }, [refreshKey, bumpGsapCache, bumpAnimeCache]);

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

  const {
    animations: selectedAnimeAnimations,
    multipleTimelines: animeMultipleTimelines,
    unsupportedTimelinePattern: animeUnsupportedTimelinePattern,
  } = useAnimeAnimationsForElement(
    STUDIO_GSAP_PANEL_ENABLED ? (projectId ?? null) : null,
    gsapSourceFile,
    domEditSelection
      ? { id: domEditSelection.id ?? null, selector: domEditSelection.selector ?? null }
      : null,
    animeCacheVersion,
    previewIframeRef,
  );

  // fallow-ignore-next-line complexity
  const runtimeCollisionProperties = useMemo(() => {
    const gsapProps = new Set<string>();
    for (const anim of selectedGsapAnimations) {
      for (const prop of Object.keys(anim.properties)) {
        gsapProps.add(normalizeAnimationPropertyForCollision(prop));
      }
      for (const keyframe of anim.keyframes?.keyframes ?? []) {
        for (const prop of Object.keys(keyframe.properties)) {
          gsapProps.add(normalizeAnimationPropertyForCollision(prop));
        }
      }
    }
    const collisions = new Set<string>();
    for (const anim of selectedAnimeAnimations) {
      for (const prop of Object.keys(anim.properties)) {
        const normalized = normalizeAnimationPropertyForCollision(prop);
        if (gsapProps.has(normalized)) collisions.add(normalized);
      }
      for (const keyframe of anim.keyframes?.keyframes ?? []) {
        for (const prop of Object.keys(keyframe.properties)) {
          const normalized = normalizeAnimationPropertyForCollision(prop);
          if (gsapProps.has(normalized)) collisions.add(normalized);
        }
      }
    }
    return Array.from(collisions);
  }, [selectedAnimeAnimations, selectedGsapAnimations]);

  const selectedAnimations = useMemo(
    () => [...selectedGsapAnimations, ...selectedAnimeAnimations],
    [selectedAnimeAnimations, selectedGsapAnimations],
  );
  const selectedAnimeAnimationIds = useMemo(
    () => new Set(selectedAnimeAnimations.map((animation) => animation.id)),
    [selectedAnimeAnimations],
  );
  const animationById = useMemo(
    () => new Map(selectedAnimations.map((animation) => [animation.id, animation])),
    [selectedAnimations],
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
    moveKeyframe,
    resizeKeyframedTween,
    convertToKeyframes,
    removeAllKeyframes,
    handleDomManualEditsReset,
    selectedGsapAnimations: selectedAnimations,
  });

  const handleGsapUpdateProperty = useCallback(
    (animId: string, prop: string, value: number | string) => {
      if (!domEditSelection) return;
      if (selectedAnimeAnimationIds.has(animId)) {
        void updateAnimeProperty(domEditSelection, animId, prop, value);
        return;
      }
      gsapSelectionHandlers.handleGsapUpdateProperty(animId, prop, value);
    },
    [domEditSelection, gsapSelectionHandlers, selectedAnimeAnimationIds, updateAnimeProperty],
  );

  const handleGsapUpdateMeta = useCallback(
    (
      animId: string,
      updates: { duration?: number; ease?: string; easeEach?: string; position?: number },
    ) => {
      if (!domEditSelection) return;
      if (selectedAnimeAnimationIds.has(animId)) {
        void updateAnimeMeta(domEditSelection, animId, updates);
        return;
      }
      gsapSelectionHandlers.handleGsapUpdateMeta(animId, updates);
    },
    [domEditSelection, gsapSelectionHandlers, selectedAnimeAnimationIds, updateAnimeMeta],
  );

  const handleGsapDeleteAnimation = useCallback(
    (animId: string) => {
      if (!domEditSelection) return;
      if (selectedAnimeAnimationIds.has(animId)) {
        void deleteAnimeAnimation(domEditSelection, animId);
        return;
      }
      gsapSelectionHandlers.handleGsapDeleteAnimation(animId);
    },
    [deleteAnimeAnimation, domEditSelection, gsapSelectionHandlers, selectedAnimeAnimationIds],
  );

  const handleGsapAddAnimation = useCallback(
    (method: "to" | "from" | "set" | "fromTo") => {
      if (!domEditSelection) return;
      if (selectedAnimeAnimations.length > 0 && selectedGsapAnimations.length === 0) {
        void addAnimeAnimation(domEditSelection, method, usePlayerStore.getState().currentTime);
        return;
      }
      gsapSelectionHandlers.handleGsapAddAnimation(method);
    },
    [
      addAnimeAnimation,
      domEditSelection,
      gsapSelectionHandlers,
      selectedAnimeAnimations.length,
      selectedGsapAnimations.length,
    ],
  );

  const handleGsapAddProperty = useCallback(
    (animId: string, prop: string) => {
      if (!domEditSelection) return;
      if (selectedAnimeAnimationIds.has(animId)) {
        void addAnimeProperty(domEditSelection, animId, prop);
        return;
      }
      gsapSelectionHandlers.handleGsapAddProperty(animId, prop);
    },
    [addAnimeProperty, domEditSelection, gsapSelectionHandlers, selectedAnimeAnimationIds],
  );

  const handleGsapRemoveProperty = useCallback(
    (animId: string, prop: string) => {
      if (selectedAnimeAnimationIds.has(animId)) {
        removeAnimeProperty();
        return;
      }
      gsapSelectionHandlers.handleGsapRemoveProperty(animId, prop);
    },
    [gsapSelectionHandlers, removeAnimeProperty, selectedAnimeAnimationIds],
  );

  const handleGsapUpdateKeyframeEase = useCallback(
    (animId: string, percentage: number, ease: string) => {
      if (!domEditSelection || !selectedAnimeAnimationIds.has(animId)) return false;
      const anim = animationById.get(animId);
      if (!anim || !isAnimeEditableAnimation(anim)) return false;
      const map = anim.anime?.propertyKeyframePercentages ?? {};
      for (const [property, byPct] of Object.entries(map)) {
        const index = byPct[percentage];
        if (index === undefined) continue;
        void updateAnimePropertyKeyframe(domEditSelection, animId, property, index, { ease });
        return true;
      }
      return false;
    },
    [animationById, domEditSelection, selectedAnimeAnimationIds, updateAnimePropertyKeyframe],
  );

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
    selectedGsapAnimations: selectedAnimations,
    gsapMultipleTimelines: gsapMultipleTimelines || animeMultipleTimelines,
    gsapUnsupportedTimelinePattern:
      gsapUnsupportedTimelinePattern ||
      animeUnsupportedTimelinePattern ||
      runtimeCollisionProperties.length > 0,
    trackGsapInteractionFailure,
    makeFetchFallback,
    ...gsapSelectionHandlers,
    handleGsapUpdateProperty,
    handleGsapUpdateMeta,
    handleGsapDeleteAnimation,
    handleGsapAddAnimation,
    handleGsapAddProperty,
    handleGsapRemoveProperty,
    handleGsapUpdateKeyframeEase,
  };
}
