import { useState, useCallback, useRef, useEffect } from "react";
import type {
  RightInspectorPane,
  RightInspectorPanes,
  RightPanelTab,
} from "../utils/studioHelpers";
import { readStudioUiPreferences, writeStudioUiPreferences } from "../utils/studioUiPreferences";
import { trackStudioEvent } from "../utils/studioTelemetry";
import { STUDIO_FLAT_INSPECTOR_ENABLED } from "../components/editor/manualEditingAvailability";
import {
  defaultPanelWidths,
  fitPanelWidths,
  railsEngaged,
  type PanelWidths,
} from "../utils/fitPanels";

const NO_OVERRIDE = { left: false, right: false } as const;

export interface InitialPanelLayoutState {
  rightCollapsed?: boolean | null;
  rightPanelTab?: RightPanelTab | null;
}

type PanelSide = "left" | "right";

function getInitialRightInspectorPanes(tab?: RightPanelTab | null): RightInspectorPanes {
  if (tab === "layers") return { layers: true, design: false };
  return { layers: false, design: true };
}

function readViewportWidth(): number {
  return typeof window === "undefined" ? 1496 : window.innerWidth;
}

/**
 * What the user WANTS each panel to be, before the window gets a say. Stored
 * preferences win over the width-derived defaults; neither is clamped here —
 * `fitPanelWidths` owns every clamp so there is one place that decides.
 */
function getPreferredPanelWidths(): PanelWidths {
  const preferences = readStudioUiPreferences();
  const defaults = defaultPanelWidths(readViewportWidth());
  return {
    left: preferences.leftWidth ?? defaults.left,
    right: preferences.rightWidth ?? defaults.right,
  };
}

export function usePanelLayout(initialState?: InitialPanelLayoutState) {
  const [preferredWidths, setPreferredWidths] = useState(getPreferredPanelWidths);
  const [viewportWidth, setViewportWidth] = useState(readViewportWidth);
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
  // Set when the user explicitly reopens a panel the window had auto-collapsed,
  // so the rail cannot immediately swallow it again. Cleared once the window is
  // wide enough that auto-collapse is no longer in play.
  const [autoCollapseOverride, setAutoCollapseOverride] = useState<{
    left: boolean;
    right: boolean;
  }>(NO_OVERRIDE);

  // Reconciliation is a live window resize away, not a mount-time snapshot: a
  // Studio loaded at 1440 and dragged to a half-screen used to keep its pixel
  // widths and squeeze the preview to nothing.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleResize = () => {
      const width = window.innerWidth;
      setViewportWidth(width);
      // Cleared here rather than in an effect watching derived state: the rail
      // flags depend only on width, and width only changes in this handler.
      if (!railsEngaged(width)) {
        setAutoCollapseOverride((prev) => (prev.left || prev.right ? NO_OVERRIDE : prev));
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const fitted = fitPanelWidths(viewportWidth, preferredWidths, autoCollapseOverride);
  const leftCollapsedByWidth = fitted.autoCollapseLeft;
  const rightCollapsedByWidth = fitted.autoCollapseRight;

  // Rendered widths, which the drag handles measure from so the seam does not
  // jump when a panel is currently narrower than its stored preference.
  const fittedRef = useRef(fitted);
  fittedRef.current = fitted;

  const panelDragRef = useRef<{
    side: PanelSide;
    startX: number;
    startW: number;
  } | null>(null);

  // Preferred widths are also held in a ref so a burst of pointer moves or
  // keyboard nudges inside one React batch accumulates, instead of every call
  // in the batch reading the same pre-render value.
  const preferredRef = useRef(preferredWidths);

  const setPreferred = useCallback((side: PanelSide, width: number) => {
    const next = Math.max(0, Math.round(width));
    preferredRef.current = { ...preferredRef.current, [side]: next };
    setPreferredWidths(preferredRef.current);
    return next;
  }, []);

  /** Transient: moves the panel without touching the stored preference. */
  const updatePanelWidth = useCallback(
    (side: PanelSide, width: number) => {
      setPreferred(side, width);
    },
    [setPreferred],
  );

  /**
   * Durable: only an explicit drag or keyboard nudge writes a preference. A
   * width the window forced on us is never persisted, so the user's real
   * preference survives a temporary squeeze and returns when the window grows.
   */
  const commitPanelWidth = useCallback(
    (side: PanelSide, width: number) => {
      // Persist what the window will actually allow, not a raw pointer delta.
      const candidate = { ...preferredRef.current, [side]: Math.max(0, Math.round(width)) };
      const settled = fitPanelWidths(readViewportWidth(), candidate)[side];
      setPreferred(side, settled);
      writeStudioUiPreferences(side === "left" ? { leftWidth: settled } : { rightWidth: settled });
    },
    [setPreferred],
  );

  const adjustPanelWidth = useCallback(
    (side: PanelSide, delta: number) => {
      commitPanelWidth(side, preferredRef.current[side] + delta);
    },
    [commitPanelWidth],
  );

  // The toggle acts on what the user can SEE, not on stored intent. Toggling
  // stored intent instead made the rail's "Show sidebar" button dead in the
  // auto-collapsed state: intent was already false, so the click flipped it to
  // true (persisting a collapse the user never asked for) while the rail stayed
  // railed and nothing visibly happened.
  const effectiveLeftCollapsedRef = useRef(false);
  effectiveLeftCollapsedRef.current = leftCollapsed || leftCollapsedByWidth;

  const toggleLeftSidebar = useCallback(() => {
    const next = !effectiveLeftCollapsedRef.current;
    setLeftCollapsed(next);
    writeStudioUiPreferences({ leftCollapsed: next });
    trackStudioEvent("panel_toggle", { panel: "left_sidebar", collapsed: next });
    if (!next) setAutoCollapseOverride((prev) => ({ ...prev, left: true }));
  }, []);

  const setRightCollapsedWithOverride = useCallback((collapsed: boolean) => {
    setRightCollapsed(collapsed);
    if (!collapsed) setAutoCollapseOverride((prev) => ({ ...prev, right: true }));
  }, []);

  const handlePanelResizeStart = useCallback((side: PanelSide, e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    panelDragRef.current = {
      side,
      startX: e.clientX,
      startW: fittedRef.current[side],
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
    if (side) commitPanelWidth(side, preferredRef.current[side]);
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
    leftWidth: fitted.left,
    rightWidth: fitted.right,
    adjustPanelWidth,
    /**
     * User intent. Persisted to localStorage; never written by auto-collapse.
     * Deliberately read-only outside this hook: `toggleLeftSidebar` is the only
     * writer, so it cannot be flipped without also clearing the rail override
     * (which would open the sidebar and then immediately rail it again).
     */
    leftCollapsed,
    /** User intent. Synced into the shareable URL; never written by auto-collapse. */
    rightCollapsed,
    setRightCollapsed: setRightCollapsedWithOverride,
    /** What the shell actually renders: intent OR the window forcing a rail. */
    effectiveLeftCollapsed: leftCollapsed || leftCollapsedByWidth,
    effectiveRightCollapsed: rightCollapsed || rightCollapsedByWidth,
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
