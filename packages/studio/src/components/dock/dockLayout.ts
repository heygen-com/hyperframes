import type { Direction, DockviewApi } from "dockview-react";
import { DOCK_PANEL_COMPONENT } from "./dockLayoutSchema";
import { hostPanelIds, isPanelId, panelDefinition, type PanelId } from "./panelRegistry";

const MIN_PREVIEW_W = 360;
const MIN_PREVIEW_H = 200;
const MIN_TIMELINE_H = 100;
const MIN_SIDE_W = 200;
const MIN_SIDE_W_FLOOR = 120;
const DEFAULT_TIMELINE_H = 360;

/** Preferred side widths; when they overflow the preview's floor the right yields first, then the left. */
export function defaultSideWidths(viewportWidth: number) {
  const floor = sideMinimumWidth(viewportWidth);
  const left = Math.max(floor, Math.min(384, Math.round(viewportWidth * 0.257)));
  const right = Math.max(Math.min(280, floor), Math.min(424, Math.round(viewportWidth * 0.284)));
  const excess = left + right - Math.max(0, viewportWidth - MIN_PREVIEW_W);
  if (excess <= 0) return { left, right };
  const shrunkRight = Math.max(floor, right - excess);
  return { left: Math.max(floor, left - (excess - (right - shrunkRight))), right: shrunkRight };
}

/**
 * Side groups keep MIN_SIDE_W while both fit beside the preview's floor, then shrink down to
 * MIN_SIDE_W_FLOOR; below that the dock overflows and clips rather than squeezing the preview.
 */
export function sideMinimumWidth(dockWidth: number): number {
  const fair = Math.floor((dockWidth - MIN_PREVIEW_W) / 2);
  return Math.min(MIN_SIDE_W, Math.max(MIN_SIDE_W_FLOOR, fair));
}

function holdsPreview(group: DockviewApi["groups"][number]) {
  return group.panels.some((panel) => panel.id === "preview");
}

/** The zone of a group whose every tab is a side panel, else null. */
function sideZone(group: DockviewApi["groups"][number]): "left" | "right" | null {
  const zones = group.panels.map((panel) =>
    isPanelId(panel.id) ? panelDefinition(panel.id).zone : "center",
  );
  const first = zones[0];
  const allSide = zones.every((zone) => zone !== "center");
  return allSide && first && first !== "center" ? first : null;
}

/** Idempotent; rewrites every group's minimum, since dockview keeps a constraint once set. */
export function applySideMinimums(api: DockviewApi, dockWidth = window.innerWidth) {
  const minimumWidth = sideMinimumWidth(dockWidth);
  const cap = defaultSideWidths(dockWidth);
  for (const group of api.groups) {
    if (holdsPreview(group)) {
      group.api.setConstraints({ minimumWidth: MIN_PREVIEW_W });
      continue;
    }
    group.api.setConstraints({ minimumWidth });
    const zone = sideZone(group);
    const limit = zone === "right" ? cap.right : cap.left;
    if (zone && minimumWidth < MIN_SIDE_W && group.width > limit) {
      group.api.setSize({ width: limit });
    }
  }
}

function minimumSize(id: PanelId) {
  if (id === "preview") return { minimumWidth: MIN_PREVIEW_W, minimumHeight: MIN_PREVIEW_H };
  if (id === "timeline") return { minimumHeight: MIN_TIMELINE_H };
  return { minimumWidth: MIN_SIDE_W };
}

export function addRegisteredPanel(
  api: DockviewApi,
  id: PanelId,
  position?: { referencePanel: PanelId; direction: Direction },
) {
  return api.addPanel({
    id,
    component: DOCK_PANEL_COMPONENT,
    title: panelDefinition(id).title,
    renderer: "always",
    ...minimumSize(id),
    ...(position ? { position } : {}),
  });
}

/** The default Edit layout: [library | preview | inspector] over a full-width timeline. */
export function buildEditLayout(api: DockviewApi, viewportWidth: number) {
  api.clear();
  const widths = defaultSideWidths(viewportWidth);
  addRegisteredPanel(api, "preview");
  addRegisteredPanel(api, "timeline", { referencePanel: "preview", direction: "below" });
  addRegisteredPanel(api, "compositions", { referencePanel: "preview", direction: "left" });
  for (const id of ["assets", "code", "catalog"] as const) {
    addRegisteredPanel(api, id, { referencePanel: "compositions", direction: "within" });
  }
  addRegisteredPanel(api, "design", { referencePanel: "preview", direction: "right" });
  for (const id of ["layers", "renders", "variables"] as const) {
    addRegisteredPanel(api, id, { referencePanel: "design", direction: "within" });
  }
  // The host's panels tab into their column after the built-ins, which stay the active tabs.
  for (const id of hostPanelIds()) {
    const anchor = panelDefinition(id).zone === "left" ? "compositions" : "design";
    addRegisteredPanel(api, id, { referencePanel: anchor, direction: "within" });
  }
  api.getPanel("compositions")?.api.setActive();
  api.getPanel("design")?.api.setActive();
  applySideMinimums(api, viewportWidth);
  api.getPanel("compositions")?.group.api.setSize({ width: widths.left });
  api.getPanel("design")?.group.api.setSize({ width: widths.right });
  api.getPanel("timeline")?.group.api.setSize({ height: DEFAULT_TIMELINE_H });
}
