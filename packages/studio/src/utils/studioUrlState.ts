import type { RightPanelTab } from "./studioHelpers";
import { buildProjectHash, parseProjectHashRoute } from "./projectRouting";
import { STUDIO_INSPECTOR_PANELS_ENABLED } from "../components/editor/manualEditingAvailability";
import { roundTo3 } from "./rounding";

export interface StudioUrlSelectionState {
  sourceFile?: string;
  id?: string;
  selector?: string;
  selectorIndex?: number;
}

export interface StudioUrlState {
  activeCompPath: string | null;
  currentTime: number | null;
  rightPanelTab: RightPanelTab | null;
  rightCollapsed: boolean | null;
  timelineVisible: boolean | null;
  selection: StudioUrlSelectionState | null;
}

const VALID_TABS: RightPanelTab[] = ["layers", "design", "renders", "slideshow", "variables"];

/**
 * The composition a schema-level panel (Variables / Slideshow) targets on the
 * master view, where there is no explicit `activeCompPath`. Prefer the
 * `index.html` convention, but fall back to the first `.html` in the file tree
 * (composition-browser order) so projects whose entry file is `card.html`,
 * `hero.html`, etc. don't silently mis-target a non-existent `index.html`.
 * Returns null when the project carries no composition file at all.
 */
export function resolveMasterCompositionPath(fileTree: string[]): string | null {
  if (fileTree.includes("index.html")) return "index.html";
  return fileTree.find((p) => p.endsWith(".html")) ?? null;
}

export function normalizeStudioUrlPanelTab(
  tab: RightPanelTab | null,
  options: {
    inspectorPanelsEnabled?: boolean;
  } = {},
): RightPanelTab | null {
  if (!tab) return null;
  if (!VALID_TABS.includes(tab)) return null;
  const inspectorPanelsEnabled = options.inspectorPanelsEnabled ?? STUDIO_INSPECTOR_PANELS_ENABLED;

  if (!inspectorPanelsEnabled && tab !== "renders") return "renders";
  return tab;
}

export function normalizeStudioCompositionPath(
  activeCompPath: string | null,
  fileTree: string[],
): string | null {
  if (!activeCompPath || activeCompPath === "index.html") return null;
  return fileTree.includes(activeCompPath) ? activeCompPath : null;
}

function parseBoolean(value: string | null): boolean | null {
  if (value === "1") return true;
  if (value === "0") return false;
  return null;
}

function parseNumber(value: string | null): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTab(value: string | null): RightPanelTab | null {
  return VALID_TABS.includes(value as RightPanelTab) ? (value as RightPanelTab) : null;
}

function normalizeSelection(params: URLSearchParams): StudioUrlSelectionState | null {
  const sourceFile = params.get("selFile") || undefined;
  const id = params.get("selId") || undefined;
  const selector = params.get("selSelector") || undefined;
  const selectorIndex = parseNumber(params.get("selIndex"));

  if (!sourceFile && !id && !selector) return null;

  return {
    sourceFile,
    id,
    selector,
    selectorIndex: selectorIndex != null ? Math.max(0, Math.floor(selectorIndex)) : undefined,
  };
}

function defaultStudioUrlState(): StudioUrlState {
  return {
    activeCompPath: null,
    currentTime: null,
    rightPanelTab: null,
    rightCollapsed: null,
    timelineVisible: null,
    selection: null,
  };
}

export function parseStudioUrlStateFromHash(hash: string): StudioUrlState {
  const route = parseProjectHashRoute(hash);
  if (!route) return defaultStudioUrlState();

  const { params } = route;
  return {
    activeCompPath: params.get("comp") || null,
    currentTime: parseNumber(params.get("t")),
    rightPanelTab: normalizeStudioUrlPanelTab(parseTab(params.get("tab"))),
    rightCollapsed: parseBoolean(params.get("rc")),
    timelineVisible: parseBoolean(params.get("tv")),
    selection: normalizeSelection(params),
  };
}

export function readStudioUrlStateFromWindow(): StudioUrlState {
  if (typeof window === "undefined") return defaultStudioUrlState();
  return parseStudioUrlStateFromHash(window.location.hash);
}

// Pre-existing param-assembly complexity — surfaced by this PR's line shifts.
// fallow-ignore-next-line complexity
export function buildStudioHash(projectId: string, state: StudioUrlState): string {
  const params = new URLSearchParams();

  params.set("v", "1");
  if (state.activeCompPath) params.set("comp", state.activeCompPath);
  if (state.currentTime != null && Number.isFinite(state.currentTime)) {
    params.set("t", String(Math.max(0, roundTo3(state.currentTime))));
  }
  if (state.rightPanelTab) params.set("tab", state.rightPanelTab);
  if (state.rightCollapsed != null) params.set("rc", state.rightCollapsed ? "1" : "0");
  if (state.timelineVisible != null) params.set("tv", state.timelineVisible ? "1" : "0");
  if (state.selection) {
    if (state.selection.sourceFile) params.set("selFile", state.selection.sourceFile);
    if (state.selection.id) params.set("selId", state.selection.id);
    if (state.selection.selector) params.set("selSelector", state.selection.selector);
    if (typeof state.selection.selectorIndex === "number") {
      params.set("selIndex", String(Math.max(0, Math.floor(state.selection.selectorIndex))));
    }
  }

  return buildProjectHash(projectId, params);
}
