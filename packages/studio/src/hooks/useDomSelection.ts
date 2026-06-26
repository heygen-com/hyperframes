import { useState, useCallback, useRef, useEffect } from "react";
import type { TimelineElement } from "../player";
import {
  getAllPreviewTargetsFromPointer,
  getPreviewTargetFromPointer,
} from "../utils/studioPreviewHelpers";
import {
  findMatchingTimelineElementId,
  findTimelineIdByAncestor,
  type RightPanelTab,
} from "../utils/studioHelpers";
import {
  domEditSelectionsTargetSame,
  domEditSelectionInGroup,
  toggleDomEditGroupSelection,
  replaceDomEditGroupSelection,
  seedDomEditGroupWithSelection,
} from "../utils/domEditHelpers";
import { STUDIO_INSPECTOR_PANELS_ENABLED } from "../components/editor/manualEditingAvailability";
import {
  findElementForSelection,
  findElementForTimelineElement,
  resolveDomEditSelection,
  type DomEditSelection,
} from "../components/editor/domEditing";
import { reapplyPositionEditsAfterSeek } from "../components/editor/manualEdits";

// ── Types ──

export interface UseDomSelectionParams {
  projectId: string | null;
  activeCompPath: string | null;
  isMasterView: boolean;
  compIdToSrc: Map<string, string>;
  captionEditMode: boolean;
  previewIframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  timelineElements: TimelineElement[];
  setSelectedTimelineElementId: (id: string | null) => void;
  setRightCollapsed: (collapsed: boolean) => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  previewIframe: HTMLIFrameElement | null;
  refreshKey: number;
  rightPanelTab: RightPanelTab;
}

export interface UseDomSelectionReturn {
  // State
  domEditSelection: DomEditSelection | null;
  domEditGroupSelections: DomEditSelection[];
  domEditHoverSelection: DomEditSelection | null;
  activeGroupElement: HTMLElement | null;
  // Refs
  domEditSelectionRef: React.MutableRefObject<DomEditSelection | null>;
  domEditGroupSelectionsRef: React.MutableRefObject<DomEditSelection[]>;
  domEditHoverSelectionRef: React.MutableRefObject<DomEditSelection | null>;
  activeGroupElementRef: React.MutableRefObject<HTMLElement | null>;
  // State setters (needed by useDomEditSession for agent-prompt reset flows)
  setDomEditSelection: React.Dispatch<React.SetStateAction<DomEditSelection | null>>;
  setDomEditGroupSelections: React.Dispatch<React.SetStateAction<DomEditSelection[]>>;
  setActiveGroupElement: (el: HTMLElement | null) => void;
  // Callbacks
  applyDomSelection: (
    selection: DomEditSelection | null,
    options?: {
      revealPanel?: boolean;
      additive?: boolean;
      preserveGroup?: boolean;
    },
  ) => void;
  clearDomSelection: () => void;
  buildDomSelectionFromTarget: (
    target: HTMLElement,
    options?: {
      preferClipAncestor?: boolean;
      skipSourceProbe?: boolean;
      activeGroupElement?: HTMLElement | null;
    },
  ) => Promise<DomEditSelection | null>;
  resolveDomSelectionFromPreviewPoint: (
    clientX: number,
    clientY: number,
    options?: {
      preferClipAncestor?: boolean;
      skipSourceProbe?: boolean;
      activeGroupElement?: HTMLElement | null;
    },
  ) => Promise<DomEditSelection | null>;
  resolveAllDomSelectionsFromPreviewPoint: (
    clientX: number,
    clientY: number,
  ) => Promise<DomEditSelection[]>;
  updateDomEditHoverSelection: (selection: DomEditSelection | null) => void;
  buildDomSelectionForTimelineElement: (
    element: TimelineElement,
  ) => Promise<DomEditSelection | null>;
  handleTimelineElementSelect: (element: TimelineElement | null) => Promise<void>;
  refreshDomEditSelectionFromPreview: (selection: DomEditSelection) => Promise<void>;
  refreshDomEditGroupSelectionsFromPreview: (selections: DomEditSelection[]) => Promise<void>;
  applyMarqueeSelection: (selections: DomEditSelection[], additive: boolean) => void;
}

// ── Hook ──

export function useDomSelection({
  projectId,
  activeCompPath,
  isMasterView,
  compIdToSrc,
  captionEditMode,
  previewIframeRef,
  timelineElements,
  setSelectedTimelineElementId,
  setRightCollapsed,
  setRightPanelTab,
  previewIframe,
  refreshKey,
  rightPanelTab,
}: UseDomSelectionParams): UseDomSelectionReturn {
  // ── State ──

  const [domEditSelection, setDomEditSelection] = useState<DomEditSelection | null>(null);
  const [domEditGroupSelections, setDomEditGroupSelections] = useState<DomEditSelection[]>([]);
  const [domEditHoverSelection, setDomEditHoverSelection] = useState<DomEditSelection | null>(null);
  // The data-hf-group wrapper the user has drilled into (null = top level).
  const [activeGroupElement, setActiveGroupElementState] = useState<HTMLElement | null>(null);

  // ── Refs ──

  const domEditSelectionRef = useRef<DomEditSelection | null>(domEditSelection);
  const domEditGroupSelectionsRef = useRef<DomEditSelection[]>(domEditGroupSelections);
  const domEditHoverSelectionRef = useRef<DomEditSelection | null>(domEditHoverSelection);
  const activeGroupElementRef = useRef<HTMLElement | null>(activeGroupElement);

  // Keep refs in sync with state
  domEditSelectionRef.current = domEditSelection;
  domEditGroupSelectionsRef.current = domEditGroupSelections;
  domEditHoverSelectionRef.current = domEditHoverSelection;
  activeGroupElementRef.current = activeGroupElement;

  // ── Callbacks ──

  const applyDomSelection = useCallback(
    // fallow-ignore-next-line complexity
    (
      selection: DomEditSelection | null,
      options?: {
        revealPanel?: boolean;
        additive?: boolean;
        preserveGroup?: boolean;
      },
    ) => {
      if (!selection) {
        domEditSelectionRef.current = null;
        domEditGroupSelectionsRef.current = [];
        setDomEditSelection(null);
        setDomEditGroupSelections([]);
        setSelectedTimelineElementId(null);
        return;
      }
      if (!STUDIO_INSPECTOR_PANELS_ENABLED) {
        domEditSelectionRef.current = null;
        domEditGroupSelectionsRef.current = [];
        setDomEditSelection(null);
        setDomEditGroupSelections([]);
        setSelectedTimelineElementId(null);
        return;
      }

      const isAdditiveSelection = Boolean(options?.additive);
      const currentSelection = domEditSelectionRef.current;
      const previousGroup = domEditGroupSelectionsRef.current;
      const currentGroup = isAdditiveSelection
        ? seedDomEditGroupWithSelection(previousGroup, currentSelection)
        : previousGroup;
      const wasInGroup = domEditSelectionInGroup(currentGroup, selection);
      const nextGroup = options?.preserveGroup
        ? replaceDomEditGroupSelection(currentGroup, selection)
        : isAdditiveSelection
          ? toggleDomEditGroupSelection(currentGroup, selection)
          : [selection];
      const nextSelection = options?.preserveGroup
        ? selection
        : isAdditiveSelection && wasInGroup
          ? domEditSelectionsTargetSame(currentSelection, selection)
            ? (nextGroup[0] ?? null)
            : domEditSelectionInGroup(nextGroup, currentSelection)
              ? currentSelection
              : (nextGroup[0] ?? null)
          : selection;

      domEditSelectionRef.current = nextSelection;
      domEditGroupSelectionsRef.current = nextGroup;
      setDomEditSelection(nextSelection);
      setDomEditGroupSelections(nextGroup);

      // Selecting something outside the drilled-into group exits the drill-in, so
      // a later click on the group selects it as a unit again (non-sticky drill-in).
      const activeGroup = activeGroupElementRef.current;
      if (activeGroup && nextSelection && !activeGroup.contains(nextSelection.element)) {
        activeGroupElementRef.current = null;
        setActiveGroupElementState(null);
      }

      if (nextSelection) {
        if (options?.revealPanel !== false) {
          setRightCollapsed(false);
          setRightPanelTab("design");
        }
        const nextSelectedTimelineId =
          findMatchingTimelineElementId(nextSelection, timelineElements) ??
          findTimelineIdByAncestor(
            nextSelection.element,
            timelineElements,
            nextSelection.sourceFile || "index.html",
          );
        setSelectedTimelineElementId(nextSelectedTimelineId);
        return;
      }

      setSelectedTimelineElementId(null);
    },
    [setSelectedTimelineElementId, timelineElements, setRightCollapsed, setRightPanelTab],
  );

  const clearDomSelection = useCallback(() => {
    applyDomSelection(null, { revealPanel: false });
  }, [applyDomSelection]);

  // Drill into / out of a group. Changing scope clears the current selection so
  // the user isn't left with an out-of-scope element selected.
  const setActiveGroupElement = useCallback(
    (el: HTMLElement | null) => {
      setActiveGroupElementState(el);
      applyDomSelection(null, { revealPanel: false });
    },
    [applyDomSelection],
  );

  const buildDomSelectionFromTarget = useCallback(
    (
      target: HTMLElement,
      options?: {
        preferClipAncestor?: boolean;
        skipSourceProbe?: boolean;
        // Override the drill-in scope (used by canvas double-click to resolve the
        // child inside a group before the activeGroupElement state has re-rendered).
        activeGroupElement?: HTMLElement | null;
      },
    ) => {
      return resolveDomEditSelection(target, {
        activeCompositionPath: activeCompPath,
        isMasterView,
        preferClipAncestor: options?.preferClipAncestor,
        skipSourceProbe: options?.skipSourceProbe,
        activeGroupElement:
          options && "activeGroupElement" in options
            ? options.activeGroupElement
            : activeGroupElementRef.current,
        projectId,
      });
    },
    [activeCompPath, isMasterView, projectId],
  );

  const resolveDomSelectionFromPreviewPoint = useCallback(
    // fallow-ignore-next-line complexity
    async (
      clientX: number,
      clientY: number,
      options?: {
        preferClipAncestor?: boolean;
        skipSourceProbe?: boolean;
        activeGroupElement?: HTMLElement | null;
      },
    ) => {
      const iframe = previewIframeRef.current;
      if (!iframe || captionEditMode) return null;
      try {
        if (iframe.contentDocument) reapplyPositionEditsAfterSeek(iframe.contentDocument);
      } catch {
        /* cross-origin guard */
      }
      const target = getPreviewTargetFromPointer(iframe, clientX, clientY, activeCompPath);
      if (!target) return null;
      return buildDomSelectionFromTarget(
        target,
        options && "activeGroupElement" in options
          ? {
              preferClipAncestor: options.preferClipAncestor,
              skipSourceProbe: options.skipSourceProbe,
              activeGroupElement: options.activeGroupElement,
            }
          : {
              preferClipAncestor: options?.preferClipAncestor,
              skipSourceProbe: options?.skipSourceProbe,
            },
      );
    },
    [activeCompPath, buildDomSelectionFromTarget, captionEditMode, previewIframeRef],
  );

  const resolveAllDomSelectionsFromPreviewPoint = useCallback(
    // fallow-ignore-next-line complexity
    async (clientX: number, clientY: number): Promise<DomEditSelection[]> => {
      const iframe = previewIframeRef.current;
      if (!iframe || captionEditMode) return [];
      try {
        if (iframe.contentDocument) reapplyPositionEditsAfterSeek(iframe.contentDocument);
      } catch {
        /* cross-origin guard */
      }
      const targets = getAllPreviewTargetsFromPointer(iframe, clientX, clientY, activeCompPath);
      const results: DomEditSelection[] = [];
      for (const target of targets) {
        const sel = await buildDomSelectionFromTarget(target, { skipSourceProbe: true });
        if (sel) results.push(sel);
      }
      return results;
    },
    [activeCompPath, buildDomSelectionFromTarget, captionEditMode, previewIframeRef],
  );

  const updateDomEditHoverSelection = useCallback((selection: DomEditSelection | null) => {
    if (domEditSelectionsTargetSame(domEditHoverSelectionRef.current, selection)) return;
    domEditHoverSelectionRef.current = selection;
    setDomEditHoverSelection(selection);
  }, []);

  const buildDomSelectionForTimelineElement = useCallback(
    // fallow-ignore-next-line complexity
    async (element: TimelineElement): Promise<DomEditSelection | null> => {
      const iframe = previewIframeRef.current;
      let doc: Document | null = null;
      try {
        doc = iframe?.contentDocument ?? null;
      } catch {
        return null;
      }
      if (!doc) return null;

      reapplyPositionEditsAfterSeek(doc);

      const targetElement = findElementForTimelineElement(doc, element, {
        activeCompositionPath: activeCompPath,
        compIdToSrc,
        isMasterView,
      });
      return targetElement
        ? buildDomSelectionFromTarget(targetElement, {
            preferClipAncestor: false,
          })
        : null;
    },
    [activeCompPath, buildDomSelectionFromTarget, compIdToSrc, isMasterView, previewIframeRef],
  );

  const handleTimelineElementSelect = useCallback(
    async (element: TimelineElement | null) => {
      if (!STUDIO_INSPECTOR_PANELS_ENABLED) return;
      if (!element) {
        applyDomSelection(null, { revealPanel: false });
        return;
      }

      const selection = await buildDomSelectionForTimelineElement(element);
      if (selection) applyDomSelection(selection);
    },
    [applyDomSelection, buildDomSelectionForTimelineElement],
  );

  const refreshDomEditSelectionFromPreview = useCallback(
    // fallow-ignore-next-line complexity
    async (selection: DomEditSelection) => {
      const iframe = previewIframeRef.current;
      let doc: Document | null = null;
      try {
        doc = iframe?.contentDocument ?? null;
      } catch {
        return;
      }
      if (!doc) return;

      const element = findElementForSelection(doc, selection, activeCompPath);
      if (!element) return;

      const nextSelection = await buildDomSelectionFromTarget(element);
      if (nextSelection) {
        applyDomSelection(nextSelection, {
          revealPanel: false,
          preserveGroup: true,
        });
      }
    },
    [activeCompPath, applyDomSelection, buildDomSelectionFromTarget, previewIframeRef],
  );

  const refreshDomEditGroupSelectionsFromPreview = useCallback(
    // fallow-ignore-next-line complexity
    async (selections: DomEditSelection[]) => {
      const iframe = previewIframeRef.current;
      let doc: Document | null = null;
      try {
        doc = iframe?.contentDocument ?? null;
      } catch {
        return;
      }
      if (!doc) return;

      const nextGroup: DomEditSelection[] = [];
      for (const selection of selections) {
        const element = findElementForSelection(doc, selection, activeCompPath);
        if (!element) continue;
        const nextSelection = await buildDomSelectionFromTarget(element);
        if (nextSelection) nextGroup.push(nextSelection);
      }
      if (nextGroup.length === 0) return;

      const currentSelection = domEditSelectionRef.current;
      const nextSelection =
        nextGroup.find((selection) => domEditSelectionsTargetSame(selection, currentSelection)) ??
        nextGroup[0] ??
        null;

      domEditSelectionRef.current = nextSelection;
      domEditGroupSelectionsRef.current = nextGroup;
      setDomEditSelection(nextSelection);
      setDomEditGroupSelections(nextGroup);

      if (nextSelection) {
        setSelectedTimelineElementId(
          findMatchingTimelineElementId(nextSelection, timelineElements),
        );
      } else {
        setSelectedTimelineElementId(null);
      }
    },
    [
      activeCompPath,
      buildDomSelectionFromTarget,
      setSelectedTimelineElementId,
      timelineElements,
      previewIframeRef,
    ],
  );

  // ── Effects ──

  // Clear hover unconditionally on composition/project/preview change
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    updateDomEditHoverSelection(null);
  }, [activeCompPath, projectId, previewIframe, refreshKey, updateDomEditHoverSelection]);

  // Clear hover conditionally (caption mode, matches selection, disconnected element)
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!domEditHoverSelection) return;
    const shouldClear =
      captionEditMode ||
      domEditSelectionsTargetSame(domEditHoverSelection, domEditSelection) ||
      domEditSelectionInGroup(domEditGroupSelections, domEditHoverSelection) ||
      !domEditHoverSelection.element.isConnected;
    if (shouldClear) updateDomEditHoverSelection(null);
  }, [
    captionEditMode,
    domEditHoverSelection,
    domEditSelection,
    domEditGroupSelections,
    updateDomEditHoverSelection,
  ]);

  // Clear selection on caption mode change
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!captionEditMode) return;
    applyDomSelection(null, { revealPanel: false });
  }, [applyDomSelection, captionEditMode]);

  const applyMarqueeSelection = useCallback(
    // fallow-ignore-next-line complexity
    (selections: DomEditSelection[], additive: boolean) => {
      // Honor the inspector-panels kill switch like applyDomSelection does, so
      // marquee can't land selections while the inspector UI is suppressed.
      if (!STUDIO_INSPECTOR_PANELS_ENABLED) {
        domEditSelectionRef.current = null;
        domEditGroupSelectionsRef.current = [];
        setDomEditSelection(null);
        setDomEditGroupSelections([]);
        return;
      }
      if (selections.length === 0) {
        if (!additive) applyDomSelection(null, { revealPanel: false });
        return;
      }
      const current = domEditSelectionRef.current;
      const currentGroup = domEditGroupSelectionsRef.current;
      let nextGroup: DomEditSelection[];
      if (additive) {
        nextGroup = seedDomEditGroupWithSelection(currentGroup, current);
        for (const s of selections) {
          if (!domEditSelectionInGroup(nextGroup, s)) nextGroup = [...nextGroup, s];
        }
      } else {
        // Dedupe by target: under select-as-unit several marquee'd members collapse
        // to the same group, which must count as one selection, not many duplicates.
        nextGroup = [];
        for (const s of selections) {
          if (!domEditSelectionInGroup(nextGroup, s)) nextGroup.push(s);
        }
      }
      const nextSelection = additive && current ? current : selections[0];
      domEditSelectionRef.current = nextSelection;
      domEditGroupSelectionsRef.current = nextGroup;
      setDomEditSelection(nextSelection);
      setDomEditGroupSelections(nextGroup);
      const nextTimelineId =
        findMatchingTimelineElementId(nextSelection, timelineElements) ??
        findTimelineIdByAncestor(
          nextSelection.element,
          timelineElements,
          nextSelection.sourceFile || "index.html",
        );
      setSelectedTimelineElementId(nextTimelineId);
    },
    [applyDomSelection, timelineElements, setSelectedTimelineElementId],
  );

  // Disabled inspector effect
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (STUDIO_INSPECTOR_PANELS_ENABLED) return;
    updateDomEditHoverSelection(null);
    applyDomSelection(null, { revealPanel: false });
    if (rightPanelTab !== "renders") setRightPanelTab("renders");
  }, [applyDomSelection, rightPanelTab, updateDomEditHoverSelection, setRightPanelTab]);

  return {
    // State
    domEditSelection,
    domEditGroupSelections,
    domEditHoverSelection,
    activeGroupElement,
    // Refs
    domEditSelectionRef,
    domEditGroupSelectionsRef,
    domEditHoverSelectionRef,
    activeGroupElementRef,
    // State setters
    setDomEditSelection,
    setDomEditGroupSelections,
    setActiveGroupElement,
    // Callbacks
    applyDomSelection,
    clearDomSelection,
    buildDomSelectionFromTarget,
    resolveDomSelectionFromPreviewPoint,
    resolveAllDomSelectionsFromPreviewPoint,
    updateDomEditHoverSelection,
    buildDomSelectionForTimelineElement,
    handleTimelineElementSelect,
    refreshDomEditSelectionFromPreview,
    refreshDomEditGroupSelectionsFromPreview,
    applyMarqueeSelection,
  };
}
