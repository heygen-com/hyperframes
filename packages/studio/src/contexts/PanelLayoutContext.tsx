import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { usePanelLayout } from "../hooks/usePanelLayout";

type PanelLayoutValue = ReturnType<typeof usePanelLayout>;

const PanelLayoutContext = createContext<PanelLayoutValue | null>(null);

export function usePanelLayoutContext(): PanelLayoutValue {
  const ctx = useContext(PanelLayoutContext);
  if (!ctx) throw new Error("usePanelLayoutContext must be used within PanelLayoutProvider");
  return ctx;
}

export function PanelLayoutProvider({
  value: {
    leftWidth,
    setLeftWidth,
    rightWidth,
    leftCollapsed,
    setLeftCollapsed,
    rightCollapsed,
    setRightCollapsed,
    rightPanelTab,
    setRightPanelTab,
    toggleLeftSidebar,
    handlePanelResizeStart,
    handlePanelResizeMove,
    handlePanelResizeEnd,
  },
  children,
}: {
  value: PanelLayoutValue;
  children: ReactNode;
}) {
  const stable = useMemo<PanelLayoutValue>(
    () => ({
      leftWidth,
      setLeftWidth,
      rightWidth,
      leftCollapsed,
      setLeftCollapsed,
      rightCollapsed,
      setRightCollapsed,
      rightPanelTab,
      setRightPanelTab,
      toggleLeftSidebar,
      handlePanelResizeStart,
      handlePanelResizeMove,
      handlePanelResizeEnd,
    }),
    [
      leftWidth,
      setLeftWidth,
      rightWidth,
      leftCollapsed,
      setLeftCollapsed,
      rightCollapsed,
      setRightCollapsed,
      rightPanelTab,
      setRightPanelTab,
      toggleLeftSidebar,
      handlePanelResizeStart,
      handlePanelResizeMove,
      handlePanelResizeEnd,
    ],
  );
  return <PanelLayoutContext value={stable}>{children}</PanelLayoutContext>;
}
