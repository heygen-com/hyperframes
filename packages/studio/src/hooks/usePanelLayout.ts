import { useState, useCallback, useRef } from "react";
import type {
  RightInspectorPane,
  RightInspectorPanes,
  RightPanelTab,
} from "../utils/studioHelpers";
import { readStudioUiPreferences, writeStudioUiPreferences } from "../utils/studioUiPreferences";
import { trackStudioEvent } from "../utils/studioTelemetry";
import { STUDIO_FLAT_INSPECTOR_ENABLED } from "../components/editor/manualEditingAvailability";

export interface InitialPanelLayoutState {
  rightCollapsed?: boolean | null;
  rightPanelTab?: RightPanelTab | null;
}

type PanelSide = "left" | "right";

function getInitialRightInspectorPanes(tab?: RightPanelTab | null): RightInspectorPanes {
  if (tab === "layers") return { layers: true, design: false };
  return { layers: false, design: true };
}

function getInitialPanelWidths(): { left: number; right: number } {
  const viewportWidth = typeof window === "undefined" ? 1496 : window.innerWidth;
  const preferences = readStudioUiPreferences();
  const leftDefault = Math.max(240, Math.min(384, Math.round(viewportWidth * 0.257)));
  const rightDefault = Math.max(320, Math.min(424, Math.round(viewportWidth * 0.284)));
  return {
    left: Math.max(
      160,
      Math.min(Math.floor(viewportWidth * 0.5), preferences.leftWidth ?? leftDefault),
    ),
    right: Math.max(160, Math.min(600, preferences.rightWidth ?? rightDefault)),
  };
}

function clampPanelWidth(side: PanelSide, width: number): number {
  const max = side === "left" ? Math.floor(window.innerWidth * 0.5) : 600;
  return Math.max(160, Math.min(max, width));
}

export function usePanelLayout(initialState?: InitialPanelLayoutState) {
  const [initialPanelWidths] = useState(getInitialPanelWidths);
  const [leftWidth, setLeftWidth] = useState(initialPanelWidths.left);
  const [rightWidth, setRightWidth] = useState(initialPanelWidths.right);
  const panelWidthsRef = useRef(initialPanelWidths);
  const [leftCollapsed, setLeftCollapsed] = useState(
    () => readStudioUiPreferences().leftCollapsed ?? false,
  );
  const [rightCollapsed, setRightCollapsed] = useState(initialState?.rightCollapsed ?? false);
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>(
    initialState?.rightPanelTab ?? "design",
  );
  const [rightInspectorPanes, setRightInspectorPanes] = useState<RightInspectorPanes>(() =>
    getInitialRightInspectorPanes(initialState?.rightPanelTab),
  );
  const panelDragRef = useRef<{
    side: PanelSide;
    startX: number;
    startW: number;
  } | null>(null);

  const updatePanelWidth = useCallback((side: PanelSide, width: number) => {
    const next = clampPanelWidth(side, width);
    panelWidthsRef.current[side] = next;
    if (side === "left") setLeftWidth(next);
    else setRightWidth(next);
    return next;
  }, []);

  const commitPanelWidth = useCallback(
    (side: PanelSide, width: number) => {
      const next = updatePanelWidth(side, Math.round(width));
      writeStudioUiPreferences(side === "left" ? { leftWidth: next } : { rightWidth: next });
    },
    [updatePanelWidth],
  );

  const adjustPanelWidth = useCallback(
    (side: PanelSide, delta: number) => {
      commitPanelWidth(side, panelWidthsRef.current[side] + delta);
    },
    [commitPanelWidth],
  );

  const toggleLeftSidebar = useCallback(() => {
    setLeftCollapsed((collapsed) => {
      writeStudioUiPreferences({ leftCollapsed: !collapsed });
      trackStudioEvent("panel_toggle", { panel: "left_sidebar", collapsed: !collapsed });
      return !collapsed;
    });
  }, []);

  const handlePanelResizeStart = useCallback((side: PanelSide, e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    panelDragRef.current = {
      side,
      startX: e.clientX,
      startW: panelWidthsRef.current[side],
    };
  }, []);

  const handlePanelResizeMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = panelDragRef.current;
      if (!drag) return;
      const delta = e.clientX - drag.startX;
      updatePanelWidth(drag.side, drag.startW + (drag.side === "left" ? delta : -delta));
    },
    [updatePanelWidth],
  );

  const handlePanelResizeEnd = useCallback(() => {
    const side = panelDragRef.current?.side;
    if (side) commitPanelWidth(side, panelWidthsRef.current[side]);
    panelDragRef.current = null;
  }, [commitPanelWidth]);

  const trackedSetRightPanelTab = useCallback(
    (tab: RightPanelTab) => {
      if (tab === "design" || tab === "layers") {
        // Flat inspector: Layers always renders full-height by itself (see
        // StudioRightPanel's render gate), so this MUST land on the same
        // radio-style exclusivity setExclusiveRightInspectorPane enforces for
        // the direct in-panel tab click — every OTHER path that reaches here
        // (element select, closing block-params, the header Inspector
        // button, and this function's own callers outside an active
        // inspector tab) would otherwise additively leave both panes `true`
        // and reproduce the "both tabs highlight, only one renders" bug this
        // still-additive branch used to cause under the flat flag.
        setRightInspectorPanes(
          STUDIO_FLAT_INSPECTOR_ENABLED
            ? { design: tab === "design", layers: tab === "layers" }
            : (panes) => ({ ...panes, [tab]: true }),
        );
      }
      setRightPanelTab(tab);
      trackStudioEvent("tab_switch", { panel: "right_panel", tab });
    },
    [setRightPanelTab],
  );

  const toggleRightInspectorPane = useCallback((pane: RightInspectorPane) => {
    setRightInspectorPanes((panes) => {
      const next = { ...panes, [pane]: !panes[pane] };
      if (!next.design && !next.layers) return panes;
      return next;
    });
  }, []);

  // Radio-style variant for the flat inspector: Layers always renders full-
  // height by itself there (never split-shared with Design), so leaving both
  // panes independently toggleable would highlight both tabs as "active"
  // while only one actually shows. Selecting one turns the other off.
  const setExclusiveRightInspectorPane = useCallback((pane: RightInspectorPane) => {
    setRightInspectorPanes({ design: pane === "design", layers: pane === "layers" });
  }, []);

  return {
    leftWidth,
    rightWidth,
    adjustPanelWidth,
    leftCollapsed,
    setLeftCollapsed,
    rightCollapsed,
    setRightCollapsed,
    rightPanelTab,
    setRightPanelTab: trackedSetRightPanelTab,
    rightInspectorPanes,
    toggleRightInspectorPane,
    setExclusiveRightInspectorPane,
    toggleLeftSidebar,
    handlePanelResizeStart,
    handlePanelResizeMove,
    handlePanelResizeEnd,
  };
}
