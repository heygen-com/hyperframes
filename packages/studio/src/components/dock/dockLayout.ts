import type { Direction, DockviewApi } from "dockview-react";
import { DOCK_PANEL_COMPONENT } from "./dockLayoutSchema";
import { PANEL_DEFINITIONS, type PanelId } from "./panelRegistry";

const MIN_PREVIEW_W = 360;
const MIN_PREVIEW_H = 200;
const MIN_TIMELINE_H = 100;
const MIN_SIDE_W = 200;
const DEFAULT_TIMELINE_H = 360;

function defaultSideWidths(viewportWidth: number) {
  return {
    left: Math.max(MIN_SIDE_W, Math.min(384, Math.round(viewportWidth * 0.257))),
    right: Math.max(280, Math.min(424, Math.round(viewportWidth * 0.284))),
  };
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
    title: PANEL_DEFINITIONS[id].title,
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
  api.getPanel("compositions")?.api.setActive();
  api.getPanel("design")?.api.setActive();
  api.getPanel("compositions")?.group.api.setSize({ width: widths.left });
  api.getPanel("design")?.group.api.setSize({ width: widths.right });
  api.getPanel("timeline")?.group.api.setSize({ height: DEFAULT_TIMELINE_H });
}
