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

function getInitialRightInspectorPanes(tab?: RightPanelTab | null): RightInspectorPanes {
  if (tab === "layers") return { layers: true, design: false };
  return { layers: false, design: true };
}

export function usePanelLayout(initialState?: InitialPanelLayoutState) {
  const [leftWidth, setLeftWidth] = useState(240);
  const [rightWidth, setRightWidth] = useState(400);
  const [leftCollapsed, setLeftCollapsed] = useState(
    () => readStudioUiPreferences().leftCollapsed ?? false,
  );
  const [rightCollapsed, setRightCollapsed] = useState(initialState?.rightCollapsed ?? true);
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>(
    initialState?.rightPanelTab ?? "renders",
  );
  const [rightInspectorPanes, setRightInspectorPanes] = useState<RightInspectorPanes>(() =>
    getInitialRightInspectorPanes(initialState?.rightPanelTab),
  );
  const panelDragRef = useRef<{
    side: "left" | "right";
    startX: number;
    startW: number;
  } | null>(null);

  const toggleLeftSidebar = useCallback(() => {
    setLeftCollapsed((collapsed) => {
      writeStudioUiPreferences({ leftCollapsed: !collapsed });
      trackStudioEvent("panel_toggle", { panel: "left_sidebar", collapsed: !collapsed });
      return !collapsed;
    });
  }, []);

  const handlePanelResizeStart = useCallback(
    (side: "left" | "right", e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      panelDragRef.current = {
        side,
        startX: e.clientX,
        startW: side === "left" ? leftWidth : rightWidth,
      };
    },
    [leftWidth, rightWidth],
  );

  const handlePanelResizeMove = useCallback((e: React.PointerEvent) => {
    const drag = panelDragRef.current;
    if (!drag) return;
    const delta = e.clientX - drag.startX;
    const maxLeft = Math.floor(window.innerWidth * 0.5);
    const newW = Math.max(
      160,
      Math.min(
        drag.side === "left" ? maxLeft : 600,
        drag.startW + (drag.side === "left" ? delta : -delta),
      ),
    );
    if (drag.side === "left") setLeftWidth(newW);
    else setRightWidth(newW);
  }, []);

  const handlePanelResizeEnd = useCallback(() => {
    panelDragRef.current = null;
  }, []);

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
    setLeftWidth,
    rightWidth,
    setRightWidth,
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
