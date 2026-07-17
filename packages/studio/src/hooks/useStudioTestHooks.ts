import { useEffect } from "react";
import type { DomEditSelection } from "../components/editor/domEditing";
import { usePlayerStore } from "../player/store/playerStore";
import {
  readTimelinePerformanceDiagnostics,
  type TimelinePerformanceDiagnostics,
} from "../player/lib/timelinePerformanceDiagnostics";
import {
  createTimelinePerformanceFixture,
  setTimelinePerformanceFixtureLease,
  type TimelinePerformanceFixtureSpec,
  type TimelinePerformanceFixtureSummary,
} from "../player/lib/timelinePerformanceFixture";
import { TIMELINE_VIEWPORT_BUDGETS } from "../player/lib/timelineViewportBudgets";

interface StudioTestHookDeps {
  previewIframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  buildDomSelectionFromTarget: (target: HTMLElement) => Promise<DomEditSelection | null>;
  applyDomSelection: (
    selection: DomEditSelection | null,
    options?: { revealPanel?: boolean },
  ) => void;
}

interface StudioTestApi {
  selectByDomId: (id: string) => Promise<boolean>;
  loadTimelinePerformanceFixture: (
    spec: TimelinePerformanceFixtureSpec,
  ) => TimelinePerformanceFixtureSummary;
  readTimelinePerformanceDiagnostics: () => Readonly<TimelinePerformanceDiagnostics>;
  timelineViewportBudgets: typeof TIMELINE_VIEWPORT_BUDGETS;
}

declare global {
  interface Window {
    __studioTest?: StudioTestApi;
  }
}

/**
 * Dev-only headless-QA shortcut. Selecting an element normally requires a
 * pixel-precise click inside the preview iframe, which automated verification
 * can't reliably land. `window.__studioTest.selectByDomId(id)` resolves the
 * DomEditSelection for a preview element by id and reveals the inspector —
 * exactly what a click does — so a driver can open the property/ease panels and
 * then focus a segment via `__playerStore.getState().setFocusedEaseSegment`.
 * No-op in production builds.
 */
export function useStudioTestHooks({
  previewIframeRef,
  buildDomSelectionFromTarget,
  applyDomSelection,
}: StudioTestHookDeps): void {
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    let isDev = false;
    try {
      isDev = import.meta.env.DEV === true;
    } catch {
      isDev = false;
    }
    const isBenchmarkBuild = import.meta.env.VITE_STUDIO_TIMELINE_BENCHMARK_ENABLED === "1";
    if ((!isDev && !isBenchmarkBuild) || typeof window === "undefined") return;
    const api: StudioTestApi = {
      selectByDomId: async (id: string): Promise<boolean> => {
        const element = previewIframeRef.current?.contentDocument?.getElementById(id) ?? null;
        if (!element) return false;
        const selection = await buildDomSelectionFromTarget(element);
        if (!selection) return false;
        applyDomSelection(selection, { revealPanel: true });
        return true;
      },
      loadTimelinePerformanceFixture: (spec) => {
        const fixture = createTimelinePerformanceFixture(spec);
        setTimelinePerformanceFixtureLease(true);
        usePlayerStore.setState({
          currentTime: 0,
          duration: fixture.summary.duration,
          timelineReady: true,
          zoomMode: "manual",
          manualZoomPercent: 2_000,
          elements: fixture.elements,
          selectedElementId: null,
          selectedElementIds: new Set(),
          selectedKeyframes: new Set(),
          keyframeCache: fixture.keyframeCache,
          gsapAnimations: fixture.gsapAnimations,
          expandedClipIds: fixture.expandedClipIds,
        });
        return fixture.summary;
      },
      readTimelinePerformanceDiagnostics: () => readTimelinePerformanceDiagnostics(),
      timelineViewportBudgets: TIMELINE_VIEWPORT_BUDGETS,
    };
    window.__studioTest = api;
    return () => {
      setTimelinePerformanceFixtureLease(false);
      window.__studioTest = undefined;
    };
  }, [applyDomSelection, buildDomSelectionFromTarget, previewIframeRef]);
}
