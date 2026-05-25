import { useState, useCallback, useRef } from "react";
import type { RightPanelTab } from "../utils/studioHelpers";
import { readStudioUiPreferences, writeStudioUiPreferences } from "../utils/studioUiPreferences";
import { trackStudioEvent } from "../utils/studioTelemetry";

export interface InitialPanelLayoutState {
  rightCollapsed?: boolean | null;
  rightPanelTab?: RightPanelTab | null;
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
      setRightPanelTab(tab);
      trackStudioEvent("tab_switch", { panel: "right_panel", tab });
    },
    [setRightPanelTab],
  );

  return {
    leftWidth,
    setLeftWidth,
    rightWidth,
    leftCollapsed,
    setLeftCollapsed,
    rightCollapsed,
    setRightCollapsed,
    rightPanelTab,
    setRightPanelTab: trackedSetRightPanelTab,
    toggleLeftSidebar,
    handlePanelResizeStart,
    handlePanelResizeMove,
    handlePanelResizeEnd,
  };
}
