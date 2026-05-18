import { useState, useCallback, useRef } from "react";
import { isInspectorPanelTab, type RightPanelTab } from "../utils/studioHelpers";
import { readStudioUiPreferences, writeStudioUiPreferences } from "../utils/studioUiPreferences";

export interface InitialPanelLayoutState {
  rightCollapsed?: boolean | null;
  rightPanelTab?: RightPanelTab | null;
  rightPanelTabs?: RightPanelTab[] | null;
}

const MAX_RIGHT_PANEL_TABS = 2;

function clampRightPanelTabs(tabs: RightPanelTab[]): RightPanelTab[] {
  const deduped = Array.from(new Set(tabs));
  if (deduped.length === 0) return ["design"];
  if (deduped.length <= MAX_RIGHT_PANEL_TABS) return deduped;
  return deduped.slice(-MAX_RIGHT_PANEL_TABS);
}

export function usePanelLayout(initialState?: InitialPanelLayoutState) {
  const [leftWidth, setLeftWidth] = useState(240);
  const [rightWidth, setRightWidth] = useState(400);
  const [leftCollapsed, setLeftCollapsed] = useState(
    () => readStudioUiPreferences().leftCollapsed ?? false,
  );
  const [rightCollapsed, setRightCollapsed] = useState(initialState?.rightCollapsed ?? true);
  const [rightPanelTabs, setRightPanelTabs] = useState<RightPanelTab[]>(() => {
    const fromState = initialState?.rightPanelTabs?.filter(Boolean) ?? [];
    if (fromState.length > 0) return clampRightPanelTabs(fromState);
    if (initialState?.rightPanelTab) return clampRightPanelTabs([initialState.rightPanelTab]);
    return clampRightPanelTabs(["design"]);
  });
  const [rightPanelFocusTab, setRightPanelFocusTab] = useState<RightPanelTab>(
    initialState?.rightPanelTab && rightPanelTabs.includes(initialState.rightPanelTab)
      ? initialState.rightPanelTab
      : (rightPanelTabs[0] ?? "design"),
  );
  const panelDragRef = useRef<{
    side: "left" | "right";
    startX: number;
    startW: number;
  } | null>(null);

  const toggleLeftSidebar = useCallback(() => {
    setLeftCollapsed((collapsed) => {
      writeStudioUiPreferences({ leftCollapsed: !collapsed });
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

  const focusRightPanelTab = useCallback(
    (tab: RightPanelTab) => {
      setRightPanelTabs((current) => {
        if (current.includes(tab)) return current;
        return clampRightPanelTabs([...current, tab]);
      });
      setRightPanelFocusTab(tab);
    },
    [setRightPanelTabs, setRightPanelFocusTab],
  );

  const toggleRightPanelTab = useCallback(
    (tab: RightPanelTab) => {
      setRightPanelTabs((current) => {
        const has = current.includes(tab);
        if (!has) {
          const next = clampRightPanelTabs([...current, tab]);
          setRightPanelFocusTab(tab);
          return next;
        }
        const next = current.filter((item) => item !== tab);
        if (next.length === 0) {
          setRightPanelFocusTab("design");
          return ["design"];
        }
        setRightPanelFocusTab((focused) => (focused === tab ? next[next.length - 1]! : focused));
        return next;
      });
    },
    [setRightPanelTabs, setRightPanelFocusTab],
  );

  const ensureDesignVisible = useCallback(() => {
    setRightPanelTabs((current) => {
      if (current.some((tab) => isInspectorPanelTab(tab))) return current;
      return clampRightPanelTabs([...current.filter((tab) => tab !== "renders"), "design"]);
    });
    setRightPanelFocusTab("design");
  }, []);

  return {
    leftWidth,
    setLeftWidth,
    rightWidth,
    leftCollapsed,
    setLeftCollapsed,
    rightCollapsed,
    setRightCollapsed,
    rightPanelTabs,
    rightPanelFocusTab,
    focusRightPanelTab,
    toggleRightPanelTab,
    ensureDesignVisible,
    toggleLeftSidebar,
    handlePanelResizeStart,
    handlePanelResizeMove,
    handlePanelResizeEnd,
  };
}
